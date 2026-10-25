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
 * STEADFAST COURIER WEBHOOK RECEIVER
 * Receives real-time parcel consignment status and COD updates from Steadfast.
 * Strictly scoped per { shopDomain } and verified with timing-safe secrets.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(
    JSON.stringify({
      status: "active",
      courier: "steadfast",
      message: "Steadfast Webhook receiver is healthy and listening.",
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
  const steadfastApiKey = String(config?.steadfastApiKey || "").trim();
  const steadfastSecretKey = String(config?.steadfastSecretKey || "").trim();

  // 3. Extract provided token from Authorization header or URL token parameter
  const authHeader = request.headers.get("Authorization") || "";
  const tokenMatch = authHeader.match(/Bearer\s+(.+)/i);
  const bearerToken = tokenMatch ? tokenMatch[1].trim() : authHeader.trim();
  const queryToken = url.searchParams.get("token")?.trim() || "";
  const headerToken =
    request.headers.get("X-Steadfast-Token") ||
    request.headers.get("x-steadfast-token") ||
    request.headers.get("x-webhook-secret") ||
    "";

  const providedTokens = [queryToken, bearerToken, headerToken].filter(Boolean);
  const allowedSecrets = [webhookSecret, steadfastApiKey, steadfastSecretKey].filter(Boolean);

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

  const consignmentId = String(body?.consignment_id || "").trim();
  const invoice = String(body?.invoice || "").trim();
  const rawStatus = String(body?.status || "").toLowerCase().trim();
  const codAmount = body?.cod_amount;

  if (!consignmentId && !invoice) {
    return new Response(
      JSON.stringify({ error: "Missing consignment_id or invoice" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Normalize Steadfast Delivery Status
  let normalizedStatus = "in_transit";
  if (rawStatus.includes("deliver") && !rawStatus.includes("partial") && !rawStatus.includes("cancel")) {
    normalizedStatus = "delivered";
  } else if (rawStatus.includes("partial")) {
    normalizedStatus = "partial_delivery";
  } else if (rawStatus.includes("cancel") || rawStatus.includes("return")) {
    normalizedStatus = "cancelled";
  } else if (rawStatus.includes("transit") || rawStatus.includes("review") || rawStatus.includes("pending")) {
    normalizedStatus = "in_transit";
  } else if (rawStatus) {
    normalizedStatus = rawStatus.replace(/[^a-z0-9_]/g, "_");
  }

  // Locate matching ShipmentBooking strictly scoped to shopDomain
  const queryConditions: any[] = [];
  if (consignmentId) {
    queryConditions.push({ trackingNumber: consignmentId });
  }
  if (invoice) {
    const cleanInvoice = invoice.replace(/[^a-zA-Z0-9_-]/g, "");
    queryConditions.push({ orderName: { $regex: new RegExp(`^#?${cleanInvoice}$`, "i") } });
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
  const parsedAmount = Number(codAmount);
  if (
    codAmount !== undefined &&
    codAmount !== null &&
    codAmount !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount >= 0 &&
    parsedAmount <= 10_000_000
  ) {
    updateDoc.courierCashCollected = parsedAmount.toFixed(2);
  }

  const updateResult = await ShipmentBooking.updateMany(query, { $set: updateDoc });

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
              `[Steadfast Webhook] Delivery sync error for ${booking.orderId}:`,
              syncErr?.message
            );
          }
        }
      }
    } catch (err: any) {
      console.warn(
        "[Steadfast Webhook] Error querying matching bookings for sync:",
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
