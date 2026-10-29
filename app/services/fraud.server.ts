import { GlobalFraudNetwork, ShipmentBooking } from "../db.server";
import { sanitizeBangladeshPhone, isValidBangladeshMobile } from "../utils/phone";
import { getPathaoBaseUrl, getValidPathaoToken } from "./courier-auth.server";

export interface FraudStatsProfile {
  phone: string;
  totalDelivered: number;
  totalReturned: number;
  totalOrders: number;
  successRate: number;
  fromCache?: boolean;
  isTransientError?: boolean;
}

/**
 * High-Speed Multi-Courier Customer Delivery History & Fraud Risk Resolver
 * Aggregates delivery data across:
 * 1. GlobalFraudNetwork MongoDB Cache (0ms on fresh hit)
 * 2. Internal 5-Courier ShipmentBooking Database History
 * 3. Steadfast Courier Official Delivery History API (3s timeout)
 * 4. Pathao Courier Official Customer Success API (3s timeout)
 *
 * CRITICAL SAFEGUARD: Never saves empty 0/0 records on network timeouts or API outages.
 */
export async function resolveCustomerFraudProfile(
  rawPhone: string,
  storeConfig: any,
  cachedPathaoTokenRef: { token: string | null; attempted: boolean } = {
    token: null,
    attempted: false,
  }
): Promise<FraudStatsProfile | null> {
  const cleanPhone = sanitizeBangladeshPhone(rawPhone);
  if (!isValidBangladeshMobile(cleanPhone)) {
    return null;
  }
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // 1. Purge any poisoned sandbox mock records if any exist
  try {
    await GlobalFraudNetwork.deleteMany({
      phone: cleanPhone,
      dataSource: "multi_courier_sandbox_sync",
    });
  } catch {}

  // 2. Check MongoDB GlobalFraudNetwork cache (0ms instant return if fresh)
  const existingProfile: any = await GlobalFraudNetwork.findOne({
    phone: cleanPhone,
    dataSource: { $ne: "multi_courier_sandbox_sync" },
  }).lean();

  const isCacheFresh =
    existingProfile &&
    existingProfile.lastCheckedAt &&
    Date.now() - new Date(existingProfile.lastCheckedAt).getTime() < CACHE_TTL_MS;

  if (existingProfile && isCacheFresh) {
    return {
      phone: cleanPhone,
      totalDelivered: existingProfile.totalDelivered ?? 0,
      totalReturned: existingProfile.totalReturned ?? 0,
      totalOrders: existingProfile.totalOrders ?? 0,
      successRate: existingProfile.successRate ?? 100,
      fromCache: true,
    };
  }

  // 3. Source A: Internal 5-Courier Database Delivery History across store bookings
  let internalDelivered = 0;
  let internalReturned = 0;
  try {
    const internalBookings = await ShipmentBooking.find({
      customerPhone: cleanPhone,
    }).lean();

    for (const b of internalBookings) {
      const status = String(b.deliveryStatus || b.courierStatus || "").toLowerCase();
      if (status.includes("deliver") && !status.includes("return") && !status.includes("part")) {
        internalDelivered++;
      } else if (status.includes("return") || status.includes("cancel")) {
        internalReturned++;
      }
    }
  } catch {}

  // 4. Source B: Steadfast Official Fraud Check API (strict 3-second timeout)
  const requestSteadfastHistory = async (): Promise<{ delivered: number; returned: number } | null> => {
    const apiKey = storeConfig?.steadfastApiKey?.trim();
    const secretKey = storeConfig?.steadfastSecretKey?.trim();
    if (!apiKey || !secretKey) return null;

    try {
      const response = await fetch(
        "https://portal.steadfast.com.bd/api/v1/check_delivery_history",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Api-Key": apiKey,
            "Secret-Key": secretKey,
          },
          body: JSON.stringify({ phone: cleanPhone }),
          signal: AbortSignal.timeout(3000),
        }
      );

      if (!response.ok) return null;
      const data: any = await response.json();
      const delivered = Number(
        data?.total_delivered ??
        data?.delivered ??
        data?.data?.total_delivered ??
        NaN
      );
      const returned = Number(
        data?.total_cancelled ??
        data?.returned ??
        data?.total_returned ??
        data?.data?.total_cancelled ??
        NaN
      );
      if (Number.isNaN(delivered) && Number.isNaN(returned)) return null;
      return {
        delivered: Number.isNaN(delivered) ? 0 : Math.max(0, delivered),
        returned: Number.isNaN(returned) ? 0 : Math.max(0, returned),
      };
    } catch {
      return null;
    }
  };

  // 5. Source C: Pathao Official Customer Success API (strict 3-second timeout)
  const requestPathaoHistory = async (): Promise<{ delivered: number; returned: number } | null> => {
    const clientId = storeConfig?.pathaoClientId?.trim();
    const clientSecret = storeConfig?.pathaoSecret?.trim();
    if (!clientId || !clientSecret) return null;

    if (!cachedPathaoTokenRef.attempted) {
      cachedPathaoTokenRef.attempted = true;
      try {
        const tokenRes = await getValidPathaoToken(storeConfig.shopDomain || "");
        cachedPathaoTokenRef.token = tokenRes.token;
      } catch {
        cachedPathaoTokenRef.token = null;
      }
    }

    if (!cachedPathaoTokenRef.token) return null;

    const baseUrl = getPathaoBaseUrl(storeConfig?.pathaoEnvironment);

    // Primary: Pathao Official /aladdin/api/v1/user/success POST endpoint
    try {
      const response = await fetch(`${baseUrl}/aladdin/api/v1/user/success`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${cachedPathaoTokenRef.token}`,
        },
        body: JSON.stringify({ phone: cleanPhone }),
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const data: any = await response.json();
        const pData = data?.data || data;
        const delivered = Number(
          pData?.successful_delivery ??
          pData?.total_delivered ??
          pData?.delivered ??
          NaN
        );
        const total = Number(
          pData?.total_delivery ??
          pData?.total_orders ??
          NaN
        );
        const returned = Number(
          pData?.returned_delivery ??
          pData?.total_returned ??
          pData?.returned ??
          (!Number.isNaN(total) && !Number.isNaN(delivered) ? Math.max(0, total - delivered) : NaN)
        );

        if (!Number.isNaN(delivered) || !Number.isNaN(returned)) {
          return {
            delivered: Number.isNaN(delivered) ? 0 : Math.max(0, delivered),
            returned: Number.isNaN(returned) ? 0 : Math.max(0, returned),
          };
        }
      }
    } catch {}

    // Fallback: Pathao /aladdin/api/v1/user-history GET endpoint
    try {
      const historyUrl = new URL(`${baseUrl}/aladdin/api/v1/user-history`);
      historyUrl.searchParams.set("phone", cleanPhone);

      const response = await fetch(historyUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${cachedPathaoTokenRef.token}`,
        },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) return null;
      const data: any = await response.json();
      const pData = data?.data || data;
      const delivered = Number(
        pData?.total_delivered ??
        pData?.success_count ??
        pData?.data?.total_delivered ??
        NaN
      );
      const returned = Number(
        pData?.total_returned ??
        pData?.return_count ??
        pData?.data?.total_returned ??
        NaN
      );
      if (Number.isNaN(delivered) && Number.isNaN(returned)) return null;
      return {
        delivered: Number.isNaN(delivered) ? 0 : Math.max(0, delivered),
        returned: Number.isNaN(returned) ? 0 : Math.max(0, returned),
      };
    } catch {
      return null;
    }
  };

  // Run external courier checks in parallel without blocking each other
  const [steadfastOutcome, pathaoOutcome] = await Promise.allSettled([
    requestSteadfastHistory(),
    requestPathaoHistory(),
  ]);

  const liveSteadfast =
    steadfastOutcome.status === "fulfilled" ? steadfastOutcome.value : null;
  const livePathao =
    pathaoOutcome.status === "fulfilled" ? pathaoOutcome.value : null;

  const hasSteadfastResult = liveSteadfast !== null;
  const hasPathaoResult = livePathao !== null;
  const hasInternalResult = internalDelivered > 0 || internalReturned > 0;
  const hasGenuineData = hasSteadfastResult || hasPathaoResult || hasInternalResult;

  // CRITICAL SAFEGUARD: If all external calls timed out/errored and no internal history exists,
  // NEVER write an empty 0/0 record into GlobalFraudNetwork! Return transient fallback.
  if (!hasGenuineData) {
    return {
      phone: cleanPhone,
      totalDelivered: 0,
      totalReturned: 0,
      totalOrders: 0,
      successRate: 100,
      fromCache: false,
      isTransientError: true,
    };
  }

  const steadfastDelivered = liveSteadfast?.delivered ?? 0;
  const steadfastReturned = liveSteadfast?.returned ?? 0;
  const pathaoDelivered = livePathao?.delivered ?? 0;
  const pathaoReturned = livePathao?.returned ?? 0;

  const totalDelivered = steadfastDelivered + pathaoDelivered + internalDelivered;
  const totalReturned = steadfastReturned + pathaoReturned + internalReturned;
  const totalOrders = totalDelivered + totalReturned;
  const successRate = totalOrders > 0 ? Math.round((totalDelivered / totalOrders) * 100) : 100;

  const savedProfile: any = await GlobalFraudNetwork.findOneAndUpdate(
    { phone: cleanPhone },
    {
      $set: {
        phone: cleanPhone,
        totalDelivered,
        totalReturned,
        totalOrders,
        successRate,
        steadfastDelivered,
        steadfastReturned,
        pathaoDelivered,
        pathaoReturned,
        dataSource: "multi_courier_live_sync",
        lastCheckedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return {
    phone: cleanPhone,
    totalDelivered: savedProfile?.totalDelivered ?? totalDelivered,
    totalReturned: savedProfile?.totalReturned ?? totalReturned,
    totalOrders: savedProfile?.totalOrders ?? totalOrders,
    successRate: savedProfile?.successRate ?? successRate,
    fromCache: false,
  };
}
