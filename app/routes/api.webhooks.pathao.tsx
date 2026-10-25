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
 * PATHAO COURIER WEBHOOK RECEIVER
 * Receives real-time parcel consignment status updates from Pathao.
 * Strictly scoped per { shopDomain } and verified with timing-safe secrets.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(
    JSON.stringify({
      status: "active",
      courier: "pathao",
      message: "Pathao Webhook receiver is healthy and listening.",
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
        status: 400,
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
  const expectedSecret = String(config?.webhookSecret || "").trim();
  const pathaoSecret = String(config?.pathaoSecret || "").trim();

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

  // Extract provided tokens / secrets from headers, query params, or payload
  const authHeader = request.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const integrationSecretHeader =
    request.headers.get("X-Pathao-Merchant-Webhook-Integration-Secret") ||
    request.headers.get("x-pathao-merchant-webhook-integration-secret") ||
    "";
  const signatureHeader =
    request.headers.get("X-Pathao-Signature") ||
    request.headers.get("x-pathao-signature") ||
    "";
  const queryToken = url.searchParams.get("token")?.trim() || "";
  const bodySecret = String(body?.webhook_integration_secret || "").trim();

  const providedSecrets = [
    integrationSecretHeader,
    queryToken,
    bearerToken,
    signatureHeader,
    bodySecret,
  ].filter(Boolean);

  // 3. Handle Pathao Handshake Ping (event: webhook_integration or webhook_test)
  const event = String(body?.event || "").toLowerCase().trim();
  const isHandshake =
    event === "webhook_integration" ||
    event === "webhook_test" ||
    Boolean(body?.webhook_integration_secret) ||
    Boolean(integrationSecretHeader);

  if (isHandshake) {
    if (!expectedSecret) {
      return new Response(
        JSON.stringify({ error: "No webhook secret configured for store" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Pathao expects HTTP 202 and the merchant's secret echoed in X-Pathao-Merchant-Webhook-Integration-Secret
    return new Response(
      JSON.stringify({
        status: "success",
        message: "Pathao webhook URL verified successfully.",
      }),
      {
        status: 202,
        headers: {
          "Content-Type": "application/json",
          "X-Pathao-Merchant-Webhook-Integration-Secret": expectedSecret,
        },
      }
    );
  }

  // 4. Enforce strict authentication for live status events
  const isSecretValid = providedSecrets.some(
    (provided) =>
      safeCompare(provided, expectedSecret) ||
      (pathaoSecret && safeCompare(provided, pathaoSecret))
  );

  if (!isSecretValid) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: Invalid or missing webhook secret" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 5. Process Live Status Event with Strict Multi-Tenant Scoping
  const consignmentId = String(
    body?.consignment_id || body?.data?.consignment_id || ""
  ).trim();
  const merchantOrderId = String(
    body?.merchant_order_id || body?.data?.merchant_order_id || ""
  ).trim();
  const rawStatus = String(
    body?.order_status || body?.event || body?.data?.order_status || ""
  ).toLowerCase().trim();

  if (!consignmentId && !merchantOrderId) {
    return new Response(
      JSON.stringify({ error: "Missing consignment_id or merchant_order_id" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const collectedAmountRaw =
    body?.collected_amount ??
    body?.amount_to_collect ??
    body?.data?.collected_amount ??
    body?.data?.amount_to_collect;

  // Normalize Pathao Status
  let normalizedStatus = "in_transit";
  if (
    rawStatus.includes("deliver") &&
    !rawStatus.includes("partial") &&
    !rawStatus.includes("fail")
  ) {
    normalizedStatus = "delivered";
  } else if (rawStatus.includes("partial")) {
    normalizedStatus = "partial_delivery";
  } else if (rawStatus.includes("return")) {
    normalizedStatus = "returned";
  } else if (rawStatus.includes("fail") || rawStatus.includes("cancel")) {
    normalizedStatus = "cancelled";
  } else if (
    rawStatus.includes("transit") ||
    rawStatus.includes("pickup") ||
    rawStatus.includes("created")
  ) {
    normalizedStatus = "in_transit";
  } else if (rawStatus) {
    normalizedStatus = rawStatus.replace(/[^a-z0-9_]/g, "_");
  }

  // Locate matching ShipmentBooking strictly scoped to shopDomain
  const queryConditions: any[] = [];
  if (consignmentId) {
    queryConditions.push({ trackingNumber: consignmentId });
  }
  if (merchantOrderId) {
    const cleanId = merchantOrderId.replace(/[^a-zA-Z0-9_-]/g, "");
    queryConditions.push({ orderName: { $regex: new RegExp(`^#?${cleanId}$`, "i") } });
  }

  const query = { shopDomain, $or: queryConditions };

  const updateDoc: any = {
    courierStatus: normalizedStatus,
    updatedAt: new Date(),
  };

  if (
    collectedAmountRaw !== undefined &&
    collectedAmountRaw !== null &&
    !Number.isNaN(Number(collectedAmountRaw))
  ) {
    updateDoc.courierCashCollected = Number(collectedAmountRaw).toFixed(2);
  }

  if (normalizedStatus === "delivered") {
    updateDoc.shopifySyncedPaidFulfilled = true;
  }

  const updateResult = await ShipmentBooking.updateMany(query, { $set: updateDoc });

  // Non-blocking Shopify Paid & Fulfilled + Tagging sync ONLY when verified delivered/disbursed
  if (normalizedStatus === "delivered" || normalizedStatus === "disbursed") {
    ShipmentBooking.find(query)
      .lean()
      .then((matchingBookings) => {
        for (const booking of matchingBookings) {
          if (booking.shopDomain === shopDomain && booking.trackingNumber) {
            syncDeliveredBookingToShopify(booking).catch((err) =>
              console.warn(
                `[Pathao Webhook] Delivery sync error for ${booking.orderId}:`,
                err?.message
              )
            );
          }
        }
      })
      .catch((err) =>
        console.warn(
          "[Pathao Webhook] Error querying matching bookings for sync:",
          err?.message
        )
      );
  }

  return new Response(
    JSON.stringify({
      status: "success",
      matched_count: updateResult.matchedCount ?? updateResult.n ?? 0,
      consignment_id: consignmentId,
      courier_status: normalizedStatus,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
