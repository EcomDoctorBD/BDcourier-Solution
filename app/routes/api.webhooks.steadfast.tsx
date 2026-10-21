import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { connectDB, ShipmentBooking, CourierConfig } from "../db.server";
import { syncDeliveredBookingToShopify } from "../services/shopify-sync.server";

/**
 * STEADFAST COURIER WEBHOOK RECEIVER
 * Receives real-time parcel consignment status and COD updates from Steadfast
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
  const shopQuery = url.searchParams.get("shop")?.trim() || "";

  // Verify Bearer token if provided in Authorization header
  const authHeader = request.headers.get("Authorization") || "";
  const tokenMatch = authHeader.match(/Bearer\s+(.+)/i);
  const providedToken = tokenMatch ? tokenMatch[1].trim() : "";

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

  const consignmentId = String(body?.consignment_id || "").trim();
  const invoice = String(body?.invoice || "").trim();
  const rawStatus = String(body?.status || "").toLowerCase().trim();
  const codAmount = body?.cod_amount;

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

  // Locate matching ShipmentBooking in MongoDB
  const queryConditions: any[] = [];
  if (consignmentId) {
    queryConditions.push({ trackingNumber: consignmentId });
  }
  if (invoice) {
    const cleanInvoice = invoice.replace(/[^a-zA-Z0-9_-]/g, "");
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

    if (codAmount !== undefined && codAmount !== null && !Number.isNaN(Number(codAmount))) {
      updateDoc.courierCashCollected = Number(codAmount).toFixed(2);
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
                `[Steadfast Webhook] Delivery sync error for ${booking.orderId}:`,
                err?.message
              )
            );
          }
        })
        .catch((err) =>
          console.warn(
            "[Steadfast Webhook] Error querying matching bookings for sync:",
            err?.message
          )
        );
    }
  }

  return new Response(
    JSON.stringify({
      status: "success",
      message: "Webhook received",
      consignment_id: consignmentId,
      courier_status: normalizedStatus,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
