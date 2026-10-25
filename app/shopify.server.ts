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

// Enforce serverless-friendly pooling & IPv4 DNS resolution to eliminate 25s timeout
const ensureServerlessMongoUri = (uri: string): string => {
  if (!uri) return "";
  try {
    const urlObj = new URL(uri);
    urlObj.searchParams.set("family", "4"); // CRITICAL: Force IPv4 DNS resolution to prevent 25s secureConnect timeout on Vercel
    urlObj.searchParams.set("serverSelectionTimeoutMS", "5000");
    urlObj.searchParams.set("connectTimeoutMS", "5000");
    urlObj.searchParams.set("socketTimeoutMS", "20000");
    urlObj.searchParams.set("maxPoolSize", "5");
    urlObj.searchParams.set("minPoolSize", "0");
    urlObj.searchParams.set("maxIdleTimeMS", "15000");
    urlObj.searchParams.set("waitQueueTimeoutMS", "5000");
    return urlObj.toString();
  } catch (e) {
    let clean = uri;
    const required = [
      "family=4",
      "serverSelectionTimeoutMS=5000",
      "connectTimeoutMS=5000",
      "socketTimeoutMS=20000",
      "maxPoolSize=5",
      "minPoolSize=0",
      "maxIdleTimeMS=15000",
      "waitQueueTimeoutMS=5000",
    ];
    for (const req of required) {
      const key = req.split("=")[0];
      if (!clean.includes(`${key}=`)) {
        clean += (clean.includes("?") ? "&" : "?") + req;
      }
    }
    return clean;
  }
};

const mongoUri = ensureServerlessMongoUri(rawMongoUri);

if (!process.env.DATABASE_URL && mongoUri) {
  process.env.DATABASE_URL = mongoUri;
}
if (!process.env.MONGODB_URI && mongoUri) {
  process.env.MONGODB_URI = mongoUri;
}

// Parse database name from DATABASE_URL
let mongoDbName = "shopify_app";
try {
  if (mongoUri) {
    const parsedMongoUrl = new URL(mongoUri);
    mongoDbName = parsedMongoUrl.pathname.replace(/^\//, "") || "shopify_app";
  }
} catch (e) {
  // fallback to shopify_app
}

/**
 * Resilient Session Storage Wrapper
 * Prevents lambda crashes if MongoDB is cold, unreachable, or drops TLS handshake
 */
class ResilientMongoDBSessionStorage {
  private primaryStorage: MongoDBSessionStorage | null = null;
  private memorySessions = new Map<string, any>();
  private dbUrl: URL | null = null;
  private dbName: string;

  constructor(dbUrlStr: string, dbName: string) {
    this.dbName = dbName;
    try {
      if (dbUrlStr) {
        this.dbUrl = new URL(dbUrlStr);
      }
    } catch (e) {
      console.warn("⚠️ Invalid MongoDB URL for session storage:", e);
    }
    this.initStorage();
  }

  private initStorage() {
    if (!this.dbUrl) return;
    try {
      this.primaryStorage = new MongoDBSessionStorage(this.dbUrl, this.dbName);
      this.primaryStorage.ready.catch((err) => {
        console.warn("⚠️ MongoDBSessionStorage initial connection warning (in-memory fallback active):", err.message);
        this.primaryStorage = null;
      });
    } catch (err: any) {
      console.warn("⚠️ Failed to construct MongoDBSessionStorage:", err.message);
      this.primaryStorage = null;
    }
  }

  private getActiveStorage(): MongoDBSessionStorage | null {
    if (!this.primaryStorage && this.dbUrl) {
      this.initStorage();
    }
    return this.primaryStorage;
  }

  async storeSession(session: any): Promise<boolean> {
    if (session?.id) {
      this.memorySessions.set(session.id, session);
    }
    const storage = this.getActiveStorage();
    if (!storage) return true;
    try {
      return await storage.storeSession(session);
    } catch (err: any) {
      console.warn("⚠️ Failed to persist session to MongoDB (in-memory cached):", err.message);
      this.primaryStorage = null;
      return true;
    }
  }

  async loadSession(id: string): Promise<any | undefined> {
    if (this.memorySessions.has(id)) {
      const memSession = this.memorySessions.get(id);
      if (memSession && (!memSession.expires || new Date(memSession.expires) > new Date())) {
        return memSession;
      }
    }
    const storage = this.getActiveStorage();
    if (!storage) return this.memorySessions.get(id);
    try {
      const sessionPromise = storage.loadSession(id);
      const timeoutPromise = new Promise<undefined>((_, reject) =>
        setTimeout(() => reject(new Error("Session load timeout")), 3500)
      );
      const session = await Promise.race([sessionPromise, timeoutPromise]);
      if (session) {
        this.memorySessions.set(id, session);
      }
      return session || this.memorySessions.get(id);
    } catch (err: any) {
      console.warn("⚠️ Session load warning (falling back to memory):", err.message);
      this.primaryStorage = null;
      return this.memorySessions.get(id);
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    this.memorySessions.delete(id);
    const storage = this.getActiveStorage();
    if (!storage) return true;
    try {
      return await storage.deleteSession(id);
    } catch {
      this.primaryStorage = null;
      return true;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    for (const id of ids) this.memorySessions.delete(id);
    const storage = this.getActiveStorage();
    if (!storage) return true;
    try {
      return await storage.deleteSessions(ids);
    } catch {
      this.primaryStorage = null;
      return true;
    }
  }

  async findSessionsByShop(shop: string): Promise<any[]> {
    const storage = this.getActiveStorage();
    if (storage) {
      try {
        const fetchPromise = storage.findSessionsByShop(shop);
        const timeoutPromise = new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error("Find sessions timeout")), 3500)
        );
        const results = await Promise.race([fetchPromise, timeoutPromise]);
        if (results && results.length > 0) return results;
      } catch {
        this.primaryStorage = null;
      }
    }
    const matching: any[] = [];
    for (const s of this.memorySessions.values()) {
      if (s?.shop === shop) matching.push(s);
    }
    return matching;
  }
}

// Global connection caching for MongoDBSessionStorage to prevent open connection exhaustion in serverless
interface GlobalWithSessionStorage {
  __shopifySessionStorage?: ResilientMongoDBSessionStorage;
}
const globalForSession = globalThis as unknown as GlobalWithSessionStorage;
if (!globalForSession.__shopifySessionStorage) {
  globalForSession.__shopifySessionStorage = new ResilientMongoDBSessionStorage(
    mongoUri,
    mongoDbName
  );
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
          "read_fulfillments",
          "write_fulfillments",
          "read_shipping",
          "write_shipping",
          "read_customers",
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
        "read_customers",
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
