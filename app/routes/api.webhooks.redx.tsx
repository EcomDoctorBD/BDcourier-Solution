import crypto from "crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  connectDB,
  ShipmentBooking,
  CourierConfig,
  decryptCourierConfig,
} from "../db.server";
import { syncDeliveredBookingToShopify } from "../services/shopify-sync.server";
import { validateWebhookRequest, safeCompare } from "../services/webhook-security.server";

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

  let rawText = "";
  let body: any = {};
  try {
    rawText = await request.text();
    if (rawText) {
      body = JSON.parse(rawText);
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Extract provided token / signature from query, Authorization, or custom headers
  const authHeader = request.headers.get("Authorization") || "";
  const tokenMatch = authHeader.match(/Bearer\s+(.+)/i);
  const bearerToken = tokenMatch ? tokenMatch[1].trim() : authHeader.trim();
  const queryToken = url.searchParams.get("token")?.trim() || "";
  const redxSignature =
    request.headers.get("x-redx-signature") ||
    request.headers.get("X-REDX-SIGNATURE") ||
    "";
  const bodySecret = String(body?.token || body?.secret || "").trim();

  // Master Audit Point 10: Enforce strict cryptographic signature & token verification gate
  const validation = validateWebhookRequest({
    rawBody: rawText,
    candidateSecrets: [webhookSecret, redxAccessToken],
    providedSignatures: [
      redxSignature,
      request.headers.get("X-Signature"),
      request.headers.get("x-signature"),
    ],
    providedTokens: [
      queryToken,
      bearerToken,
      request.headers.get("api-access-token"),
      request.headers.get("API-ACCESS-TOKEN"),
      request.headers.get("x-webhook-secret"),
      bodySecret,
    ],
  });

  if (!validation.isValid) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized: Invalid or missing webhook signature/token",
        reason: validation.reason,
      }),
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
    const baseInvoice = cleanInvoice.replace(/-R\d+$/i, "");
    queryConditions.push({
      orderName: { $regex: new RegExp("^#?(" + cleanInvoice + "|" + baseInvoice + ")$", "i") },
      courierKey: { $in: ["redx", "RedX", "red_x", ""] },
    });
  }

  const isTerminalDelivered = normalizedStatus === "delivered" || normalizedStatus === "disbursed";
  const isReturnOrPartial = normalizedStatus === "returned" || normalizedStatus === "partial_delivery";

  // Prevent status downgrades: If parcel is already delivered/disbursed, do NOT downgrade to in_transit/pending
  const query: any = { shopDomain, $or: queryConditions };
  if (!isTerminalDelivered && !isReturnOrPartial) {
    query.courierStatus = { $nin: ["delivered", "disbursed"] };
  }

  const updateDoc: any = {
    courierStatus: normalizedStatus,
    deliveryStatus: normalizedStatus,
    updatedAt: new Date(),
  };

  // Block negative or invalid cash amounts (Issue 9.2)
  const parsedAmount = Number(collectedAmount);
  if (
    collectedAmount !== undefined &&
    collectedAmount !== null &&
    collectedAmount !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount >= 0 &&
    parsedAmount <= 10_000_000
  ) {
    updateDoc.courierCashCollected = parsedAmount.toFixed(2);
  }

  const updateResult = await ShipmentBooking.updateMany(query, { $set: updateDoc });

  // Historical isolation: If active tracking was not matched, update corresponding bookingHistory sub-document
  if (trackingId && (!updateResult.matchedCount || updateResult.matchedCount === 0)) {
    await ShipmentBooking.updateMany(
      { shopDomain, "bookingHistory.trackingNumber": trackingId },
      {
        $set: {
          "bookingHistory.$.courierStatus": normalizedStatus,
          "bookingHistory.$.deliveryStatus": normalizedStatus,
          updatedAt: new Date(),
        },
      }
    );
  }

  // Await Shopify Paid & Fulfilled + Tagging sync when verified delivered or disbursed (Issue 9.1)
  if (isTerminalDelivered) {
    try {
      const matchingBookings = await ShipmentBooking.find({ shopDomain, $or: queryConditions }).lean();
      for (const booking of matchingBookings) {
        if (booking.shopDomain === shopDomain && booking.trackingNumber) {
          try {
            await syncDeliveredBookingToShopify(booking);
          } catch (syncErr: any) {
            console.warn(
              `[RedX Webhook] Delivery sync error for ${booking.orderId}:`,
              syncErr?.message
            );
          }
        }
      }
    } catch (err: any) {
      console.warn(
        "[RedX Webhook] Error querying matching bookings for sync:",
        err?.message
      );
    }
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
