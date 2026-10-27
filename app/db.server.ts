import mongoose from "mongoose";
import crypto from "crypto";
import { encryptSecret, decryptSecret } from "./utils/crypto.server";

export { encryptSecret, decryptSecret };

const MONGODB_URI =
  process.env.MONGODB_URI?.trim() ||
  process.env.DATABASE_URL?.trim();

// Synchronize env variables for backward compatibility across all modules
if (!process.env.DATABASE_URL && MONGODB_URI) {
  process.env.DATABASE_URL = MONGODB_URI;
}
if (!process.env.MONGODB_URI && MONGODB_URI) {
  process.env.MONGODB_URI = MONGODB_URI;
}

// Optimize pooling and timeouts specifically for Vercel Serverless Lambdas
export const SERVERLESS_MONGO_OPTS: mongoose.ConnectOptions = {
  bufferCommands: false,
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 15000,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 20000,
  heartbeatFrequencyMS: 10000,
  family: 4, // CRITICAL: Force IPv4 DNS resolution to prevent 25s secureConnect timeout on Vercel/AWS
};

export function sanitizeMongoUri(uri: string): string {
  if (!uri) return "";
  try {
    const urlObj = new URL(uri);
    urlObj.searchParams.set("family", "4");
    urlObj.searchParams.set("serverSelectionTimeoutMS", "5000");
    urlObj.searchParams.set("connectTimeoutMS", "5000");
    urlObj.searchParams.set("socketTimeoutMS", "20000");
    urlObj.searchParams.set("maxPoolSize", "5");
    urlObj.searchParams.set("minPoolSize", "0");
    urlObj.searchParams.set("maxIdleTimeMS", "15000");
    urlObj.searchParams.set("waitQueueTimeoutMS", "5000");
    return urlObj.toString();
  } catch {
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
}

// Serverless connection caching on globalThis to reuse MongoDB connections across lambda warmups
declare global {
  var __mongooseCache: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  } | undefined;
  var __mongooseListenersRegistered: boolean | undefined;
}

if (!globalThis.__mongooseListenersRegistered) {
  globalThis.__mongooseListenersRegistered = true;
  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️ MongoDB disconnected. Resetting cached connection state.");
    if (globalThis.__mongooseCache) {
      globalThis.__mongooseCache.conn = null;
      globalThis.__mongooseCache.promise = null;
    }
  });
  mongoose.connection.on("error", (err) => {
    console.warn("⚠️ MongoDB connection error event:", err?.message || err);
    if (globalThis.__mongooseCache) {
      globalThis.__mongooseCache.conn = null;
      globalThis.__mongooseCache.promise = null;
    }
  });
}

let cached = globalThis.__mongooseCache;

if (!cached) {
  cached = globalThis.__mongooseCache = { conn: null, promise: null };
}

/**
 * Resilient Serverless MongoDB Connection Handler
 * Implements exponential retry, timeout protection, and IPv4 enforcement
 */
export async function connectDB(): Promise<typeof mongoose | null> {
  // If already connected and ready, reuse connection immediately
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // If a connection attempt is in-flight, await that promise with timeout protection
  if (cached.promise && mongoose.connection.readyState === 2) {
    try {
      cached.conn = await cached.promise;
      return cached.conn;
    } catch {
      cached.promise = null;
      cached.conn = null;
    }
  }

  const rawUri =
    process.env.MONGODB_URI?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    MONGODB_URI;

  if (!rawUri) {
    console.warn(
      "⚠️ Missing MONGODB_URI or DATABASE_URL environment variable. Please configure this in your Vercel project environment settings."
    );
    return null;
  }

  const sanitizedUri = sanitizeMongoUri(rawUri);

  // Resilient connection loop: attempt up to 2 times with a strict timeout guard
  const MAX_ATTEMPTS = 2;
  const ATTEMPT_TIMEOUT_MS = 6000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Disconnect cleanly if stuck in connecting (2) or disconnecting (3) state
      if (mongoose.connection.readyState === 2 || mongoose.connection.readyState === 3) {
        await mongoose.disconnect().catch(() => {});
      }

      cached.promise = mongoose.connect(sanitizedUri, SERVERLESS_MONGO_OPTS);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`MongoDB connection timed out after ${ATTEMPT_TIMEOUT_MS}ms`)),
          ATTEMPT_TIMEOUT_MS
        )
      );

      cached.conn = await Promise.race([cached.promise, timeoutPromise]);
      console.log(`✅ Connected to MongoDB successfully (attempt ${attempt}, Serverless pool reused).`);
      return cached.conn;
    } catch (error: any) {
      console.warn(`⚠️ MongoDB connection attempt ${attempt}/${MAX_ATTEMPTS} failed:`, error?.message || error);
      cached.promise = null;
      cached.conn = null;
      await mongoose.disconnect().catch(() => {});

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      } else {
        console.error("❌ MongoDB connection failed after all resilient attempts:", error?.message || error);
        throw error;
      }
    }
  }

  return cached.conn;
}

