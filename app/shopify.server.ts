import "@shopify/shopify-app-remix/adapters/node";
import "@shopify/shopify-api";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";

const rawMongoUri =
  process.env.MONGODB_URI?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

// Enforce serverSelectionTimeoutMS: 5000 so the connection fails fast instead of hanging in serverless
let mongoUri = rawMongoUri;
if (mongoUri) {
  try {
    const urlObj = new URL(mongoUri);
    if (!urlObj.searchParams.has("serverSelectionTimeoutMS")) {
      urlObj.searchParams.set("serverSelectionTimeoutMS", "5000");
    }
    if (!urlObj.searchParams.has("connectTimeoutMS")) {
      urlObj.searchParams.set("connectTimeoutMS", "10000");
    }
    mongoUri = urlObj.toString();
  } catch (e) {
    if (!mongoUri.includes("serverSelectionTimeoutMS")) {
      const separator = mongoUri.includes("?") ? "&" : "?";
      mongoUri = `${mongoUri}${separator}serverSelectionTimeoutMS=5000&connectTimeoutMS=10000`;
    }
  }
}

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

// Global connection caching for MongoDBSessionStorage to prevent open connection exhaustion in serverless
interface GlobalWithSessionStorage {
  __shopifySessionStorage?: MongoDBSessionStorage;
}
const globalForSession = globalThis as unknown as GlobalWithSessionStorage;
if (!globalForSession.__shopifySessionStorage) {
  const storage = new MongoDBSessionStorage(
    new URL(mongoUri),
    mongoDbName
  );
  // Prevent unhandled promise rejection if initial ping takes time
  storage.ready.catch((err) => {
    console.warn("MongoDBSessionStorage initial connection warning:", err.message);
  });
  globalForSession.__shopifySessionStorage = storage;
}
const cachedSessionStorage = globalForSession.__shopifySessionStorage;

const appUrl =
  process.env.SHOPIFY_APP_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://b-dcourier-solution.vercel.app");

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
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: cachedSessionStorage as any,
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
    unstable_newEmbeddedAuthStrategy: true,
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
