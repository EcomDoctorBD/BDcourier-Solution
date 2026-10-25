import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { connectDB, ShipmentBooking } from "../db.server";

/**
 * MANDATORY SHOPIFY GDPR WEBHOOK: customers/data_request
 * Returns customer data stored in the app when requested by customer or merchant.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[GDPR Compliance] Received ${topic} for ${shop}`);

  await connectDB();

  const ordersRequested = payload?.orders_requested || [];
  let recordCount = 0;

  if (Array.isArray(ordersRequested) && ordersRequested.length > 0) {
    const records = await ShipmentBooking.find({
      shopDomain: shop,
      orderId: { $in: ordersRequested.map(String) },
    }).lean();
    recordCount = records.length;
  }

  return json({
    received: true,
    topic,
    shop,
    recordsCount: recordCount,
  });
};