/**
 * Helper to resolve the monthly order limit for any plan tier (6-Tier SaaS Model)
 * Free: 120 | Starter: 250 | Growth: 500 | Pro: 1,000 | Advanced: 2,500 | Enterprise: 10,000
 */
export function getPlanLimit(planName = "Free") {
  const normalized = String(planName || "Free").trim().toLowerCase();

  if (normalized.startsWith("enterprise")) {
    return 10000;
  }
  if (normalized.startsWith("advanced")) {
    return 2500;
  }
  if (normalized.startsWith("pro")) {
    return 1000;
  }
  if (normalized.startsWith("growth")) {
    return 500;
  }
  if (normalized.startsWith("starter")) {
    return 250;
  }
  return 120;
}

const courierConfigSchema = new mongoose.Schema(
  {
    shopDomain: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    // Pathao Production & Sandbox Credentials
    pathaoEnvironment: {
      type: String,
      enum: ["sandbox", "production"],
      default: "production",
    },
    pathaoClientId: {
      type: String,
      default: "",
      trim: true,
    },
    pathaoSecret: {
      type: String,
      default: "",
      trim: true,
    },
    pathaoUsername: {
      type: String,
      default: "",
      trim: true,
    },
    pathaoPassword: {
      type: String,
      default: "",
      trim: true,
    },
    pathaoStoreId: {
      type: String,
      default: "",
      trim: true,
    },
    pathaoStoreName: {
      type: String,
      default: "",
      trim: true,
    },
    pathaoAccessToken: {
      type: String,
      default: "",
    },
    pathaoRefreshToken: {
      type: String,
      default: "",
    },
    pathaoTokenExpiresAt: {
      type: Date,
      default: null,
    },
    // Steadfast Credentials
    steadfastApiKey: {
      type: String,
      default: "",
      trim: true,
    },
    steadfastSecretKey: {
      type: String,
      default: "",
      trim: true,
    },
    // RedX Production & Sandbox Credentials
    redxEnvironment: {
      type: String,
      enum: ["sandbox", "production"],
      default: "production",
    },
    redxAccessToken: {
      type: String,
      default: "",
      trim: true,
    },
    redxPickupStoreId: {
      type: String,
      default: "",
      trim: true,
    },
    redxPickupStoreName: {
      type: String,
      default: "",
      trim: true,
    },
    redxProfileId: {
      type: String,
      default: "",
      trim: true,
    },
    redxLocationId: {
      type: String,
      default: "",
      trim: true,
    },
    // CarryBee Credentials & Webhook Secrets
    carrybeeClientId: {
      type: String,
      default: "",
      trim: true,
    },
    carrybeeClientSecret: {
      type: String,
      default: "",
      trim: true,
    },
    carrybeeClientContext: {
      type: String,
      default: "",
      trim: true,
    },
    carrybeeStoreId: {
      type: String,
      default: "",
      trim: true,
    },
    carrybeeSandbox: {
      type: Boolean,
      default: false,
    },
    carrybeeWebhookSecret: {
      type: String,
      default: "",
      trim: true,
    },
    // Bahok Courier Credentials & Webhook Secrets
    bahokMerchantId: {
      type: String,
      default: "",
      trim: true,
    },
    bahokApiKey: {
      type: String,
      default: "",
      trim: true,
    },
    bahokApiToken: {
      type: String,
      default: "",
      trim: true,
    },
    bahokWebhookSecret: {
      type: String,
      default: "",
      trim: true,
    },
    // Webhook Security Token (Unique 32-char hex secret per merchant)
    webhookSecret: {
      type: String,
      default: "",
      trim: true,
    },
    // Task 1: Subscription Capacity & Usage Tracking
    currentPlan: {
      type: String,
      enum: ["Free", "Starter", "Growth", "Pro", "Advanced", "Enterprise"],
      default: "Free",
      trim: true,
    },
    monthlyOrderCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    billingCycleStart: {
      type: Date,
      default: Date.now,
    },
    billingStatus: {
      type: String,
      default: "ACTIVE",
    },
    shopifySubscriptionId: {
      type: String,
      default: "",
    },
    prepaidPlanExpiresAt: {
      type: Date,
      default: null,
    },
    // Task 2: Automated Routing & Risk Safety Net Parameters (Legacy & Enterprise Dynamic Geo-Routing)
    autoRoutingEnabled: {
      type: Boolean,
      default: false,
    },
    isAutoRoutingEnabled: {
      type: Boolean,
      default: false,
    },
    aiAddressCleaningEnabled: {
      type: Boolean,
      default: true,
    },
    insideDhakaCourier: {
      type: String,
      enum: ["pathao", "steadfast", "redx", "carrybee", "bahok"],
      default: "pathao",
      trim: true,
    },
    outsideDhakaCourier: {
      type: String,
      enum: ["pathao", "steadfast", "redx", "carrybee", "bahok"],
      default: "steadfast",
      trim: true,
    },
    defaultCourier: {
      type: String,
      enum: ["pathao", "steadfast", "redx", "carrybee", "bahok"],
      default: "steadfast",
      trim: true,
    },
    minSafetySuccessRate: {
      type: Number,
      default: 70,
      min: 0,
      max: 100,
    },
    minSuccessRate: {
      type: Number,
      default: 70,
      min: 0,
      max: 100,
    },
    customRoutes: {
      type: [
        new mongoose.Schema(
          {
            division: { type: String, required: true, trim: true },
            district: { type: String, required: true, trim: true },
            courier: {
              type: String,
              enum: ["pathao", "steadfast", "redx", "carrybee", "bahok"],
              required: true,
              trim: true,
            },
          },
          { _id: false }
        ),
      ],
      default: [
        { division: "Dhaka", district: "Dhaka", courier: "pathao" },
        {
          division: "Chattogram",
          district: "All Districts in Division",
          courier: "steadfast",
        },
      ],
    },
    // Dynamic Shipping Rates & App-Owned Delivery Profile Synchronization State
    shippingRatesSynced: {
      type: Boolean,
      default: false,
    },
    shippingRatesLastSyncedAt: {
      type: Date,
      default: null,
    },
    appDeliveryProfileId: {
      type: String,
      default: null,
    },
    carrierServiceId: {
      type: String,
      default: null,
    },
    // Shipping Label Configuration
    labelSize: {
      type: String,
      default: "4in x 6in",
      trim: true,
    },
    brandName: {
      type: String,
      default: "",
      trim: true,
    },
    brandPhone: {
      type: String,
      default: "",
      trim: true,
    },
    brandAddress: {
      type: String,
      default: "",
      trim: true,
    },
    brandLogo: {
      type: String,
      default: "",
    },
    labelStyle: {
      type: String,
      default: "standard",
      trim: true,
    },
    socialHandle: {
      type: String,
      default: "",
      trim: true,
    },
    warehouseWarning: {
      type: String,
      default: "FRAGILE / HANDLE WITH CARE",
      trim: true,
    },
    // Default Courier Parcel Notes
    pathaoParcelNote: {
      type: String,
      default: "",
      trim: true,
    },
    steadfastParcelNote: {
      type: String,
      default: "",
      trim: true,
    },
    redxParcelNote: {
      type: String,
      default: "",
      trim: true,
    },
    carrybeeParcelNote: {
      type: String,
      default: "",
      trim: true,
    },
    bahokParcelNote: {
      type: String,
      default: "",
      trim: true,
    },
    defaultParcelNote: {
      type: String,
      default: "",
      trim: true,
    },
    // Invoice Customization
    invoiceTemplate: {
      type: String,
      default: "classic",
      trim: true,
    },
    invoiceBrandName: {
      type: String,
      default: "",
      trim: true,
    },
    invoiceBrandPhone: {
      type: String,
      default: "",
      trim: true,
    },
    invoiceBrandAddress: {
      type: String,
      default: "",
      trim: true,
    },
    invoiceBrandEmail: {
      type: String,
      default: "",
      trim: true,
    },
    invoiceBrandWebsite: {
      type: String,
      default: "",
      trim: true,
    },
    invoiceBrandLogo: {
      type: String,
      default: "",
    },
    invoiceAccentColor: {
      type: String,
      default: "#2563eb",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

if (mongoose.models.CourierConfig) {
  delete mongoose.models.CourierConfig;
}

export const CourierConfig = mongoose.model(
  "CourierConfig",
  courierConfigSchema
);

export const ShopSubscription = CourierConfig;

/**
 * Helper to decrypt sensitive credentials stored in CourierConfig
 */
export function decryptCourierConfig(config) {
  if (!config) return config;
  const doc = typeof config.toObject === "function" ? config.toObject() : { ...config };
  if (doc.pathaoSecret) doc.pathaoSecret = decryptSecret(doc.pathaoSecret);
  if (doc.pathaoPassword) doc.pathaoPassword = decryptSecret(doc.pathaoPassword);
  if (doc.pathaoAccessToken) doc.pathaoAccessToken = decryptSecret(doc.pathaoAccessToken);
  if (doc.pathaoRefreshToken) doc.pathaoRefreshToken = decryptSecret(doc.pathaoRefreshToken);
  if (doc.steadfastSecretKey) doc.steadfastSecretKey = decryptSecret(doc.steadfastSecretKey);
  if (doc.redxAccessToken) doc.redxAccessToken = decryptSecret(doc.redxAccessToken);
  if (doc.carrybeeClientSecret) doc.carrybeeClientSecret = decryptSecret(doc.carrybeeClientSecret);
  if (doc.carrybeeClientContext) doc.carrybeeClientContext = decryptSecret(doc.carrybeeClientContext);
  if (doc.carrybeeWebhookSecret) doc.carrybeeWebhookSecret = decryptSecret(doc.carrybeeWebhookSecret);
  if (doc.bahokApiToken) doc.bahokApiToken = decryptSecret(doc.bahokApiToken);
  if (doc.bahokWebhookSecret) doc.bahokWebhookSecret = decryptSecret(doc.bahokWebhookSecret);
  return doc;
}

/**
 * Ensures a merchant has a persistent, unique 32-character webhook secret
 */
export async function ensureWebhookSecret(shopDomain, existingSecret) {
  if (
    existingSecret &&
    typeof existingSecret === "string" &&
    existingSecret.trim().length >= 16
  ) {
    return existingSecret.trim();
  }
  const generatedSecret = crypto.randomBytes(16).toString("hex");
  if (shopDomain) {
    await CourierConfig.updateOne(
      { shopDomain },
      { $set: { webhookSecret: generatedSecret } },
      { upsert: true }
    );
  }
  return generatedSecret;
}

/**
 * Automatically checks and rolls over the merchant's 30-day billing cycle.
 * - Resets monthlyOrderCount to 0 when 30 days have elapsed (applies to all tiers, including 6-month prepaid).
 * - Checks prepaidPlanExpiresAt: if new Date() > prepaidPlanExpiresAt, automatically downgrades store back to "Free" tier.
 */
export async function ensureBillingCycleCurrent(shopDomain: string) {
  if (!shopDomain) return null;
  try {
    await connectDB();
    const config = await CourierConfig.findOne({ shopDomain });
    if (!config) return null;

    const now = new Date();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    // 1. Check prepaid expiration for 6-month upfront tiers
    if (config.prepaidPlanExpiresAt && now > new Date(config.prepaidPlanExpiresAt)) {
      const elapsedSinceCycle = config.billingCycleStart
        ? now.getTime() - new Date(config.billingCycleStart).getTime()
        : THIRTY_DAYS_MS;
      const isCycleElapsed = elapsedSinceCycle >= THIRTY_DAYS_MS;

      const downgraded = await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            currentPlan: "Free",
            billingStatus: "FREE PLAN ($0.00/mo) - PREPAID EXPIRED",
            shopifySubscriptionId: "",
            prepaidPlanExpiresAt: null,
            ...(isCycleElapsed
              ? { monthlyOrderCount: 0, billingCycleStart: now }
              : {}),
          },
        },
        { new: true }
      );
      return downgraded;
    }

    // 2. Initialize billingCycleStart if missing
    if (!config.billingCycleStart) {
      config.billingCycleStart = now;
      await config.save();
      return config;
    }

    // 3. 30-day rolling quota reset (guarantees monthlyOrderCount resets every 30 days for 6-month prepaid & all tiers)
    const elapsedMs = now.getTime() - new Date(config.billingCycleStart).getTime();
    if (elapsedMs >= THIRTY_DAYS_MS) {
      const updated = await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            monthlyOrderCount: 0,
            billingCycleStart: now,
          },
        },
        { new: true }
      );
      return updated;
    }

    return config;
  } catch (err: any) {
    console.warn("⚠️ ensureBillingCycleCurrent error caught gracefully:", err?.message || err);
    return null;
  }
}

