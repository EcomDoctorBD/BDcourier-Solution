import crypto from "crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  connectDB,
  ShipmentBooking,
  CourierConfig,
  decryptCourierConfig,
} from "../db.server";
import { syncDeliveredBookingToShopify } from "../services/shopify-sync.server";

/**
 * Constant-time safe string comparison to prevent timing attacks
 */
function safeCompare(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  try {
    const bufA = Buffer.from(provided.trim(), "utf8");
    const bufB = Buffer.from(expected.trim(), "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * BAHOK COURIER WEBHOOK RECEIVER
 * Receives real-time parcel consignment status and COD disbursement updates from Bahok Courier.
 * Strictly scoped per { shopDomain } and verified with timing-safe secrets.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(
    JSON.stringify({
      status: "active",
      courier: "bahok",
      message: "Bahok Courier Webhook receiver is healthy and listening.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  await connectDB();

  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop")?.trim() || "";

  // 1. Enforce strict shopDomain requirement
  if (!shopDomain) {
    return new Response(
      JSON.stringify({ error: "Missing required shop parameter" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 2. Fetch and decrypt store courier config
  const rawConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
  if (!rawConfig) {
    return new Response(
      JSON.stringify({ error: "Store courier configuration not found" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const config = decryptCourierConfig(rawConfig);
  const webhookSecret = String(config?.webhookSecret || "").trim();
  const bahokWebhookSecret = String(config?.bahokWebhookSecret || "").trim();
  const bahokApiToken = String(config?.bahokApiToken || "").trim();
  const bahokApiKey = String(config?.bahokApiKey || "").trim();

  // 3. Extract provided token from Authorization header, URL token parameter, or signature headers
  const authHeader = request.headers.get("Authorization") || "";
  const tokenMatch = authHeader.match(/Bearer\s+(.+)/i);
  const bearerToken = tokenMatch ? tokenMatch[1].trim() : authHeader.trim();
  const queryToken = url.searchParams.get("token")?.trim() || "";
  const signatureHeader =
    request.headers.get("X-Bahok-Signature") ||
    request.headers.get("x-bahok-signature") ||
    request.headers.get("X-Webhook-Secret") ||
    request.headers.get("x-webhook-secret") ||
    request.headers.get("X-Api-Key") ||
    request.headers.get("x-api-key") ||
    "";

  // Parse payload safely
  let body: any = {};
  try {
    const rawText = await request.text();
    if (rawText) {
      body = JSON.parse(rawText);
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const bodySecret = String(
    body?.webhook_secret ||
    body?.secret ||
    body?.token ||
    body?.api_key ||
    body?.data?.webhook_secret ||
    ""
  ).trim();

  const providedTokens = [
    queryToken,
    bearerToken,
    signatureHeader,
    bodySecret,
  ].filter(Boolean);

  const allowedSecrets = [
    webhookSecret,
    bahokWebhookSecret,
    bahokApiToken,
    bahokApiKey,
  ].filter(Boolean);

  const isAuthenticated = providedTokens.some((provided) =>
    allowedSecrets.some((allowed) => safeCompare(provided, allowed))
  );

  if (!isAuthenticated) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: Invalid or missing webhook credentials" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 4. Extract consignment / order identifier
  const consignmentId = String(
    body?.tracking_id ||
    body?.data?.tracking_id ||
    body?.consignment_id ||
    body?.data?.consignment_id ||
    body?.tracking_code ||
    body?.data?.tracking_code ||
    body?.invoice ||
    body?.data?.invoice ||
    ""
  ).trim();

  const merchantOrderId = String(
    body?.merchant_order_id ||
    body?.data?.merchant_order_id ||
    body?.merchant_order_number ||
    body?.order_name ||
    body?.invoice_id ||
    ""
  ).trim();

  if (!consignmentId && !merchantOrderId) {
    return new Response(
      JSON.stringify({ error: "Missing tracking_id or merchant_order_id" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 5. Bahok Status Mapping & Normalization
  const rawStatus = String(
    body?.status ||
    body?.order_status ||
    body?.delivery_status ||
    body?.data?.status ||
    body?.data?.order_status ||
    body?.event ||
    ""
  ).toLowerCase().trim();

  let normalizedStatus = "in_transit";
  if (
    rawStatus === "paid" ||
    rawStatus === "disbursed" ||
    rawStatus.includes("disburs") ||
    rawStatus.includes("cod_paid")
  ) {
    normalizedStatus = "disbursed";
  } else if (
    rawStatus === "delivered" ||
    (rawStatus.includes("deliver") && !rawStatus.includes("fail") && !rawStatus.includes("partial"))
  ) {
    normalizedStatus = "delivered";
  } else if (rawStatus.includes("partial")) {
    normalizedStatus = "partial_delivery";
  } else if (
    rawStatus === "returned" ||
    rawStatus.includes("return")
  ) {
    normalizedStatus = "returned";
  } else if (
    rawStatus === "cancelled" ||
    rawStatus.includes("fail") ||
    rawStatus.includes("cancel")
  ) {
    normalizedStatus = "cancelled";
  } else if (rawStatus === "created" || rawStatus === "pending" || rawStatus === "booked") {
    normalizedStatus = "booked";
  } else if (
    rawStatus === "in_transit" ||
    rawStatus.includes("transit") ||
    rawStatus.includes("picked") ||
    rawStatus.includes("processing")
  ) {
    normalizedStatus = "in_transit";
  } else if (rawStatus) {
    normalizedStatus = rawStatus.replace(/[^a-z0-9_]/g, "_");
  }

  // 6. Multi-Tenant Query Conditions strictly scoped to shopDomain
  const queryConditions: any[] = [];
  if (consignmentId) {
    queryConditions.push({ trackingNumber: consignmentId });
  }
  if (merchantOrderId) {
    const cleanId = merchantOrderId.replace(/[^a-zA-Z0-9_-]/g, "");
    const baseId = cleanId.replace(/-R\d+$/i, "");
    queryConditions.push({
      orderName: { $regex: new RegExp("^#?(" + cleanId + "|" + baseId + ")$", "i") },
      courierKey: { $in: ["bahok", "Bahok", ""] },
    });
  }

  const isTerminalDelivered =
    normalizedStatus === "delivered" || normalizedStatus === "disbursed";
  const isReturnOrPartial =
    normalizedStatus === "returned" || normalizedStatus === "partial_delivery";

  // Prevent status downgrades: If parcel is already delivered/disbursed, do NOT downgrade to in_transit/picked
  const query: any = { shopDomain, $or: queryConditions };
  if (!isTerminalDelivered && !isReturnOrPartial) {
    query.courierStatus = { $nin: ["delivered", "disbursed"] };
  }

  const updateDoc: any = {
    courierStatus: normalizedStatus,
    deliveryStatus: normalizedStatus,
    updatedAt: new Date(),
  };

  // 7. Negative Cash Guard (Issue 9.2)
  const collectedAmountRaw =
    body?.collected_amount ??
    body?.cod_collected ??
    body?.cod_amount ??
    body?.amount ??
    body?.data?.collected_amount ??
    body?.data?.cod_collected;

  const parsedAmount = Number(collectedAmountRaw);
  if (
    collectedAmountRaw !== undefined &&
    collectedAmountRaw !== null &&
    collectedAmountRaw !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount >= 0 &&
    parsedAmount <= 10_000_000
  ) {
    updateDoc.courierCashCollected = parsedAmount.toFixed(2);
  }

  const updateResult = await ShipmentBooking.updateMany(query, { $set: updateDoc });

  // Historical isolation: If active tracking was not matched, update corresponding bookingHistory sub-document
  const bhConsignmentId = trackingCode || consignmentId;
  if (bhConsignmentId && (!updateResult.matchedCount || updateResult.matchedCount === 0)) {
    await ShipmentBooking.updateMany(
      { shopDomain, "bookingHistory.trackingNumber": bhConsignmentId },
      {
        $set: {
          "bookingHistory.$.courierStatus": normalizedStatus,
          "bookingHistory.$.deliveryStatus": normalizedStatus,
          updatedAt: new Date(),
        },
      }
    );
  }

  // 8. Strictly Await Shopify Paid & Fulfilled + Tagging sync on delivered/disbursed (Issue 9.1)
  if (isTerminalDelivered) {
    try {
      const matchingBookings = await ShipmentBooking.find({
        shopDomain,
        $or: queryConditions,
      }).lean();

      for (const booking of matchingBookings) {
        if (booking.shopDomain === shopDomain && booking.trackingNumber) {
          try {
            await syncDeliveredBookingToShopify(booking);
          } catch (syncErr: any) {
            console.warn(
              `[Bahok Webhook] Delivery sync error for ${booking.orderId}:`,
              syncErr?.message
            );
          }
        }
      }
    } catch (err: any) {
      console.warn(
        "[Bahok Webhook] Error querying matching bookings for sync:",
        err?.message
      );
    }
  }

  return new Response(
    JSON.stringify({
      status: "success",
      matched_count: updateResult.matchedCount ?? updateResult.n ?? 0,
      tracking_id: consignmentId,
      courier_status: normalizedStatus,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
