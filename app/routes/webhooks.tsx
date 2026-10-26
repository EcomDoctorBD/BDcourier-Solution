import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { connectDB, ShipmentBooking } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[Shopify Webhook] Received ${topic} for ${shop}`);

  if (!payload) {
    return new Response(null, { status: 200 });
  }

  const rawOrderId = payload.id;
  const adminGqlId = payload.admin_graphql_api_id;
  const numericId = rawOrderId ? String(rawOrderId).replace(/\D/g, "") : "";
  const gid = adminGqlId || (numericId ? `gid://shopify/Order/${numericId}` : "");
  const orderName = payload.name ? String(payload.name).trim() : "";

  // Normalize topic across different formatting conventions (e.g. orders/cancelled -> ORDERS_CANCELLED)
  const normalizedTopic = String(topic || "")
    .toUpperCase()
    .replace(/[\/\.]/g, "_");

  try {
    await connectDB();

    const orderQueryOr: any[] = [];
    if (gid) orderQueryOr.push({ orderId: gid });
    if (numericId) orderQueryOr.push({ orderId: numericId });
    if (orderName) orderQueryOr.push({ orderName: orderName });

    const orderFilter = orderQueryOr.length > 0
      ? { shopDomain: shop, $or: orderQueryOr }
      : { shopDomain: shop, orderId: gid || numericId };

    switch (normalizedTopic) {
      case "ORDERS_CANCELLED": {
        console.log(`[Webhook: ORDERS_CANCELLED] Processing cancellation for order ${orderName || numericId} on ${shop}`);
        await ShipmentBooking.updateMany(orderFilter, {
          $set: {
            courierStatus: "cancelled",
            deliveryStatus: "cancelled",
          },
        });
        break;
      }

      case "ORDERS_FULFILLED": {
        console.log(`[Webhook: ORDERS_FULFILLED] Processing fulfillment for order ${orderName || numericId} on ${shop}`);
        const fulfillments = Array.isArray(payload.fulfillments) ? payload.fulfillments : [];
        const latestFulfillment = fulfillments.length > 0 ? fulfillments[fulfillments.length - 1] : null;

        const trackingNumber =
          latestFulfillment?.tracking_number ||
          payload.tracking_number ||
          "";
        const trackingUrl =
          latestFulfillment?.tracking_url ||
          payload.tracking_url ||
          "";
        const courierCompany =
          latestFulfillment?.tracking_company ||
          payload.tracking_company ||
          "";

        const updateSet: Record<string, any> = {
          shopifySyncedPaidFulfilled: true,
          shopifySyncedAt: new Date(),
          deliveryStatus: "delivered",
        };

        if (trackingNumber) updateSet.trackingNumber = trackingNumber;
        if (trackingUrl) updateSet.trackingUrl = trackingUrl;
        if (courierCompany) updateSet.courierName = courierCompany;

        await ShipmentBooking.updateMany(orderFilter, {
          $set: updateSet,
        });
        break;
      }

      case "ORDERS_EDITED":
      case "ORDERS_UPDATED": {
        console.log(`[Webhook: ${normalizedTopic}] Refreshing updated order details for ${orderName || numericId} on ${shop}`);
        const updatedPrice =
          payload.current_total_price ||
          payload.total_price ||
          "";
        const addr = payload.shipping_address;
        const customerPhone =
          addr?.phone ||
          payload.customer?.phone ||
          "";
        const customerName =
          addr?.name ||
          [payload.customer?.first_name, payload.customer?.last_name]
            .filter(Boolean)
            .join(" ") ||
          "";
        const shippingAddress = addr
          ? [addr.address1, addr.address2, addr.city, addr.province, addr.zip]
              .filter(Boolean)
              .join(", ")
          : "";

        const updateSet: Record<string, any> = {};
        if (updatedPrice) updateSet.codAmount = String(updatedPrice);
        if (customerName) updateSet.customerName = customerName;
        if (customerPhone) updateSet.customerPhone = customerPhone;
        if (shippingAddress) updateSet.shippingAddress = shippingAddress;
        if (payload.note !== undefined && payload.note !== null) {
          updateSet.warehouseNote = payload.note;
        }

        // Check if an edit or update cancelled the order
        if (payload.cancelled_at) {
          updateSet.courierStatus = "cancelled";
          updateSet.deliveryStatus = "cancelled";
        }

        if (Object.keys(updateSet).length > 0) {
          await ShipmentBooking.updateMany(orderFilter, {
            $set: updateSet,
          });
        }
        break;
      }

      default:
        console.log(`[Webhook] Unhandled topic ${topic} received for ${shop}`);
        break;
    }
  } catch (err: any) {
    // Non-fatal safety trap: logs the error while always returning 200 OK to prevent Shopify webhook retries / failures
    console.warn(`[Webhook Error: ${topic}] Safe handler caught exception for order ${numericId}:`, err?.message || err);
  }

  return new Response(null, { status: 200 });
};