/**
 * Mongoose Schema: GlobalFraudNetwork
 * Caches aggregated delivery & return history per Bangladeshi customer phone number
 */
const globalFraudNetworkSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    totalDelivered: {
      type: Number,
      default: 0,
    },
    totalReturned: {
      type: Number,
      default: 0,
    },
    totalOrders: {
      type: Number,
      default: 0,
    },
    successRate: {
      type: Number,
      default: 100,
    },
    steadfastDelivered: {
      type: Number,
      default: 0,
    },
    steadfastReturned: {
      type: Number,
      default: 0,
    },
    pathaoDelivered: {
      type: Number,
      default: 0,
    },
    pathaoReturned: {
      type: Number,
      default: 0,
    },
    dataSource: {
      type: String,
      default: "multi-courier-aggregation",
    },
    lastCheckedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

if (mongoose.models.GlobalFraudNetwork) {
  delete mongoose.models.GlobalFraudNetwork;
}

export const GlobalFraudNetwork = mongoose.model(
  "GlobalFraudNetwork",
  globalFraudNetworkSchema
);

/**
 * Helper to resolve the bulk booking order batch limit per plan tier (6-Tier SaaS Model)
 * Free: 1 | Starter: 10 | Growth: 15 | Pro: 50 | Advanced: 50 | Enterprise: 50
 */
