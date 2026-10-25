import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  connectDB,
  CourierConfig,
  MerchantIntegrations,
  ShipmentBooking,
  ShippingZone,
} from "../db.server";

/**
 * MANDATORY SHOPIFY GDPR WEBHOOK UNIFIED ENDPOINT: /webhooks/compliance
 * Handles customers/data_request, customers/redact, and shop/redact.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[GDPR Compliance Unified] Received ${topic} for ${shop}`);

  await connectDB();

  const normalizedTopic = String(topic).toLowerCase().replace(/_/g, "/");

  if (normalizedTopic.includes("data_request")) {
    const ordersRequested = payload?.orders_requested || [];
    let recordCount = 0;
    if (Array.isArray(ordersRequested) && ordersRequested.length > 0) {
      const records = await ShipmentBooking.find({
        shopDomain: shop,
        orderId: { $in: ordersRequested.map(String) },
      }).lean();
      recordCount = records.length;
    }
    return json({ received: true, topic, shop, recordsCount: recordCount });
  }

  if (normalizedTopic.includes("customers/redact")) {
    const ordersToRedact = payload?.orders_to_redact || [];
    const customerPhone = payload?.customer?.phone;
    const redactConditions: any[] = [];
    if (Array.isArray(ordersToRedact) && ordersToRedact.length > 0) {
      redactConditions.push({ orderId: { $in: ordersToRedact.map(String) } });
    }
    if (customerPhone) {
      redactConditions.push({ customerPhone: String(customerPhone).trim() });
    }
    if (redactConditions.length > 0) {
      await ShipmentBooking.updateMany(
        { shopDomain: shop, $or: redactConditions },
        {
          $set: {
            customerName: "[REDACTED]",
            customerPhone: "[REDACTED]",
            shippingAddress: "[REDACTED]",
          },
        }
      );
    }
    return json({ redacted: true, topic, shop });
  }

  if (normalizedTopic.includes("shop/redact")) {
    await Promise.allSettled([
      CourierConfig.deleteMany({ shopDomain: shop }),
      MerchantIntegrations.deleteMany({ merchantId: shop }),
      ShipmentBooking.deleteMany({ shopDomain: shop }),
      ShippingZone.deleteMany({ merchantId: shop }),
    ]);
    return json({ shopRedacted: true, topic, shop });
  }

  return json({ received: true, topic, shop });
};
