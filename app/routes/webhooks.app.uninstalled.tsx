import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, sessionStorage } from "../shopify.server";
import {
  connectDB,
  CourierConfig,
  MerchantIntegrations,
} from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // 1. Delete session from Shopify Session Storage
  if (session) {
    try {
      await sessionStorage.deleteSession(session.id);
    } catch (sessionErr) {
      console.warn(`Could not delete session ${session.id}:`, sessionErr);
    }
  }

  // 2. Scrub sensitive third-party credentials immediately upon uninstall (Issue 7.2)
  try {
    await connectDB();

    await CourierConfig.updateOne(
      { shopDomain: shop },
      {
        $set: {
          pathaoSecret: "",
          pathaoPassword: "",
          pathaoAccessToken: "",
          pathaoRefreshToken: "",
          steadfastSecretKey: "",
          redxAccessToken: "",
          webhookSecret: "",
          billingStatus: "UNINSTALLED",
          currentPlan: "Free",
        },
      }
    );

    await MerchantIntegrations.updateOne(
      { merchantId: shop },
      {
        $set: {
          googleAccessToken: "",
          googleRefreshToken: "",
          googleTokenExpiry: null,
          autoSyncEnabled: false,
          lastSyncStatus: "IDLE",
        },
      }
    );
  } catch (dbErr) {
    console.error(`Error scrubbing credentials for uninstalled shop ${shop}:`, dbErr);
  }

  return new Response(null, { status: 200 });
};