export function getBulkBatchLimit(planName = "Free") {
  const normalized = String(planName || "Free").trim().toLowerCase();
  if (
    normalized.startsWith("enterprise") ||
    normalized.startsWith("advanced") ||
    normalized.startsWith("pro")
  ) {
    return 50;
  }
  if (normalized.startsWith("growth")) {
    return 15;
  }
  if (normalized.startsWith("starter")) {
    return 10;
  }
  return 1;
}

/**
 * Mongoose Schema: ShipmentBooking
 * Persists courier booking consignment records and printable packing slip payloads
 */
const shipmentBookingSchema = new mongoose.Schema(
  {
    shopDomain: { type: String, required: true, index: true, trim: true },
    orderId: { type: String, required: true, index: true, trim: true },
    orderName: { type: String, required: true },
    courierKey: { type: String, default: "" },
    courierName: { type: String, default: "" },
    trackingNumber: { type: String, default: "" },
    trackingUrl: { type: String, default: "" },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    shippingAddress: { type: String, default: "" },
    codAmount: { type: String, default: "0.00" },
    courierCashCollected: { type: String, default: "0.00" },
    courierStatus: { type: String, default: "in_transit" },
    deliveryStatus: { type: String, default: "in_transit" },
    shopifySyncedPaidFulfilled: { type: Boolean, default: false },
    shopifySyncedAt: { type: Date },
    currencyCode: { type: String, default: "BDT" },
    warehouseNote: {
      type: String,
      default: "⚠️ Fragile - Pack with bubble wrap",
    },
    bookedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Compound Unique Index: prevents duplicate booking documents for the same shop and order
shipmentBookingSchema.index({ shopDomain: 1, orderId: 1 }, { unique: true });

if (mongoose.models.ShipmentBooking) {
  delete mongoose.models.ShipmentBooking;
}

export const ShipmentBooking = mongoose.model(
  "ShipmentBooking",
  shipmentBookingSchema
);

/**
 * 2. Task 5: ShippingZone Schema
 * Stores merchant shipping zone pricing, COD surcharge flag, and weight tiers
 */
const weightTierSubSchema = new mongoose.Schema(
  {
    maxWeight: { type: Number, required: true, min: 0 },
    extraRate: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const shippingZoneSchema = new mongoose.Schema(
  {
    merchantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    zoneName: {
      type: String,
      required: true,
      trim: true,
    },
    baseRate: {
      type: Number,
      required: true,
      default: 70,
      min: 0,
    },
    codSurchargeEnabled: {
      type: Boolean,
      default: false,
    },
    codSurchargePercentage: {
      type: Number,
      default: 1,
      min: 0,
    },
    weightTiers: {
      type: [weightTierSubSchema],
      default: [
        { maxWeight: 1, extraRate: 0 },
        { maxWeight: 3, extraRate: 30 },
        { maxWeight: 5, extraRate: 60 },
      ],
    },
  },
  { timestamps: true }
);

/**
 * 3. Task 5: ZoneDistricts Schema
 * Maps a ShippingZone ID (`zoneId`) to an array of Bangladeshi `districtIds`
 */
const zoneDistrictsSchema = new mongoose.Schema(
  {
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShippingZone",
      required: true,
      unique: true,
      index: true,
    },
    merchantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    districtIds: {
      type: [String],
      default: [],
      index: true,
    },
  },
  { timestamps: true }
);

if (mongoose.models.ShippingZone) {
  delete mongoose.models.ShippingZone;
}
if (mongoose.models.ZoneDistricts) {
  delete mongoose.models.ZoneDistricts;
}

export const ShippingZone = mongoose.model("ShippingZone", shippingZoneSchema);
export const ZoneDistricts = mongoose.model(
  "ZoneDistricts",
  zoneDistrictsSchema
);

/**
 * 4. Task: AI Address Correction & Caching Schema
 * Enforces rawInput, cleanAddress, district, thana, confidence, createdAt
 */
const addressCacheSchema = new mongoose.Schema(
  {
    rawInput: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    cleanAddress: {
      type: String,
      required: true,
      trim: true,
    },
    district: {
      type: String,
      default: "",
      trim: true,
    },
    thana: {
      type: String,
      default: "",
      trim: true,
    },
    confidence: {
      type: String,
      enum: ["HIGH", "MEDIUM", "LOW"],
      default: "HIGH",
    },
    // Courier Specific Location IDs for Instant Booking
    pathaoCityId: {
      type: Number,
      default: null,
    },
    pathaoZoneId: {
      type: Number,
      default: null,
    },
    pathaoAreaId: {
      type: Number,
      default: null,
    },
    redxAreaId: {
      type: Number,
      default: null,
    },
    redxAreaName: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: false }
);

if (mongoose.models.AddressCache) {
  delete mongoose.models.AddressCache;
}

export const AddressCache = mongoose.model("AddressCache", addressCacheSchema);

/**
 * Courier Location Lists Cache (Pathao Cities/Zones & RedX Areas)
 * Prevents redundant external API lookups and preserves rate limits (7-day cache)
 */
const courierLocationCacheSchema = new mongoose.Schema(
  {
    courier: {
      type: String,
      enum: ["pathao_cities", "pathao_zones", "redx_areas"],
      required: true,
      index: true,
    },
    parentId: {
      type: Number,
      default: 0,
      index: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false, collection: "CourierLocationCache" }
);

courierLocationCacheSchema.index({ courier: 1, parentId: 1 }, { unique: true });

if (mongoose.models.CourierLocationCache) {
  delete mongoose.models.CourierLocationCache;
}

export const CourierLocationCache = mongoose.model(
  "CourierLocationCache",
  courierLocationCacheSchema
);

/**
 * 5. Google Sheets Integration Matrix (MerchantIntegrations)
 */
const merchantIntegrationsSchema = new mongoose.Schema(
  {
    merchantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    googleRefreshToken: {
      type: String,
      default: "",
    },
    googleAccessToken: {
      type: String,
      default: "",
    },
    googleTokenExpiry: {
      type: Date,
    },
    googleUserEmail: {
      type: String,
      default: "",
    },
    googleUserName: {
      type: String,
      default: "",
    },
    spreadsheetId: {
      type: String,
      default: "",
      trim: true,
    },
    spreadsheetName: {
      type: String,
      default: "",
      trim: true,
    },
    sheetName: {
      type: String,
      default: "Delivery1 Orders",
      trim: true,
    },
    spreadsheetUrl: {
      type: String,
      default: "",
    },
    autoSyncEnabled: {
      type: Boolean,
      default: true,
    },
    lastSyncAt: {
      type: Date,
    },
    lastSyncStatus: {
      type: String,
      enum: ["SUCCESS", "FAILED", "IDLE"],
      default: "IDLE",
    },
    lastSyncError: {
      type: String,
      default: "",
    },
    totalOrdersSynced: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

if (mongoose.models.MerchantIntegrations) {
  delete mongoose.models.MerchantIntegrations;
}

export const MerchantIntegrations = mongoose.model(
  "MerchantIntegrations",
  merchantIntegrationsSchema
);

/**
 * 6. Global System Configuration (SystemConfig)
 * Stores global operational credentials, support channels, and layout strings
 */
const systemConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "global",
      index: true,
      trim: true,
    },
    supportEmail: {
      type: String,
      default: "ecomdoctorbd@gmail.com",
      trim: true,
    },
    whatsappHelpline: {
      type: String,
      default: "01346851322",
      trim: true,
    },
    whatsappNumber: {
      type: String,
      default: "+8801346851322",
      trim: true,
    },
    tutorialLink: {
      type: String,
      default: "https://www.youtube.com/@ecomdoctorbd",
      trim: true,
    },
  },
  { timestamps: true, collection: "SystemConfig" }
);

if (mongoose.models.SystemConfig) {
  delete mongoose.models.SystemConfig;
}

export const SystemConfig = mongoose.model("SystemConfig", systemConfigSchema);

export async function getSystemConfig() {
  const fallbackConfig = {
    key: "global",
    supportEmail: "ecomdoctorbd@gmail.com",
    whatsappHelpline: "01346851322",
    whatsappNumber: "+8801346851322",
    tutorialLink: "https://www.youtube.com/@ecomdoctorbd",
  };
  try {
    await connectDB();
    let config = await SystemConfig.findOne({ key: "global" }).lean();
    if (!config) {
      config = await SystemConfig.findOneAndUpdate(
        { key: "global" },
        {
          $set: fallbackConfig,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
    }
    return config || fallbackConfig;
  } catch (err: any) {
    console.warn("⚠️ getSystemConfig caught error gracefully, using fallback:", err?.message || err);
    return fallbackConfig;
  }
}

export default CourierConfig;


