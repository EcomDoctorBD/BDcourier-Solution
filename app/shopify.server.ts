import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";

const fallbackUri = "mongodb://127.0.0.1:27017/shopify_app";
const mongoUri =
  process.env.MONGODB_URI?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  fallbackUri;

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = mongoUri;
}
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = mongoUri;
}

// Parse the database name from DATABASE_URL (falls back to "shopify_app" if no db name is in the URI path)
let mongoDbName = "shopify_app";
try {
  const parsedMongoUrl = new URL(mongoUri);
  mongoDbName = parsedMongoUrl.pathname.replace(/^\//, "") || "shopify_app";
} catch (e) {
  // fallback to shopify_app
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "bc8cab60c84e1dcbb55b4c057645e5c8",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES
    ? Array.from(
        new Set([
          "read_orders",
          "write_orders",
          ...process.env.SCOPES.split(",").map((s) => s.trim()),
        ])
      )
    : [
        "read_orders",
        "write_orders",
        "read_fulfillments",
        "write_fulfillments",
        "read_shipping",
        "write_shipping",
        "write_products",
      ],
  appUrl:
    process.env.SHOPIFY_APP_URL ||
    "https://delivery1-alb-1581793960.ap-southeast-2.elb.amazonaws.com",
  authPathPrefix: "/auth",
  sessionStorage: new MongoDBSessionStorage(new URL(mongoUri), mongoDbName) as any,
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  billing: {
    Starter: {
      amount: 1.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
    },
    Growth: {
      amount: 3.49,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
    },
    Pro: {
      amount: 5.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
    },
    Advanced: {
      amount: 11.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
    },
    Enterprise: {
      amount: 24.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
