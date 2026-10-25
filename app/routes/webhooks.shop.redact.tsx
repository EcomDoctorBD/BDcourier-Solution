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
 * MANDATORY SHOPIFY GDPR WEBHOOK: shop/redact
 * Fired 48 hours after uninstall to erase all merchant data across collections.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[GDPR Compliance] Received ${topic} for ${shop}. Erasing tenant data...`);

  await connectDB();

  await Promise.allSettled([
    CourierConfig.deleteMany({ shopDomain: shop }),
    MerchantIntegrations.deleteMany({ merchantId: shop }),
    ShipmentBooking.deleteMany({ shopDomain: shop }),
    ShippingZone.deleteMany({ merchantId: shop }),
  ]);

  return json({
    shopRedacted: true,
    topic,
    shop,
  });
};
