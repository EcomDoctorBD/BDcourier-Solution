import mongoose from "mongoose";

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

let cached = global.__mongooseCache;

if (!cached) {
  cached = global.__mongooseCache = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  const activeUri =
    process.env.MONGODB_URI?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    MONGODB_URI;

  if (!activeUri) {
    throw new Error(
      "Missing MONGODB_URI or DATABASE_URL environment variable. Please verify container environment configuration."
    );
  }

  if (!cached.promise || mongoose.connection.readyState === 0) {
    const opts = {
      bufferCommands: true,
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    };

    cached.promise = mongoose
      .connect(activeUri, opts)
      .then((mongooseInstance) => {
        console.log("✅ Connected to MongoDB successfully (Mongoose pool reused).");
        return mongooseInstance;
      })
      .catch((error) => {
        cached.promise = null;
        console.error("❌ MongoDB connection error:", error);
        throw error;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// Background non-blocking warm-up connection (does not halt bootstrap if slow)
if (MONGODB_URI) {
  connectDB().catch((err) =>
    console.warn("Initial MongoDB connection attempt deferred to first request:", err.message)
  );
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
    // Pathao Credentials
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
    pathaoStoreId: {
      type: String,
      default: "",
      trim: true,
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
    // RedX Credentials
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
    // Task 2: Automated Routing & Risk Safety Net Parameters (Legacy & Enterprise Dynamic Geo-Routing)
    autoRoutingEnabled: {
      type: Boolean,
      default: false,
    },
    isAutoRoutingEnabled: {
      type: Boolean,
      default: false,
    },
    insideDhakaCourier: {
      type: String,
      enum: ["pathao", "steadfast", "redx"],
      default: "pathao",
      trim: true,
    },
    outsideDhakaCourier: {
      type: String,
      enum: ["pathao", "steadfast", "redx"],
      default: "steadfast",
      trim: true,
    },
    defaultCourier: {
      type: String,
      enum: ["pathao", "steadfast", "redx"],
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
              enum: ["pathao", "steadfast", "redx"],
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
    courierKey: { type: String, required: true },
    courierName: { type: String, required: true },
    trackingNumber: { type: String, required: true },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    shippingAddress: { type: String, default: "" },
    codAmount: { type: String, default: "0.00" },
    courierCashCollected: { type: String, default: "0.00" },
    courierStatus: { type: String, default: "in_transit" },
    shopifySyncedPaidFulfilled: { type: Boolean, default: false },
    currencyCode: { type: String, default: "BDT" },
    warehouseNote: {
      type: String,
      default: "⚠️ Fragile - Pack with bubble wrap",
    },
    bookedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

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
      required: true,
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

export default CourierConfig;


