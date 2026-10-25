import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { connectDB, ShipmentBooking } from "../db.server";

/**
 * MANDATORY SHOPIFY GDPR WEBHOOK: customers/redact
 * Redacts personal customer data (PII) from shipment booking records.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[GDPR Compliance] Received ${topic} for ${shop}`);

  await connectDB();

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

  return json({
    redacted: true,
    topic,
    shop,
  });
};
