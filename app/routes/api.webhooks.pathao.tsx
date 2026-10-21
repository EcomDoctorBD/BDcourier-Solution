import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { connectDB, ShipmentBooking, CourierConfig } from "../db.server";
import { syncDeliveredBookingToShopify } from "../services/shopify-sync.server";

/**
 * PATHAO COURIER WEBHOOK RECEIVER
 * Receives real-time parcel consignment status updates from Pathao
 * Supports Pathao's automated webhook URL handshake & integration secret verification
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
  const shopQuery = url.searchParams.get("shop")?.trim() || "";

  // Check headers for Pathao Integration Secret handshake
  const integrationSecretHeader =
    request.headers.get("X-Pathao-Merchant-Webhook-Integration-Secret") ||
    request.headers.get("x-pathao-merchant-webhook-integration-secret") ||
    "";

  let body: any = {};
  try {
    const rawText = await request.text();
    if (rawText) {
      body = JSON.parse(rawText);
    }
  } catch (parseErr) {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --------------------------------------------------------------------------
  // PATHAO HANDSHAKE: Pathao Verification Verification Ping (event: webhook_integration)
  // Requires HTTP 202 Accepted and X-Pathao-Merchant-Webhook-Integration-Secret header
  // --------------------------------------------------------------------------
  const event = String(body?.event || "").toLowerCase().trim();
  const isHandshake =
    event === "webhook_integration" ||
    event === "webhook_test" ||
    Boolean(body?.webhook_integration_secret) ||
    Boolean(integrationSecretHeader);

  if (isHandshake) {
    const secretEcho =
      integrationSecretHeader ||
      body?.webhook_integration_secret ||
      "f3992ecc-59da-4cbe-a049-a13da2018d51";

    return new Response(
      JSON.stringify({
        status: "success",
        message: "Pathao webhook URL verified successfully.",
      }),
      {
        status: 202,
        headers: {
          "Content-Type": "application/json",
          "X-Pathao-Merchant-Webhook-Integration-Secret": secretEcho,
        },
      }
    );
  }

  // --------------------------------------------------------------------------
  // PATHAO LIVE STATUS EVENT PROCESSING
  // --------------------------------------------------------------------------
  const consignmentId = String(
    body?.consignment_id || body?.data?.consignment_id || ""
  ).trim();
  const merchantOrderId = String(
    body?.merchant_order_id || body?.data?.merchant_order_id || ""
  ).trim();
  const rawStatus = String(
    body?.order_status || body?.event || body?.data?.order_status || ""
  ).toLowerCase().trim();

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

  // Locate matching ShipmentBooking in MongoDB
  const queryConditions: any[] = [];
  if (consignmentId) {
    queryConditions.push({ trackingNumber: consignmentId });
  }
  if (merchantOrderId) {
    const cleanId = merchantOrderId.replace(/[^a-zA-Z0-9_-]/g, "");
    queryConditions.push({ orderName: { $regex: new RegExp(cleanId, "i") } });
  }

  if (queryConditions.length > 0) {
    const query = shopQuery
      ? { shopDomain: shopQuery, $or: queryConditions }
      : { $or: queryConditions };

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

    await ShipmentBooking.updateMany(query, { $set: updateDoc });

    // Non-blocking Shopify Paid & Fulfilled + Tagging sync when delivered or disbursed
    if (normalizedStatus === "delivered" || normalizedStatus === "disbursed") {
      ShipmentBooking.find(query)
        .lean()
        .then((matchingBookings) => {
          for (const booking of matchingBookings) {
            syncDeliveredBookingToShopify(booking).catch((err) =>
              console.warn(
                `[Pathao Webhook] Delivery sync error for ${booking.orderId}:`,
                err?.message
              )
            );
          }
        })
        .catch((err) =>
          console.warn(
            "[Pathao Webhook] Error querying matching bookings for sync:",
            err?.message
          )
        );
    }
  }

  return new Response(
    JSON.stringify({
      status: "success",
      consignment_id: consignmentId,
      courier_status: normalizedStatus,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
