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
 * REDX COURIER WEBHOOK RECEIVER
 * Receives real-time parcel consignment status updates from RedX.
 * Strictly scoped per { shopDomain } and verified with timing-safe secrets.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(
    JSON.stringify({
      status: "active",
      courier: "redx",
      message: "RedX Webhook receiver is healthy and listening.",
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
  const webhookSecret = String(config?.webhookSecret || "").trim();
  const redxAccessToken = String(config?.redxAccessToken || "").trim();

  // 3. Extract provided token from query, Authorization, or custom headers
  const authHeader = request.headers.get("Authorization") || "";
  const tokenMatch = authHeader.match(/Bearer\s+(.+)/i);
  const bearerToken = tokenMatch ? tokenMatch[1].trim() : authHeader.trim();
  const queryToken = url.searchParams.get("token")?.trim() || "";
  const redxSignature =
    request.headers.get("x-redx-signature") ||
    request.headers.get("X-REDX-SIGNATURE") ||
    request.headers.get("x-webhook-secret") ||
    request.headers.get("api-access-token") ||
    "";

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

  const bodySecret = String(body?.token || body?.secret || "").trim();
  const providedTokens = [queryToken, bearerToken, redxSignature, bodySecret].filter(Boolean);
  const allowedSecrets = [webhookSecret, redxAccessToken].filter(Boolean);

  const isAuthenticated = providedTokens.some((provided) =>
    allowedSecrets.some((secret) => safeCompare(provided, secret))
  );

  if (!isAuthenticated) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: Invalid or missing webhook token" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const trackingId = String(
    body?.tracking_id || body?.parcel?.tracking_id || body?.data?.tracking_id || ""
  ).trim();
  const merchantInvoiceId = String(
    body?.merchant_invoice_id || body?.parcel?.merchant_invoice_id || ""
  ).trim();
  const rawStatus = String(
    body?.status || body?.parcel?.status || ""
  ).toLowerCase().trim();

  if (!trackingId && !merchantInvoiceId) {
    return new Response(
      JSON.stringify({ error: "Missing tracking_id or merchant_invoice_id" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const collectedAmount =
    body?.collected_amount ?? body?.parcel?.collected_amount ?? body?.data?.collected_amount;

  // Normalize RedX Delivery Status
  let normalizedStatus = "in_transit";
  if (rawStatus.includes("deliver") && !rawStatus.includes("partial") && !rawStatus.includes("cancel")) {
    normalizedStatus = "delivered";
  } else if (rawStatus.includes("partial")) {
    normalizedStatus = "partial_delivery";
  } else if (rawStatus.includes("return")) {
    normalizedStatus = "returned";
  } else if (rawStatus.includes("cancel") || rawStatus.includes("fail")) {
    normalizedStatus = "cancelled";
  } else if (
    rawStatus.includes("transit") ||
    rawStatus.includes("pickup") ||
    rawStatus.includes("ready")
  ) {
    normalizedStatus = "in_transit";
  } else if (rawStatus) {
    normalizedStatus = rawStatus.replace(/[^a-z0-9_]/g, "_");
  }

  // Locate matching ShipmentBooking strictly scoped to shopDomain
  const queryConditions: any[] = [];
  if (trackingId) {
    queryConditions.push({ trackingNumber: trackingId });
  }
  if (merchantInvoiceId) {
    const cleanInvoice = merchantInvoiceId.replace(/[^a-zA-Z0-9_-]/g, "");
    queryConditions.push({ orderName: { $regex: new RegExp(`^#?${cleanInvoice}$`, "i") } });
  }

  const query = { shopDomain, $or: queryConditions };

  const updateDoc: any = {
    courierStatus: normalizedStatus,
    updatedAt: new Date(),
  };

  if (collectedAmount !== undefined && collectedAmount !== null && !Number.isNaN(Number(collectedAmount))) {
    updateDoc.courierCashCollected = Number(collectedAmount).toFixed(2);
  }

  if (normalizedStatus === "delivered") {
    updateDoc.shopifySyncedPaidFulfilled = true;
  }

  const updateResult = await ShipmentBooking.updateMany(query, { $set: updateDoc });

  // Non-blocking Shopify Paid & Fulfilled + Tagging sync when verified delivered or disbursed
  if (normalizedStatus === "delivered" || normalizedStatus === "disbursed") {
    ShipmentBooking.find(query)
      .lean()
      .then((matchingBookings) => {
        for (const booking of matchingBookings) {
          if (booking.shopDomain === shopDomain && booking.trackingNumber) {
            syncDeliveredBookingToShopify(booking).catch((err) =>
              console.warn(
                `[RedX Webhook] Delivery sync error for ${booking.orderId}:`,
                err?.message
              )
            );
          }
        }
      })
      .catch((err) =>
        console.warn(
          "[RedX Webhook] Error querying matching bookings for sync:",
          err?.message
        )
      );
  }

  return new Response(
    JSON.stringify({
      status: "success",
      matched_count: updateResult.matchedCount ?? updateResult.n ?? 0,
      tracking_id: trackingId,
      courier_status: normalizedStatus,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
