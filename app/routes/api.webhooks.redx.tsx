import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { connectDB, ShipmentBooking, CourierConfig } from "../db.server";
import { syncDeliveredBookingToShopify } from "../services/shopify-sync.server";

/**
 * REDX COURIER WEBHOOK RECEIVER
 * Receives real-time parcel consignment status updates from RedX
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
  const shopQuery = url.searchParams.get("shop")?.trim() || "";

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

  const trackingId = String(
    body?.tracking_id || body?.parcel?.tracking_id || body?.data?.tracking_id || ""
  ).trim();
  const merchantInvoiceId = String(
    body?.merchant_invoice_id || body?.parcel?.merchant_invoice_id || ""
  ).trim();
  const rawStatus = String(
    body?.status || body?.parcel?.status || ""
  ).toLowerCase().trim();

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

  // Locate matching ShipmentBooking in MongoDB
  const queryConditions: any[] = [];
  if (trackingId) {
    queryConditions.push({ trackingNumber: trackingId });
  }
  if (merchantInvoiceId) {
    const cleanInvoice = merchantInvoiceId.replace(/[^a-zA-Z0-9_-]/g, "");
    queryConditions.push({ orderName: { $regex: new RegExp(cleanInvoice, "i") } });
  }

  if (queryConditions.length > 0) {
    const query = shopQuery
      ? { shopDomain: shopQuery, $or: queryConditions }
      : { $or: queryConditions };

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

    await ShipmentBooking.updateMany(query, { $set: updateDoc });

    // Non-blocking Shopify Paid & Fulfilled + Tagging sync when delivered or disbursed
    if (normalizedStatus === "delivered" || normalizedStatus === "disbursed") {
      ShipmentBooking.find(query)
        .lean()
        .then((matchingBookings) => {
          for (const booking of matchingBookings) {
            syncDeliveredBookingToShopify(booking).catch((err) =>
              console.warn(
                `[RedX Webhook] Delivery sync error for ${booking.orderId}:`,
                err?.message
              )
            );
          }
        })
        .catch((err) =>
          console.warn(
            "[RedX Webhook] Error querying matching bookings for sync:",
            err?.message
          )
        );
    }
  }

  return new Response(
    JSON.stringify({
      received: true,
      tracking_id: trackingId,
      courier_status: normalizedStatus,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
