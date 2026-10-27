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

  // 4. Master Audit Point 10: Enforce strict cryptographic HMAC signature and token verification
  const validation = validateWebhookRequest({
    rawBody: rawText,
    candidateSecrets: [expectedSecret, pathaoSecret, config?.pathaoClientId, config?.pathaoClientSecret],
    providedSignatures: [
      signatureHeader,
      request.headers.get("X-Signature"),
      request.headers.get("x-signature"),
    ],
    providedTokens: [
      integrationSecretHeader,
      queryToken,
      bearerToken,
      bodySecret,
      body?.secret,
    ],
  });

  if (!validation.isValid) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized: Webhook signature or authorization token verification failed",
        reason: validation.reason,
      }),
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
    const baseId = cleanId.replace(/-R\d+$/i, "");
    queryConditions.push({
      orderName: { $regex: new RegExp("^#?(" + cleanId + "|" + baseId + ")$", "i") },
      courierKey: { $in: ["pathao", "Pathao", ""] },
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
  if (consignmentId && (!updateResult.matchedCount || updateResult.matchedCount === 0)) {
    await ShipmentBooking.updateMany(
      { shopDomain, "bookingHistory.trackingNumber": consignmentId },
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
              `[Pathao Webhook] Delivery sync error for ${booking.orderId}:`,
              syncErr?.message
            );
          }
        }
      }
    } catch (err: any) {
      console.warn(
        "[Pathao Webhook] Error querying matching bookings for sync:",
        err?.message
      );
    }
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
