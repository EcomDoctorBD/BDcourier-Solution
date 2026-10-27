import crypto from "crypto";
import { useState, useEffect, type SVGProps } from "react";
import {
  json,
  type HeadersFunction,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
  useSearchParams,
  useRouteError,
} from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-remix/server";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Checkbox,
  Divider,
  Banner,
  Grid,
  Box,
  Select,
  Icon,
  RadioButton,
  Tabs,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { CourierLogo } from "../components/CourierLogo";
import CourierConfig, {
  connectDB,
  AddressCache,
  decryptCourierConfig,
  encryptSecret,
  ensureWebhookSecret,
} from "../db.server";
import {
  fetchPathaoStores,
  fetchRedxStores,
  type PathaoStore,
  type RedxStore,
} from "../services/courier-auth.server";

export interface CustomRouteRule {
  division: string;
  district: string;
  courier: string;
}

export interface AutoRoutingConfig {
  autoRoutingEnabled: boolean;
  isAutoRoutingEnabled: boolean;
  insideDhakaCourier: string;
  outsideDhakaCourier: string;
  defaultCourier: string;
  minSafetySuccessRate: number;
  minSuccessRate: number;
  customRoutes: CustomRouteRule[];
}

export interface CourierCredentials {
  pathaoEnvironment: string;
  pathaoClientId: string;
  pathaoSecret: string;
  hasPathaoSecret?: boolean;
  pathaoUsername: string;
  pathaoPassword: string;
  hasPathaoPassword?: boolean;
  pathaoStoreId: string;
  pathaoStoreName: string;
  steadfastApiKey: string;
  steadfastSecretKey: string;
  hasSteadfastSecretKey?: boolean;
  redxEnvironment: string;
  redxAccessToken: string;
  hasRedxAccessToken?: boolean;
  redxPickupStoreId: string;
  redxPickupStoreName: string;
  redxProfileId: string;
  redxLocationId: string;
  carrybeeClientId: string;
  carrybeeClientSecret: string;
  hasCarrybeeSecret?: boolean;
  carrybeeClientContext: string;
  hasCarrybeeContext?: boolean;
  carrybeeStoreId: string;
  carrybeeSandbox: boolean;
  carrybeeWebhookSecret: string;
  hasCarrybeeWebhookSecret?: boolean;
  bahokMerchantId: string;
  bahokApiKey: string;
  bahokApiToken: string;
  hasBahokApiToken?: boolean;
  bahokWebhookSecret: string;
  hasBahokWebhookSecret?: boolean;
  webhookSecret: string;
}

export interface AiConfig {
  isGeminiConfigured: boolean;
  geminiModel: string;
  addressCacheCount: number;
  aiAddressCleaningEnabled: boolean;
}

/**
 * Hierarchical Bangladesh Location Data (for Geo-Routing Rule Engine)
 */
export const BANGLADESH_LOCATIONS: Record<string, string[]> = {
  Dhaka: [
    "Dhaka",
    "Gazipur",
    "Narayanganj",
    "Tangail",
    "Manikganj",
    "Munshiganj",
    "Narsingdi",
    "Kishoreganj",
    "Faridpur",
    "Gopalganj",
    "Madaripur",
    "Rajbari",
    "Shariatpur",
  ],
  Chattogram: [
    "Chattogram",
    "Cox's Bazar",
    "Cumilla",
    "Brahmanbaria",
    "Chandpur",
    "Noakhali",
    "Feni",
    "Lakshmipur",
    "Rangamati",
    "Khagrachhari",
    "Bandarban",
  ],
  Rajshahi: [
    "Rajshahi",
    "Bogura",
    "Pabna",
    "Sirajganj",
    "Natore",
    "Naogaon",
    "Chapainawabganj",
    "Joypurhat",
  ],
  Khulna: [
    "Khulna",
    "Jashore",
    "Kushtia",
    "Satkhira",
    "Bagerhat",
    "Jhenaidah",
    "Magura",
    "Narail",
    "Chuadanga",
    "Meherpur",
  ],
  Barishal: [
    "Barishal",
    "Patuakhali",
    "Bhola",
    "Pirojpur",
    "Barguna",
    "Jhalokati",
  ],
  Sylhet: ["Sylhet", "Moulvibazar", "Habiganj", "Sunamganj"],
  Rangpur: [
    "Rangpur",
    "Dinajpur",
    "Kurigram",
    "Gaibandha",
    "Nilphamari",
    "Panchagarh",
    "Thakurgaon",
    "Lalmonirhat",
  ],
  Mymensingh: ["Mymensingh", "Jamalpur", "Netrokona", "Sherpur"],
};

export const COURIER_OPTIONS = [
  { label: "Pathao Courier", value: "pathao" },
  { label: "Steadfast Courier", value: "steadfast" },
  { label: "RedX Delivery", value: "redx" },
  { label: "CarryBee", value: "carrybee" },
  { label: "Bahok Courier", value: "bahok" },
];

function CourierTruckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="20"
      height="20"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.5 5A1.5 1.5 0 0 1 4 3.5h7.5A1.5 1.5 0 0 1 13 5v1.5h2.086a1.5 1.5 0 0 1 1.06.44l1.914 1.914a1.5 1.5 0 0 1 .44 1.06V13.5A1.5 1.5 0 0 1 17 15h-.67a2.501 2.501 0 0 1-4.66 0H8.33a2.501 2.501 0 0 1-4.66 0H3.5A1.5 1.5 0 0 1 2 13.5V5.5A.5.5 0 0 1 2.5 5Zm10.5 3v4h3.586a.5.5 0 0 0 .414-.5V9.914a.5.5 0 0 0-.146-.353l-1.915-1.915A.5.5 0 0 0 14.586 7.5H13v.5ZM6 15.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
    </svg>
  );
}

function TrashRemoveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="20"
      height="20"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        d="M8.5 3a1.5 1.5 0 0 0-1.415 1H4.75a.75.75 0 0 0 0 1.5h.32l.662 9.266A2.25 2.25 0 0 0 7.977 16.85h4.046a2.25 2.25 0 0 0 2.245-2.084l.662-9.266h.32a.75.75 0 0 0 0-1.5h-2.335A1.5 1.5 0 0 0 11.5 3h-3Zm1.5 1h-1.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5H10ZM7.53 7.47a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75Zm4.94 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SparklesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="20"
      height="20"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.402 1.83c-.772.321-.772 1.415 0 1.736l4.402 1.83 1.83 4.402c.321.772 1.415.772 1.736 0l1.83-4.402 4.401-1.83c.772-.321.772-1.415 0-1.736l-4.401-1.83-1.83-4.401ZM10 6.643l.87 2.09c.14.337.403.6.74.74l2.09.87-2.09.87c-.337.14-.6.403-.74.74l-.87 2.09-.87-2.09a1.698 1.698 0 0 0-.74-.74l-2.09-.87 2.09-.87c.337-.14.6-.403.74-.74l.87-2.09Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const rawConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
  const storeConfig = decryptCourierConfig(rawConfig);
  const currentPlan = storeConfig?.currentPlan || "Free";
  const planLower = String(currentPlan).trim().toLowerCase();
  const isProOrEnterprise =
    planLower.startsWith("pro") || planLower.startsWith("enterprise");

  // Routing & Safety Settings
  const isAutoRoutingEnabled = Boolean(
    storeConfig?.isAutoRoutingEnabled ?? storeConfig?.autoRoutingEnabled ?? false
  );

  const rawCustomRoutes: CustomRouteRule[] =
    Array.isArray(storeConfig?.customRoutes) &&
    storeConfig.customRoutes.length > 0
      ? storeConfig.customRoutes.map((r: any) => ({
          division: String(r.division || "Dhaka"),
          district: String(r.district || "All Districts in Division"),
          courier: String(r.courier || "pathao"),
        }))
      : [
          { division: "Dhaka", district: "Dhaka", courier: "pathao" },
          {
            division: "Chattogram",
            district: "All Districts in Division",
            courier: "steadfast",
          },
        ];

  const minSuccessRate = Number(
    storeConfig?.minSuccessRate ?? storeConfig?.minSafetySuccessRate ?? 70
  );

  const routingConfig: AutoRoutingConfig = {
    autoRoutingEnabled: isAutoRoutingEnabled,
    isAutoRoutingEnabled,
    insideDhakaCourier: storeConfig?.insideDhakaCourier || "pathao",
    outsideDhakaCourier: storeConfig?.outsideDhakaCourier || "steadfast",
    defaultCourier: storeConfig?.defaultCourier || "steadfast",
    minSafetySuccessRate: minSuccessRate,
    minSuccessRate,
    customRoutes: rawCustomRoutes,
  };

  const webhookSecret = await ensureWebhookSecret(
    shopDomain,
    storeConfig?.webhookSecret
  );

  const appUrl =
    process.env.SHOPIFY_APP_URL?.trim().replace(/\/$/, "") ||
    new URL(request.url).origin;

  const MASKED_SECRET = "••••••••";

  const courierConfig: CourierCredentials = {
    pathaoEnvironment: storeConfig?.pathaoEnvironment || "production",
    pathaoClientId: storeConfig?.pathaoClientId || "",
    pathaoSecret: storeConfig?.pathaoSecret ? MASKED_SECRET : "",
    hasPathaoSecret: Boolean(storeConfig?.pathaoSecret),
    pathaoUsername: storeConfig?.pathaoUsername || "",
    pathaoPassword: storeConfig?.pathaoPassword ? MASKED_SECRET : "",
    hasPathaoPassword: Boolean(storeConfig?.pathaoPassword),
    pathaoStoreId: storeConfig?.pathaoStoreId || "",
    pathaoStoreName: storeConfig?.pathaoStoreName || "",
    steadfastApiKey: storeConfig?.steadfastApiKey || "",
    steadfastSecretKey: storeConfig?.steadfastSecretKey ? MASKED_SECRET : "",
    hasSteadfastSecretKey: Boolean(storeConfig?.steadfastSecretKey),
    redxEnvironment: storeConfig?.redxEnvironment || "production",
    redxAccessToken: storeConfig?.redxAccessToken ? MASKED_SECRET : "",
    hasRedxAccessToken: Boolean(storeConfig?.redxAccessToken),
    redxPickupStoreId: storeConfig?.redxPickupStoreId || storeConfig?.redxLocationId || "",
    redxPickupStoreName: storeConfig?.redxPickupStoreName || "",
    redxProfileId: storeConfig?.redxProfileId || "",
    redxLocationId: storeConfig?.redxLocationId || storeConfig?.redxPickupStoreId || "",
    carrybeeClientId: storeConfig?.carrybeeClientId || "",
    carrybeeClientSecret: storeConfig?.carrybeeClientSecret ? MASKED_SECRET : "",
    hasCarrybeeSecret: Boolean(storeConfig?.carrybeeClientSecret),
    carrybeeClientContext: storeConfig?.carrybeeClientContext ? MASKED_SECRET : "",
    hasCarrybeeContext: Boolean(storeConfig?.carrybeeClientContext),
    carrybeeStoreId: storeConfig?.carrybeeStoreId || "",
    carrybeeSandbox: Boolean(storeConfig?.carrybeeSandbox),
    carrybeeWebhookSecret: storeConfig?.carrybeeWebhookSecret ? MASKED_SECRET : "",
    hasCarrybeeWebhookSecret: Boolean(storeConfig?.carrybeeWebhookSecret),
    bahokMerchantId: storeConfig?.bahokMerchantId || "",
    bahokApiKey: storeConfig?.bahokApiKey || "",
    bahokApiToken: storeConfig?.bahokApiToken ? MASKED_SECRET : "",
    hasBahokApiToken: Boolean(storeConfig?.bahokApiToken),
    bahokWebhookSecret: storeConfig?.bahokWebhookSecret ? MASKED_SECRET : "",
    hasBahokWebhookSecret: Boolean(storeConfig?.bahokWebhookSecret),
    webhookSecret,
  };

  let addressCacheCount = 0;
  try {
    addressCacheCount = await AddressCache.countDocuments();
  } catch (err) {
    console.warn("Could not retrieve AddressCache count:", err);
  }

  const aiConfig: AiConfig = {
    isGeminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite",
    addressCacheCount,
    aiAddressCleaningEnabled: Boolean(
      storeConfig?.aiAddressCleaningEnabled ?? true
    ),
  };

  return json({
    shopDomain,
    currentPlan,
    isProOrEnterprise,
    courierConfig,
    routingConfig,
    aiConfig,
    appUrl,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "");

  const isMaskedOrEmpty = (val: string) =>
    !val || val.trim() === "" || val.trim() === "••••••••" || /^•+$/.test(val.trim());

  // ==================== 1. SAVE PATHAO CREDENTIALS ====================
  if (actionType === "savePathao") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
    const pathaoEnvironment = String(formData.get("pathaoEnvironment") || "production").trim();
    const pathaoClientId = String(formData.get("pathaoClientId") || "").trim();
    const pathaoSecret = String(formData.get("pathaoSecret") || "").trim();
    const pathaoUsername = String(formData.get("pathaoUsername") || "").trim();
    const pathaoPassword = String(formData.get("pathaoPassword") || "").trim();
    const pathaoStoreId = String(formData.get("pathaoStoreId") || "").trim();
    const pathaoStoreName = String(formData.get("pathaoStoreName") || "").trim();

    const updateSet: Record<string, any> = {
      shopDomain,
      pathaoEnvironment: pathaoEnvironment === "sandbox" ? "sandbox" : "production",
      pathaoClientId,
      pathaoUsername,
      pathaoStoreId,
      pathaoStoreName,
    };

    const defaultCourierParam = String(formData.get("defaultCourier") || "").trim();
    if (defaultCourierParam && ["pathao", "steadfast", "redx", "carrybee", "bahok"].includes(defaultCourierParam)) {
      updateSet.defaultCourier = defaultCourierParam;
    }
    if (!isMaskedOrEmpty(pathaoSecret)) {
      updateSet.pathaoSecret = encryptSecret(pathaoSecret);
    } else if (rawExisting?.pathaoSecret) {
      updateSet.pathaoSecret = rawExisting.pathaoSecret;
    }

    if (!isMaskedOrEmpty(pathaoPassword)) {
      updateSet.pathaoPassword = encryptSecret(pathaoPassword);
    } else if (rawExisting?.pathaoPassword) {
      updateSet.pathaoPassword = rawExisting.pathaoPassword;
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const effectiveSecret = updateSet.pathaoSecret || rawExisting?.pathaoSecret;
    const isFullyConnected = Boolean(
      pathaoClientId && effectiveSecret && pathaoStoreId
    );

    return json({
      success: true,
      actionType: "savePathao",
      message: isFullyConnected
        ? "Pathao Courier credentials saved and connected successfully."
        : "Pathao configuration saved (some fields were left blank).",
    });
  }

  // ==================== 1B. VERIFY & FETCH PATHAO STORES ====================
  if (actionType === "fetchPathaoStores") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
    const pathaoEnvironment = String(formData.get("pathaoEnvironment") || "production").trim();
    const pathaoClientId = String(formData.get("pathaoClientId") || "").trim();
    const pathaoSecret = String(formData.get("pathaoSecret") || "").trim();
    const pathaoUsername = String(formData.get("pathaoUsername") || "").trim();
    const pathaoPassword = String(formData.get("pathaoPassword") || "").trim();

    const updateSet: Record<string, any> = {
      shopDomain,
      pathaoEnvironment: pathaoEnvironment === "sandbox" ? "sandbox" : "production",
    };
    if (pathaoClientId) updateSet.pathaoClientId = pathaoClientId;
    if (pathaoUsername) updateSet.pathaoUsername = pathaoUsername;
    if (!isMaskedOrEmpty(pathaoSecret)) {
      updateSet.pathaoSecret = encryptSecret(pathaoSecret);
    } else if (rawExisting?.pathaoSecret) {
      updateSet.pathaoSecret = rawExisting.pathaoSecret;
    }
    if (!isMaskedOrEmpty(pathaoPassword)) {
      updateSet.pathaoPassword = encryptSecret(pathaoPassword);
    } else if (rawExisting?.pathaoPassword) {
      updateSet.pathaoPassword = rawExisting.pathaoPassword;
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const storesResult = await fetchPathaoStores(shopDomain);
    if (!storesResult.success) {
      return json({
        success: false,
        actionType: "fetchPathaoStores",
        message: storesResult.error || "Failed to fetch Pathao stores.",
        stores: [] as PathaoStore[],
      });
    }

    return json({
      success: true,
      actionType: "fetchPathaoStores",
      message: `Verified credentials and retrieved ${storesResult.stores.length} store(s) from Pathao.`,
      stores: storesResult.stores,
    });
  }

  // ==================== 2. SAVE STEADFAST CREDENTIALS ====================
  if (actionType === "saveSteadfast") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
    const steadfastApiKey = String(
      formData.get("steadfastApiKey") || ""
    ).trim();
    const steadfastSecretKey = String(
      formData.get("steadfastSecretKey") || ""
    ).trim();

    const updateSet: Record<string, any> = {
      shopDomain,
      steadfastApiKey,
    };
    if (!isMaskedOrEmpty(steadfastSecretKey)) {
      updateSet.steadfastSecretKey = encryptSecret(steadfastSecretKey);
    } else if (rawExisting?.steadfastSecretKey) {
      updateSet.steadfastSecretKey = rawExisting.steadfastSecretKey;
    }

    const defaultCourierParam = String(formData.get("defaultCourier") || "").trim();
    if (defaultCourierParam && ["pathao", "steadfast", "redx", "carrybee", "bahok"].includes(defaultCourierParam)) {
      updateSet.defaultCourier = defaultCourierParam;
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const effectiveSecret = updateSet.steadfastSecretKey || rawExisting?.steadfastSecretKey;
    const isFullyConnected = Boolean(steadfastApiKey && effectiveSecret);

    return json({
      success: true,
      actionType: "saveSteadfast",
      message: isFullyConnected
        ? "Steadfast Courier credentials saved and connected successfully."
        : "Steadfast configuration saved (some fields were left blank).",
    });
  }

  // ==================== 3. SAVE REDX CREDENTIALS ====================
  if (actionType === "saveRedX") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
    const redxEnvironment = "production";
    const redxAccessToken = String(formData.get("redxAccessToken") || "").trim();
    const redxPickupStoreId = String(formData.get("redxPickupStoreId") || "").trim();
    const redxPickupStoreName = String(formData.get("redxPickupStoreName") || "").trim();
    const redxProfileId = String(formData.get("redxProfileId") || "").trim();
    const redxLocationId = String(formData.get("redxLocationId") || "").trim();

    const pickupId = redxPickupStoreId || redxLocationId;
    const profileId = redxProfileId || redxPickupStoreName || pickupId;

    const updateSet: Record<string, any> = {
      shopDomain,
      redxEnvironment: "production",
      redxPickupStoreId: pickupId,
      redxPickupStoreName,
      redxProfileId: profileId,
      redxLocationId: pickupId,
    };
    if (!isMaskedOrEmpty(redxAccessToken)) {
      updateSet.redxAccessToken = encryptSecret(redxAccessToken);
    } else if (rawExisting?.redxAccessToken) {
      updateSet.redxAccessToken = rawExisting.redxAccessToken;
    }

    const defaultCourierParam = String(formData.get("defaultCourier") || "").trim();
    if (defaultCourierParam && ["pathao", "steadfast", "redx", "carrybee", "bahok"].includes(defaultCourierParam)) {
      updateSet.defaultCourier = defaultCourierParam;
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const effectiveToken = updateSet.redxAccessToken || rawExisting?.redxAccessToken;
    const isFullyConnected = Boolean(
      (effectiveToken && pickupId) || (profileId && pickupId)
    );

    return json({
      success: true,
      actionType: "saveRedX",
      message: isFullyConnected
        ? "REDX Delivery credentials saved and connected successfully."
        : "REDX configuration saved (some fields were left blank).",
    });
  }

  // ==================== 3B. VERIFY & FETCH REDX STORES ====================
  if (actionType === "fetchRedxStores") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
    const redxEnvironment = String(formData.get("redxEnvironment") || "production").trim();
    const redxAccessToken = String(formData.get("redxAccessToken") || "").trim();

    const updateSet: Record<string, any> = {
      shopDomain,
      redxEnvironment: redxEnvironment === "sandbox" ? "sandbox" : "production",
    };
    if (!isMaskedOrEmpty(redxAccessToken)) {
      updateSet.redxAccessToken = encryptSecret(redxAccessToken);
    } else if (rawExisting?.redxAccessToken) {
      updateSet.redxAccessToken = rawExisting.redxAccessToken;
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const storesResult = await fetchRedxStores(shopDomain);
    if (!storesResult.success) {
      return json({
        success: false,
        actionType: "fetchRedxStores",
        message: storesResult.error || "Failed to fetch RedX pickup stores.",
        stores: [] as RedxStore[],
      });
    }

    return json({
      success: true,
      actionType: "fetchRedxStores",
      message: `Verified Access Token and retrieved ${storesResult.stores.length} store(s) from RedX.`,
      stores: storesResult.stores,
    });
  }

  // ==================== 3C. REGENERATE WEBHOOK SECRET ====================
  if (actionType === "regenerateWebhookSecret") {
    const newSecret = crypto.randomBytes(24).toString("hex");
    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: { webhookSecret: newSecret } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return json({
      success: true,
      actionType: "regenerateWebhookSecret",
      message:
        "Webhook secret token regenerated successfully. Please update your webhook callback URLs in Pathao, Steadfast, REDX, CarryBee, and Bahok merchant panels.",
      newWebhookSecret: newSecret,
    });
  }

  // ==================== 3D. SAVE CARRYBEE CREDENTIALS ====================
  if (actionType === "saveCarrybee") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
    const carrybeeClientId = String(formData.get("carrybeeClientId") || "").trim();
    const carrybeeClientSecret = String(formData.get("carrybeeClientSecret") || "").trim();
    const carrybeeClientContext = String(formData.get("carrybeeClientContext") || "").trim();
    const carrybeeStoreId = String(formData.get("carrybeeStoreId") || "").trim();
    const carrybeeSandbox = String(formData.get("carrybeeSandbox")) === "true";
    const carrybeeWebhookSecret = String(formData.get("carrybeeWebhookSecret") || "").trim();

    const updateSet: Record<string, any> = {
      shopDomain,
      carrybeeClientId,
      carrybeeStoreId,
      carrybeeSandbox,
    };

    if (!isMaskedOrEmpty(carrybeeClientSecret)) {
      updateSet.carrybeeClientSecret = encryptSecret(carrybeeClientSecret);
    } else if (rawExisting?.carrybeeClientSecret) {
      updateSet.carrybeeClientSecret = rawExisting.carrybeeClientSecret;
    }

    if (!isMaskedOrEmpty(carrybeeClientContext)) {
      updateSet.carrybeeClientContext = encryptSecret(carrybeeClientContext);
    } else if (rawExisting?.carrybeeClientContext) {
      updateSet.carrybeeClientContext = rawExisting.carrybeeClientContext;
    }

    if (!isMaskedOrEmpty(carrybeeWebhookSecret)) {
      updateSet.carrybeeWebhookSecret = encryptSecret(carrybeeWebhookSecret);
    } else if (rawExisting?.carrybeeWebhookSecret) {
      updateSet.carrybeeWebhookSecret = rawExisting.carrybeeWebhookSecret;
    }

    const defaultCourierParam = String(formData.get("defaultCourier") || "").trim();
    if (defaultCourierParam && ["pathao", "steadfast", "redx", "carrybee", "bahok"].includes(defaultCourierParam)) {
      updateSet.defaultCourier = defaultCourierParam;
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const effectiveSecret = updateSet.carrybeeClientSecret || rawExisting?.carrybeeClientSecret;
    const effectiveContext = updateSet.carrybeeClientContext || rawExisting?.carrybeeClientContext;
    const isFullyConnected = Boolean(
      carrybeeClientId && effectiveSecret && effectiveContext
    );

    return json({
      success: true,
      actionType: "saveCarrybee",
      message: isFullyConnected
        ? "CarryBee credentials saved and connected successfully."
        : "CarryBee configuration saved (some fields were left blank).",
    });
  }

  // ==================== 3E. SAVE BAHOK CREDENTIALS ====================
  if (actionType === "saveBahok") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
    const bahokMerchantId = String(formData.get("bahokMerchantId") || "").trim();
    const bahokApiKey = String(formData.get("bahokApiKey") || "").trim();
    const bahokApiToken = String(formData.get("bahokApiToken") || "").trim();
    const bahokWebhookSecret = String(formData.get("bahokWebhookSecret") || "").trim();

    const updateSet: Record<string, any> = {
      shopDomain,
      bahokMerchantId,
      bahokApiKey,
    };

    if (!isMaskedOrEmpty(bahokApiToken)) {
      updateSet.bahokApiToken = encryptSecret(bahokApiToken);
    } else if (rawExisting?.bahokApiToken) {
      updateSet.bahokApiToken = rawExisting.bahokApiToken;
    }

    if (!isMaskedOrEmpty(bahokWebhookSecret)) {
      updateSet.bahokWebhookSecret = encryptSecret(bahokWebhookSecret);
    } else if (rawExisting?.bahokWebhookSecret) {
      updateSet.bahokWebhookSecret = rawExisting.bahokWebhookSecret;
    }

    const defaultCourierParam = String(formData.get("defaultCourier") || "").trim();
    if (defaultCourierParam && ["pathao", "steadfast", "redx", "carrybee", "bahok"].includes(defaultCourierParam)) {
      updateSet.defaultCourier = defaultCourierParam;
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const effectiveToken = updateSet.bahokApiToken || rawExisting?.bahokApiToken;
    const isFullyConnected = Boolean(bahokApiKey && effectiveToken);

    return json({
      success: true,
      actionType: "saveBahok",
      message: isFullyConnected
        ? "Bahok Courier credentials saved and connected successfully."
        : "Bahok configuration saved (some fields were left blank).",
    });
  }

  // ==================== 4. SAVE ROUTING & FRAUD SAFETY SETTINGS ====================
  if (actionType === "saveRoutingSettings") {
    const isAutoRoutingEnabled =
      String(formData.get("isAutoRoutingEnabled")) === "true" ||
      String(formData.get("autoRoutingEnabled")) === "true";

    const defaultCourierRaw = String(
      formData.get("defaultCourier") || "steadfast"
    ).trim();
    const validCouriers = ["pathao", "steadfast", "redx", "carrybee", "bahok"];
    const defaultCourier = validCouriers.includes(defaultCourierRaw)
      ? defaultCourierRaw
      : "steadfast";

    const insideDhakaCourierRaw = String(
      formData.get("insideDhakaCourier") || "pathao"
    ).trim();
    const insideDhakaCourier = validCouriers.includes(insideDhakaCourierRaw)
      ? insideDhakaCourierRaw
      : "pathao";

    const outsideDhakaCourierRaw = String(
      formData.get("outsideDhakaCourier") || "steadfast"
    ).trim();
    const outsideDhakaCourier = validCouriers.includes(outsideDhakaCourierRaw)
      ? outsideDhakaCourierRaw
      : "steadfast";

    const minSuccessRateRaw = Number(
      formData.get("minSuccessRate") ?? formData.get("minSafetySuccessRate") ?? 70
    );
    const minSuccessRate = Math.min(
      100,
      Math.max(
        0,
        Number.isNaN(minSuccessRateRaw) ? 70 : Math.round(minSuccessRateRaw)
      )
    );

    const customRoutesJson = String(formData.get("customRoutes") || "[]");
    let parsedRoutes: CustomRouteRule[] = [];

    try {
      const rawArray = JSON.parse(customRoutesJson);
      if (Array.isArray(rawArray)) {
        parsedRoutes = rawArray
          .filter((item) => item && typeof item === "object")
          .map((item) => {
            const division =
              BANGLADESH_LOCATIONS[String(item.division)] !== undefined
                ? String(item.division)
                : "Dhaka";

            const divisionDistricts = BANGLADESH_LOCATIONS[division] || [];
            const requestedDistrict = String(
              item.district || "All Districts in Division"
            );

            const district =
              requestedDistrict === "All Districts in Division" ||
              divisionDistricts.includes(requestedDistrict)
                ? requestedDistrict
                : "All Districts in Division";

            const courier = validCouriers.includes(String(item.courier))
              ? String(item.courier)
              : "pathao";

            return { division, district, courier };
          });
      }
    } catch {
      // ignore JSON parse error
    }

    if (parsedRoutes.length === 0 && (!customRoutesJson || customRoutesJson === "[]")) {
      parsedRoutes = [
        { division: "Dhaka", district: "Dhaka", courier: "pathao" },
        {
          division: "Chattogram",
          district: "All Districts in Division",
          courier: "steadfast",
        },
      ];
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          shopDomain,
          autoRoutingEnabled: isAutoRoutingEnabled,
          isAutoRoutingEnabled,
          customRoutes: parsedRoutes,
          defaultCourier,
          insideDhakaCourier,
          outsideDhakaCourier,
          minSafetySuccessRate: minSuccessRate,
          minSuccessRate,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return json({
      success: true,
      actionType: "saveRoutingSettings",
      message: `Saved ${parsedRoutes.length} dynamic geo-routing rule(s), default courier (${defaultCourier.toUpperCase()}), and ${minSuccessRate}% fraud safety threshold.`,
    });
  }

  // ==================== 5. SAVE AI ADDRESS NORMALIZER SETTINGS ====================
  if (actionType === "saveAiSettings") {
    const aiAddressCleaningEnabled =
      String(formData.get("aiAddressCleaningEnabled")) === "true";

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          shopDomain,
          aiAddressCleaningEnabled,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return json({
      success: true,
      actionType: "saveAiSettings",
      message: aiAddressCleaningEnabled
        ? "Gemini AI Address Normalizer is active. Cleaned addresses will be automatically saved upon courier dispatch."
        : "Gemini AI Address Normalizer disabled. Raw Shopify customer addresses will be forwarded directly.",
    });
  }

  return json({
    success: false,
    actionType,
    message: "Unknown action submitted.",
  });
};

export default function CourierSettingsPage() {
  const {
    shopDomain,
    currentPlan,
    courierConfig,
    routingConfig,
    aiConfig,
    appUrl,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const searchStr = searchParams.toString() ? `?${searchParams.toString()}` : "";

  const [showBanner, setShowBanner] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    }
  };

  const webhookSecret = courierConfig.webhookSecret || "";
  const tokenParam = webhookSecret ? `&token=${encodeURIComponent(webhookSecret)}` : "";
  const pathaoWebhookUrl = `${appUrl}/api/webhooks/pathao?shop=${encodeURIComponent(shopDomain)}${tokenParam}`;
  const steadfastWebhookUrl = `${appUrl}/api/webhooks/steadfast?shop=${encodeURIComponent(shopDomain)}${tokenParam}`;
  const redxWebhookUrl = `${appUrl}/api/webhooks/redx?shop=${encodeURIComponent(shopDomain)}${tokenParam}`;
  const carrybeeWebhookUrl = `${appUrl}/api/webhooks/carrybee?shop=${encodeURIComponent(shopDomain)}${tokenParam}`;
  const bahokWebhookUrl = `${appUrl}/api/webhooks/bahok?shop=${encodeURIComponent(shopDomain)}${tokenParam}`;

  // Sub-view & Tabbed Navigation States (Section 2 Competitor UX)
  type CourierId = "pathao" | "steadfast" | "redx" | "carrybee" | "bahok";
  type SetupTab = "api" | "webhook" | "settings";

  const [activeCourierId, setActiveCourierId] = useState<CourierId | null>(null);
  const [activeSetupTab, setActiveSetupTab] = useState<SetupTab>("api");

  // Collapsible gateway form states (kept for backward-compatible action triggers)
  const [showPathaoForm, setShowPathaoForm] = useState(false);
  const [showSteadfastForm, setShowSteadfastForm] = useState(false);
  const [showRedxForm, setShowRedxForm] = useState(false);
  const [showCarrybeeForm, setShowCarrybeeForm] = useState(false);
  const [showBahokForm, setShowBahokForm] = useState(false);

  const handleToggleCourierForm = (
    courier: "pathao" | "steadfast" | "redx" | "carrybee" | "bahok"
  ) => {
    if (courier === "pathao") {
      setShowPathaoForm((prev) => !prev);
      setShowSteadfastForm(false);
      setShowRedxForm(false);
      setShowCarrybeeForm(false);
      setShowBahokForm(false);
    } else if (courier === "steadfast") {
      setShowSteadfastForm((prev) => !prev);
      setShowPathaoForm(false);
      setShowRedxForm(false);
      setShowCarrybeeForm(false);
      setShowBahokForm(false);
    } else if (courier === "redx") {
      setShowRedxForm((prev) => !prev);
      setShowPathaoForm(false);
      setShowSteadfastForm(false);
      setShowCarrybeeForm(false);
      setShowBahokForm(false);
    } else if (courier === "carrybee") {
      setShowCarrybeeForm((prev) => !prev);
      setShowPathaoForm(false);
      setShowSteadfastForm(false);
      setShowRedxForm(false);
      setShowBahokForm(false);
    } else if (courier === "bahok") {
      setShowBahokForm((prev) => !prev);
      setShowPathaoForm(false);
      setShowSteadfastForm(false);
      setShowRedxForm(false);
      setShowCarrybeeForm(false);
    }
  };

  // ==================== 1. PATHAO GATEWAY STATE ====================
  const pathaoEnvironment = "production";
  const [pathaoClientId, setPathaoClientId] = useState(courierConfig.pathaoClientId);
  const [pathaoSecret, setPathaoSecret] = useState(courierConfig.pathaoSecret);
  const [pathaoUsername, setPathaoUsername] = useState(courierConfig.pathaoUsername || "");
  const [pathaoPassword, setPathaoPassword] = useState(courierConfig.pathaoPassword || "");
  const [pathaoStoreId, setPathaoStoreId] = useState(courierConfig.pathaoStoreId);
  const [pathaoStoreName, setPathaoStoreName] = useState(courierConfig.pathaoStoreName || "");
  const [showPathaoSecret, setShowPathaoSecret] = useState(false);
  const [showPathaoPassword, setShowPathaoPassword] = useState(false);
  const [pathaoStores, setPathaoStores] = useState<PathaoStore[]>([]);
  const [pathaoDefaultWeight, setPathaoDefaultWeight] = useState("0.5");
  const [pathaoParcelNote, setPathaoParcelNote] = useState("");
  const [pathaoDeliveryType, setPathaoDeliveryType] = useState("regular");

  const handleResetPathao = () => {
    setPathaoDefaultWeight("0.5");
    setPathaoParcelNote("");
    setPathaoDeliveryType("regular");
    setDefaultCourier(routingConfig.defaultCourier || "steadfast");
  };

  const handleResetSteadfast = () => {
    setSteadfastDeliveryType("home");
    setSteadfastParcelNote("");
    setDefaultCourier(routingConfig.defaultCourier || "steadfast");
  };

  const handleResetRedX = () => {
    setRedxDefaultWeight("0.5");
    setRedxParcelNote("");
    setDefaultCourier(routingConfig.defaultCourier || "steadfast");
  };

  const handleResetCarrybee = () => {
    setCarrybeeDefaultWeight("0.5");
    setCarrybeeParcelNote("");
    setCarrybeeDeliveryType("normal");
    setCarrybeeProductType("parcel");
    setDefaultCourier(routingConfig.defaultCourier || "steadfast");
  };

  const handleResetBahok = () => {
    setBahokParcelNote("");
    setDefaultCourier(routingConfig.defaultCourier || "steadfast");
  };

  const isPathaoConnected = Boolean(
    pathaoClientId.trim() &&
      (courierConfig.hasPathaoSecret || pathaoSecret.trim()) &&
      pathaoStoreId.trim()
  );

  const isSubmittingPathao =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "savePathao";

  const isFetchingPathaoStores =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "fetchPathaoStores";

  const isRegeneratingWebhookSecret =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "regenerateWebhookSecret";

  const handleRegenerateWebhookSecret = () => {
    if (
      !window.confirm(
        "Rotate Webhook Secret Token?\n\nThis will immediately regenerate your store's webhook secret token. You must copy and update the new Webhook Callback URLs in your Pathao, Steadfast, and REDX merchant portals."
      )
    ) {
      return;
    }
    const formData = new FormData();
    formData.append("actionType", "regenerateWebhookSecret");
    submit(formData, { method: "post" });
  };

  const handleFetchPathaoStores = () => {
    const formData = new FormData();
    formData.append("actionType", "fetchPathaoStores");
    formData.append("pathaoEnvironment", pathaoEnvironment);
    formData.append("pathaoClientId", pathaoClientId);
    formData.append("pathaoSecret", pathaoSecret);
    formData.append("pathaoUsername", pathaoUsername);
    formData.append("pathaoPassword", pathaoPassword);
    submit(formData, { method: "post" });
  };

  const handleSavePathao = () => {
    const formData = new FormData();
    formData.append("actionType", "savePathao");
    formData.append("pathaoEnvironment", pathaoEnvironment);
    formData.append("pathaoClientId", pathaoClientId);
    formData.append("pathaoSecret", pathaoSecret);
    formData.append("pathaoUsername", pathaoUsername);
    formData.append("pathaoPassword", pathaoPassword);
    formData.append("pathaoStoreId", pathaoStoreId);
    formData.append("pathaoStoreName", pathaoStoreName);
    formData.append("defaultCourier", defaultCourier);
    formData.append("pathaoDefaultWeight", pathaoDefaultWeight);
    formData.append("pathaoParcelNote", pathaoParcelNote);
    formData.append("pathaoDeliveryType", pathaoDeliveryType);
    submit(formData, { method: "post" });
  };

  // ==================== 2. STEADFAST GATEWAY STATE ====================
  const [steadfastApiKey, setSteadfastApiKey] = useState(courierConfig.steadfastApiKey);
  const [steadfastSecretKey, setSteadfastSecretKey] = useState(courierConfig.steadfastSecretKey);
  const [showSteadfastSecret, setShowSteadfastSecret] = useState(false);
  const [steadfastDeliveryType, setSteadfastDeliveryType] = useState("home");
  const [steadfastParcelNote, setSteadfastParcelNote] = useState("");

  const isSteadfastConnected = Boolean(
    steadfastApiKey.trim() &&
      (courierConfig.hasSteadfastSecretKey || steadfastSecretKey.trim())
  );

  const isSubmittingSteadfast =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveSteadfast";

  const handleSaveSteadfast = () => {
    const formData = new FormData();
    formData.append("actionType", "saveSteadfast");
    formData.append("steadfastApiKey", steadfastApiKey);
    formData.append("steadfastSecretKey", steadfastSecretKey);
    formData.append("defaultCourier", defaultCourier);
    formData.append("steadfastDeliveryType", steadfastDeliveryType);
    formData.append("steadfastParcelNote", steadfastParcelNote);
    submit(formData, { method: "post" });
  };

  // ==================== 3. REDX GATEWAY STATE ====================
  const redxEnvironment = "production";
  const [redxAccessToken, setRedxAccessToken] = useState(courierConfig.redxAccessToken || "");
  const [redxPickupStoreId, setRedxPickupStoreId] = useState(
    courierConfig.redxPickupStoreId || courierConfig.redxLocationId || ""
  );
  const [redxPickupStoreName, setRedxPickupStoreName] = useState(
    courierConfig.redxPickupStoreName || ""
  );
  const [redxProfileId, setRedxProfileId] = useState(courierConfig.redxProfileId || "");
  const [redxLocationId, setRedxLocationId] = useState(
    courierConfig.redxLocationId || courierConfig.redxPickupStoreId || ""
  );
  const [showRedxToken, setShowRedxToken] = useState(false);
  const [redxStores, setRedxStores] = useState<RedxStore[]>([]);
  const [redxDefaultWeight, setRedxDefaultWeight] = useState("0.5");
  const [redxParcelNote, setRedxParcelNote] = useState("");

  const isRedxConnected = Boolean(
    ((courierConfig.hasRedxAccessToken || redxAccessToken.trim()) && redxPickupStoreId.trim()) ||
    (redxProfileId.trim() && redxLocationId.trim())
  );

  const isSubmittingRedx =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveRedX";

  const isFetchingRedxStores =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "fetchRedxStores";

  const handleFetchRedxStores = () => {
    const formData = new FormData();
    formData.append("actionType", "fetchRedxStores");
    formData.append("redxEnvironment", "production");
    formData.append("redxAccessToken", redxAccessToken);
    submit(formData, { method: "post" });
  };

  const handleSaveRedX = () => {
    const formData = new FormData();
    formData.append("actionType", "saveRedX");
    formData.append("redxEnvironment", "production");
    formData.append("redxAccessToken", redxAccessToken);
    formData.append("redxPickupStoreId", redxPickupStoreId);
    formData.append("redxPickupStoreName", redxPickupStoreName);
    formData.append("redxProfileId", redxProfileId || redxPickupStoreName || redxPickupStoreId);
    formData.append("redxLocationId", redxLocationId || redxPickupStoreId);
    formData.append("defaultCourier", defaultCourier);
    formData.append("redxDefaultWeight", redxDefaultWeight);
    formData.append("redxParcelNote", redxParcelNote);
    submit(formData, { method: "post" });
  };

  // ==================== 4. CARRYBEE GATEWAY STATE ====================
  const [carrybeeClientId, setCarrybeeClientId] = useState(courierConfig.carrybeeClientId || "");
  const [carrybeeClientSecret, setCarrybeeClientSecret] = useState(courierConfig.carrybeeClientSecret || "");
  const [carrybeeClientContext, setCarrybeeClientContext] = useState(courierConfig.carrybeeClientContext || "");
  const [carrybeeStoreId, setCarrybeeStoreId] = useState(courierConfig.carrybeeStoreId || "");
  const [carrybeeSandbox, setCarrybeeSandbox] = useState(courierConfig.carrybeeSandbox || false);
  const [carrybeeWebhookSecret, setCarrybeeWebhookSecret] = useState(courierConfig.carrybeeWebhookSecret || "");
  const [showCarrybeeSecret, setShowCarrybeeSecret] = useState(false);
  const [showCarrybeeContext, setShowCarrybeeContext] = useState(false);
  const [showCarrybeeWebhookSecret, setShowCarrybeeWebhookSecret] = useState(false);
  const [carrybeeDefaultWeight, setCarrybeeDefaultWeight] = useState("0.5");
  const [carrybeeParcelNote, setCarrybeeParcelNote] = useState("");
  const [carrybeeDeliveryType, setCarrybeeDeliveryType] = useState("normal");
  const [carrybeeProductType, setCarrybeeProductType] = useState("parcel");

  const isCarrybeeConnected = Boolean(
    carrybeeClientId.trim() &&
      (courierConfig.hasCarrybeeSecret || carrybeeClientSecret.trim()) &&
      (courierConfig.hasCarrybeeContext || carrybeeClientContext.trim())
  );

  const isSubmittingCarrybee =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveCarrybee";

  const handleSaveCarrybee = () => {
    const formData = new FormData();
    formData.append("actionType", "saveCarrybee");
    formData.append("carrybeeClientId", carrybeeClientId);
    formData.append("carrybeeClientSecret", carrybeeClientSecret);
    formData.append("carrybeeClientContext", carrybeeClientContext);
    formData.append("carrybeeStoreId", carrybeeStoreId);
    formData.append("carrybeeSandbox", String(carrybeeSandbox));
    formData.append("carrybeeWebhookSecret", carrybeeWebhookSecret);
    formData.append("defaultCourier", defaultCourier);
    formData.append("carrybeeDefaultWeight", carrybeeDefaultWeight);
    formData.append("carrybeeParcelNote", carrybeeParcelNote);
    formData.append("carrybeeDeliveryType", carrybeeDeliveryType);
    formData.append("carrybeeProductType", carrybeeProductType);
    submit(formData, { method: "post" });
  };

  // ==================== 5. BAHOK GATEWAY STATE ====================
  const [bahokMerchantId, setBahokMerchantId] = useState(courierConfig.bahokMerchantId || "");
  const [bahokApiKey, setBahokApiKey] = useState(courierConfig.bahokApiKey || "");
  const [bahokApiToken, setBahokApiToken] = useState(courierConfig.bahokApiToken || "");
  const [bahokWebhookSecret, setBahokWebhookSecret] = useState(courierConfig.bahokWebhookSecret || "");
  const [showBahokToken, setShowBahokToken] = useState(false);
  const [showBahokWebhookSecret, setShowBahokWebhookSecret] = useState(false);
  const [bahokParcelNote, setBahokParcelNote] = useState("");

  const isBahokConnected = Boolean(
    bahokApiKey.trim() &&
      (courierConfig.hasBahokApiToken || bahokApiToken.trim())
  );

  const isSubmittingBahok =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveBahok";

  const handleSaveBahok = () => {
    const formData = new FormData();
    formData.append("actionType", "saveBahok");
    formData.append("bahokMerchantId", bahokMerchantId);
    formData.append("bahokApiKey", bahokApiKey);
    formData.append("bahokApiToken", bahokApiToken);
    formData.append("bahokWebhookSecret", bahokWebhookSecret);
    formData.append("defaultCourier", defaultCourier);
    formData.append("bahokParcelNote", bahokParcelNote);
    submit(formData, { method: "post" });
  };

  useEffect(() => {
    if (actionData) {
      setShowBanner(true);
      if (actionData.actionType === "fetchPathaoStores" || actionData.actionType === "savePathao") {
        setShowPathaoForm(true);
        setActiveCourierId("pathao");
      }
      if (actionData.actionType === "saveSteadfast") {
        setShowSteadfastForm(true);
        setActiveCourierId("steadfast");
      }
      if (actionData.actionType === "fetchRedxStores" || actionData.actionType === "saveRedX") {
        setShowRedxForm(true);
        setActiveCourierId("redx");
      }
      if (actionData.actionType === "saveCarrybee") {
        setShowCarrybeeForm(true);
        setActiveCourierId("carrybee");
      }
      if (actionData.actionType === "saveBahok") {
        setShowBahokForm(true);
        setActiveCourierId("bahok");
      }
      if (actionData.actionType === "fetchPathaoStores" && (actionData as any).stores) {
        const fetched = (actionData as any).stores as PathaoStore[];
        setPathaoStores(fetched);
        if (fetched.length > 0 && !pathaoStoreId) {
          setPathaoStoreId(fetched[0].store_id);
          setPathaoStoreName(fetched[0].store_name);
        }
      }
      if (actionData.actionType === "fetchRedxStores" && (actionData as any).stores) {
        const fetched = (actionData as any).stores as RedxStore[];
        setRedxStores(fetched);
        if (fetched.length > 0 && !redxPickupStoreId) {
          setRedxPickupStoreId(fetched[0].id);
          setRedxPickupStoreName(fetched[0].name);
        }
      }
    }
  }, [actionData]);

  // ==================== 4. AI ADDRESS NORMALIZER STATE ====================
  const [aiAddressCleaningEnabled, setAiAddressCleaningEnabled] = useState(
    aiConfig.aiAddressCleaningEnabled
  );

  const isSubmittingAi =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveAiSettings";

  const handleToggleAiCleaning = (checked: boolean) => {
    setAiAddressCleaningEnabled(checked);
    const formData = new FormData();
    formData.append("actionType", "saveAiSettings");
    formData.append("aiAddressCleaningEnabled", String(checked));
    submit(formData, { method: "post" });
  };

  // ==================== 5. AUTO-ROUTING ENGINE STATE ====================
  const [isAutoRoutingEnabled, setIsAutoRoutingEnabled] = useState<boolean>(
    routingConfig.isAutoRoutingEnabled ?? routingConfig.autoRoutingEnabled ?? false
  );
  const [customRoutes, setCustomRoutes] = useState<CustomRouteRule[]>(
    routingConfig.customRoutes || []
  );
  const [defaultCourier, setDefaultCourier] = useState<string>(
    routingConfig.defaultCourier || "steadfast"
  );
  const [insideDhakaCourier, setInsideDhakaCourier] = useState<string>(
    routingConfig.insideDhakaCourier || "pathao"
  );
  const [outsideDhakaCourier, setOutsideDhakaCourier] = useState<string>(
    routingConfig.outsideDhakaCourier || "steadfast"
  );
  const [minSuccessRate, setMinSuccessRate] = useState<string>(
    String(routingConfig.minSuccessRate ?? routingConfig.minSafetySuccessRate ?? 70)
  );

  useEffect(() => {
    const isEnabled = Boolean(
      routingConfig.isAutoRoutingEnabled ?? routingConfig.autoRoutingEnabled ?? false
    );
    const rateStr = String(
      routingConfig.minSuccessRate ?? routingConfig.minSafetySuccessRate ?? 70
    );
    setIsAutoRoutingEnabled(isEnabled);
    setCustomRoutes(routingConfig.customRoutes || []);
    setDefaultCourier(routingConfig.defaultCourier || "steadfast");
    setInsideDhakaCourier(routingConfig.insideDhakaCourier || "pathao");
    setOutsideDhakaCourier(routingConfig.outsideDhakaCourier || "steadfast");
    setMinSuccessRate(rateStr);
  }, [routingConfig]);

  const divisionSelectOptions = Object.keys(BANGLADESH_LOCATIONS).map(
    (divisionName) => ({
      label: `${divisionName} Division`,
      value: divisionName,
    })
  );

  const getDistrictSelectOptions = (selectedDivision: string) => {
    const districts = BANGLADESH_LOCATIONS[selectedDivision] || [];
    return [
      {
        label: `All Districts in ${selectedDivision} Division`,
        value: "All Districts in Division",
      },
      ...districts.map((districtName) => ({
        label: districtName,
        value: districtName,
      })),
    ];
  };

  const handleDivisionChange = (index: number, newDivision: string) => {
    setCustomRoutes((prevRoutes) =>
      prevRoutes.map((row, idx) =>
        idx === index
          ? {
              ...row,
              division: newDivision,
              district: "All Districts in Division",
            }
          : row
      )
    );
  };

  const handleDistrictChange = (index: number, newDistrict: string) => {
    setCustomRoutes((prevRoutes) =>
      prevRoutes.map((row, idx) =>
        idx === index ? { ...row, district: newDistrict } : row
      )
    );
  };

  const handleCourierChange = (index: number, newCourier: string) => {
    setCustomRoutes((prevRoutes) =>
      prevRoutes.map((row, idx) =>
        idx === index ? { ...row, courier: newCourier } : row
      )
    );
  };

  const handleAddRuleRow = () => {
    setCustomRoutes((prevRoutes) => [
      ...prevRoutes,
      {
        division: "Dhaka",
        district: "All Districts in Division",
        courier: "pathao",
      },
    ]);
  };

  const handleRemoveRuleRow = (indexToRemove: number) => {
    setCustomRoutes((prevRoutes) =>
      prevRoutes.filter((_, idx) => idx !== indexToRemove)
    );
  };

  // ==================== 6. TOP SETTINGS NAVIGATION TABS ====================
  const settingsNavTabs = [
    {
      id: "courier_integration",
      content: "Courier Integration",
      accessibilityLabel: "Courier Integration",
      panelID: "courier-integration-panel",
    },
    {
      id: "shipping_label",
      content: "Shipping Label",
      accessibilityLabel: "Shipping Label",
      panelID: "shipping-label-panel",
    },
    {
      id: "invoice",
      content: "Invoice",
      accessibilityLabel: "Invoice",
      panelID: "invoice-panel",
    },
  ];

  const [selectedSettingsTab, setSelectedSettingsTab] = useState<
    "courier_integration" | "shipping_label" | "invoice"
  >("courier_integration");

  const selectedSettingsTabIndex = Math.max(
    0,
    settingsNavTabs.findIndex((t) => t.id === selectedSettingsTab)
  );

  const handleSettingsTabChange = (selectedTabIndex: number) => {
    const nextTab = settingsNavTabs[selectedTabIndex]?.id as
      | "courier_integration"
      | "shipping_label"
      | "invoice";
    if (nextTab) {
      setSelectedSettingsTab(nextTab);
    }
  };

  const isSavingRoutingSettings =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveRoutingSettings";

  const handleSaveRoutingSettings = () => {
    const formData = new FormData();
    formData.append("actionType", "saveRoutingSettings");
    formData.append("isAutoRoutingEnabled", String(isAutoRoutingEnabled));
    formData.append("autoRoutingEnabled", String(isAutoRoutingEnabled));
    formData.append("defaultCourier", defaultCourier);
    formData.append("insideDhakaCourier", insideDhakaCourier);
    formData.append("outsideDhakaCourier", outsideDhakaCourier);
    formData.append("minSuccessRate", minSuccessRate || "70");
    formData.append("minSafetySuccessRate", minSuccessRate || "70");
    formData.append("customRoutes", JSON.stringify(customRoutes));
    submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="Courier Settings" />

      <BlockStack gap="500">
        {/* Top Settings Navigation Bar */}
        <div
          style={{
            borderBottom: "1px solid var(--p-color-border, #E1E3E5)",
            background: "var(--p-color-bg-surface, #FFFFFF)",
            borderRadius: "8px",
          }}
        >
          <Tabs
            tabs={settingsNavTabs}
            selected={selectedSettingsTabIndex}
            onSelect={handleSettingsTabChange}
          />
        </div>

        {showBanner && actionData?.message && (
          <Banner
            title={actionData.success ? "Settings Saved" : "Validation Error"}
            tone={actionData.success ? "success" : "critical"}
            onDismiss={() => setShowBanner(false)}
          >
            <p>{actionData.message}</p>
          </Banner>
        )}

        {/* ==================================================================== */}
        {/* SCENARIO A: COURIER INTEGRATION VIEW WRAPPER                         */}
        {/* ==================================================================== */}
        <div style={{ display: selectedSettingsTab === "courier_integration" ? "block" : "none" }}>
          {/* ==================================================================== */}
          {/* SECTION 1 & 2: DUAL-PANE SUB-VIEW OR 3-COLUMN DASHBOARD GRID         */}
          {/* ==================================================================== */}
          {activeCourierId ? (
          /* ================================================================ */
          /* DEDICATED INNER SUB-VIEW: DUAL-PANE COURIER CONFIGURATION        */
          /* ================================================================ */
          <BlockStack gap="500">
            {/* Back Button Action: ← All couriers */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
              <button
                type="button"
                onClick={() => {
                  setActiveCourierId(null);
                  setActiveSetupTab("api");
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 0",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#2563EB",
                  transition: "color 0.15s ease",
                }}
              >
                <span>&larr; All couriers</span>
              </button>
            </div>

            {/* Dual-Pane Layout (2-Column Grid) */}
            <div
              className="flex flex-col md:flex-row gap-6 items-start"
              style={{
                display: "flex",
                gap: "24px",
                alignItems: "flex-start",
                width: "100%",
              }}
            >
              {/* LEFT SIDEBAR PANEL (Width: ~25%-30%) */}
              <div
                className="w-full md:w-80 flex-shrink-0"
                style={{
                  width: "280px",
                  backgroundColor: "#FFFFFF",
                  borderRadius: "16px",
                  padding: "20px",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                  border: "1px solid #E2E8F0",
                }}
              >
                {/* Respective Courier Logo & Title */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "16px",
                    paddingBottom: "16px",
                    borderBottom: "1px solid #F1F5F9",
                  }}
                >
                  <CourierLogo courier={activeCourierId} size={42} />
                  <div>
                    <Text as="h2" variant="headingMd" fontWeight="bold">
                      {activeCourierId === "pathao" && "Pathao Courier"}
                      {activeCourierId === "steadfast" && "Steadfast Courier"}
                      {activeCourierId === "redx" && "REDX Delivery"}
                      {activeCourierId === "carrybee" && "CarryBee Logistics"}
                      {activeCourierId === "bahok" && "Bahok Courier"}
                    </Text>
                    <div style={{ marginTop: "4px" }}>
                      <Badge
                        tone={
                          (activeCourierId === "pathao" && isPathaoConnected) ||
                          (activeCourierId === "steadfast" && isSteadfastConnected) ||
                          (activeCourierId === "redx" && isRedxConnected) ||
                          (activeCourierId === "carrybee" && isCarrybeeConnected) ||
                          (activeCourierId === "bahok" && isBahokConnected)
                            ? "success"
                            : undefined
                        }
                      >
                        {((activeCourierId === "pathao" && isPathaoConnected) ||
                        (activeCourierId === "steadfast" && isSteadfastConnected) ||
                        (activeCourierId === "redx" && isRedxConnected) ||
                        (activeCourierId === "carrybee" && isCarrybeeConnected) ||
                        (activeCourierId === "bahok" && isBahokConnected))
                          ? "● Active"
                          : "Not Configured"}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* 3 Interactive Tab Buttons Stacked Vertically */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setActiveSetupTab("api")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      fontSize: "13px",
                      fontWeight: activeSetupTab === "api" ? 700 : 500,
                      backgroundColor: activeSetupTab === "api" ? "#F1F5F9" : "transparent",
                      color: activeSetupTab === "api" ? "#0F172A" : "#64748B",
                      border: activeSetupTab === "api" ? "1px solid #CBD5E1" : "1px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span style={{ fontSize: "15px" }}>🔑</span>
                    <span>API Configuration</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSetupTab("webhook")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      fontSize: "13px",
                      fontWeight: activeSetupTab === "webhook" ? 700 : 500,
                      backgroundColor: activeSetupTab === "webhook" ? "#F1F5F9" : "transparent",
                      color: activeSetupTab === "webhook" ? "#0F172A" : "#64748B",
                      border: activeSetupTab === "webhook" ? "1px solid #CBD5E1" : "1px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span style={{ fontSize: "15px" }}>🔗</span>
                    <span>Webhook</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSetupTab("settings")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      fontSize: "13px",
                      fontWeight: activeSetupTab === "settings" ? 700 : 500,
                      backgroundColor: activeSetupTab === "settings" ? "#F1F5F9" : "transparent",
                      color: activeSetupTab === "settings" ? "#0F172A" : "#64748B",
                      border: activeSetupTab === "settings" ? "1px solid #CBD5E1" : "1px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span style={{ fontSize: "15px" }}>⚙️</span>
                    <span>Default Settings</span>
                  </button>
                </div>
              </div>

              {/* RIGHT CONTENT PANEL (Width: ~70%-75%) */}
              <div style={{ flex: 1, width: "100%", minWidth: 0 }}>
                <Card padding="600">
                  {/* ==================== 1. PATHAO SUB-VIEW ==================== */}
                  {activeCourierId === "pathao" && (
                    <>
                      {/* Tab 1: API Configuration */}
                      {activeSetupTab === "api" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd" fontWeight="bold">Pathao API Credentials</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Enter your Pathao Merchant API credentials to enable automated consignment creation.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="Client ID"
                              value={pathaoClientId}
                              onChange={(val) => setPathaoClientId(val)}
                              placeholder="e.g. pt_client_live_..."
                              autoComplete="off"
                            />
                            <TextField
                              label="Client Secret"
                              type={showPathaoSecret ? "text" : "password"}
                              value={pathaoSecret}
                              onChange={(val) => setPathaoSecret(val)}
                              placeholder="••••••••••••••••"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowPathaoSecret((prev) => !prev)}
                                >
                                  {showPathaoSecret ? "Hide" : "Show"}
                                </Button>
                              }
                              helpText="Stored encrypted with AES-256-GCM."
                            />
                            <TextField
                              label="Merchant Username (Email)"
                              value={pathaoUsername}
                              onChange={(val) => setPathaoUsername(val)}
                              placeholder="merchant@example.com"
                              autoComplete="off"
                              helpText="Merchant Portal login email (used for OAuth token authorization)."
                            />
                            <TextField
                              label="Merchant Password"
                              type={showPathaoPassword ? "text" : "password"}
                              value={pathaoPassword}
                              onChange={(val) => setPathaoPassword(val)}
                              placeholder="••••••••••••••••"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowPathaoPassword((prev) => !prev)}
                                >
                                  {showPathaoPassword ? "Hide" : "Show"}
                                </Button>
                              }
                              helpText="Stored encrypted with AES-256-GCM."
                            />
                            <InlineStack gap="300" blockAlign="center">
                              <Button
                                size="medium"
                                loading={isFetchingPathaoStores}
                                onClick={handleFetchPathaoStores}
                              >
                                Verify Credentials & Fetch Stores
                              </Button>
                              <Text as="p" variant="bodyXs" tone="subdued">
                                Authenticate and load pickup stores directly from Pathao API.
                              </Text>
                            </InlineStack>
                            {pathaoStores.length > 0 ? (
                              <Select
                                label="Default Pickup Store"
                                options={[
                                  { label: "-- Select Active Pathao Store --", value: "" },
                                  ...pathaoStores.map((st) => ({
                                    label: `${st.store_name} (ID: ${st.store_id})`,
                                    value: String(st.store_id),
                                  })),
                                ]}
                                value={pathaoStoreId}
                                onChange={(val) => {
                                  setPathaoStoreId(val);
                                  const found = pathaoStores.find((s) => String(s.store_id) === String(val));
                                  if (found) setPathaoStoreName(found.store_name);
                                }}
                                helpText="Selected pickup warehouse used for all one-click parcel dispatches."
                              />
                            ) : (
                              <TextField
                                label="Pathao Store ID"
                                value={pathaoStoreId}
                                onChange={(val) => setPathaoStoreId(val)}
                                placeholder="e.g. 12345"
                                autoComplete="off"
                                helpText="Numeric store ID from Pathao. Click 'Verify Credentials & Fetch Stores' above to auto-detect."
                              />
                            )}
                            <TextField
                              label="Store Name"
                              value={pathaoStoreName}
                              onChange={(val) => setPathaoStoreName(val)}
                              placeholder="e.g. Main Warehouse"
                              autoComplete="off"
                            />
                          </BlockStack>
                          <Divider />
                          <InlineStack align="end">
                            <Button
                              variant="primary"
                              loading={isSubmittingPathao}
                              onClick={handleSavePathao}
                            >
                              Save Settings
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      )}

                      {/* Tab 2: Webhook */}
                      {activeSetupTab === "webhook" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingMd" fontWeight="bold">Real-Time Webhook (Two-Way Status Sync)</Text>
                              <Badge tone="info">Live Webhook</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Copy and paste these parameters in Pathao Developer Portal &rarr; Webhook Setup to enable real-time delivery status updates.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="Callback URL"
                              value={pathaoWebhookUrl}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(pathaoWebhookUrl, "pathao_url")}>
                                  {copiedKey === "pathao_url" ? "Copied!" : "Copy URL"}
                                </Button>
                              }
                              helpText="Enter as the Callback URL in Pathao Merchant Portal."
                            />
                            <TextField
                              label="Secret Token"
                              value={webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(webhookSecret, "pathao_secret")}>
                                  {copiedKey === "pathao_secret" ? "Copied!" : "Copy Token"}
                                </Button>
                              }
                              helpText="Paste in Pathao Webhook Secret Token field to verify webhook signature."
                            />
                            <InlineStack align="end">
                              <Button
                                size="micro"
                                variant="plain"
                                tone="critical"
                                onClick={handleRegenerateWebhookSecret}
                                loading={isRegeneratingWebhookSecret}
                              >
                                Rotate / Regenerate Webhook Token
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </BlockStack>
                      )}

                      {/* Tab 3: Default Settings */}
                      {activeSetupTab === "settings" && (
                        <Card padding="500">
                          <BlockStack gap="400">
                            <BlockStack gap="100">
                              <Text as="h3" variant="headingMd" fontWeight="bold">Pathao Fulfillment &amp; Delivery Defaults</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Configure default parcel preferences and automated dispatch parameters for Pathao Courier.
                              </Text>
                            </BlockStack>
                            <Divider />
                            <BlockStack gap="400">
                              <Checkbox
                                label="Set Pathao as default courier"
                                checked={defaultCourier === "pathao"}
                                onChange={(newChecked) => {
                                  setDefaultCourier(newChecked ? "pathao" : "steadfast");
                                }}
                              />
                              <TextField
                                label="Default Parcel Weight (kg)"
                                type="number"
                                value={pathaoDefaultWeight}
                                onChange={(val) => setPathaoDefaultWeight(val)}
                                placeholder="0.5"
                                autoComplete="off"
                                min={0.1}
                                step={0.1}
                              />
                              <TextField
                                label="Default Parcel Note"
                                value={pathaoParcelNote}
                                onChange={(val) => setPathaoParcelNote(val)}
                                placeholder="e.g. Please call customer before delivery"
                                multiline={3}
                                autoComplete="off"
                                helpText="Don't use any special characters or emoji characters."
                              />
                              <BlockStack gap="150">
                                <Text as="p" variant="bodyMd" fontWeight="medium">
                                  Default Delivery Type
                                </Text>
                                <InlineStack gap="400">
                                  <RadioButton
                                    label="Regular Delivery"
                                    checked={pathaoDeliveryType === "regular"}
                                    id="pathao_delivery_regular"
                                    name="pathaoDeliveryType"
                                    onChange={() => setPathaoDeliveryType("regular")}
                                  />
                                  <RadioButton
                                    label="On Demand Delivery (Express)"
                                    checked={pathaoDeliveryType === "express"}
                                    id="pathao_delivery_express"
                                    name="pathaoDeliveryType"
                                    onChange={() => setPathaoDeliveryType("express")}
                                  />
                                </InlineStack>
                              </BlockStack>
                              {pathaoStoreId && (
                                <div style={{ backgroundColor: "#F8FAFC", padding: "14px 16px", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Default Pickup Store: <strong>{pathaoStoreName || pathaoStoreId}</strong> (ID: {pathaoStoreId}). Configured under API Configuration.
                                  </Text>
                                </div>
                              )}
                            </BlockStack>
                            <Divider />
                            <InlineStack align="end" gap="300">
                              <Button variant="secondary" onClick={handleResetPathao}>
                                Reset
                              </Button>
                              <Button
                                variant="primary"
                                loading={isSubmittingPathao}
                                onClick={handleSavePathao}
                              >
                                Save Settings
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Card>
                      )}
                    </>
                  )}

                  {/* ==================== 2. STEADFAST SUB-VIEW ==================== */}
                  {activeCourierId === "steadfast" && (
                    <>
                      {/* Tab 1: API Configuration */}
                      {activeSetupTab === "api" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd" fontWeight="bold">Steadfast API Credentials</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Enter your Steadfast Merchant API credentials for automated consignment creation.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="API Key"
                              value={steadfastApiKey}
                              onChange={(val) => setSteadfastApiKey(val)}
                              placeholder="Enter your Steadfast API Key"
                              autoComplete="off"
                            />
                            <TextField
                              label="Secret Key"
                              type={showSteadfastSecret ? "text" : "password"}
                              value={steadfastSecretKey}
                              onChange={(val) => setSteadfastSecretKey(val)}
                              placeholder="Enter your Steadfast Secret Key"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowSteadfastSecret((prev) => !prev)}
                                >
                                  {showSteadfastSecret ? "Hide" : "Show"}
                                </Button>
                              }
                            />
                          </BlockStack>
                          <Divider />
                          <InlineStack align="end">
                            <Button
                              variant="primary"
                              loading={isSubmittingSteadfast}
                              onClick={handleSaveSteadfast}
                            >
                              Save Settings
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      )}

                      {/* Tab 2: Webhook */}
                      {activeSetupTab === "webhook" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingMd" fontWeight="bold">Real-Time Webhook (Two-Way Status Sync)</Text>
                              <Badge tone="info">Live Webhook</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Paste in Steadfast Merchant Portal &rarr; API &rarr; Webhook to receive instant parcel tracking callbacks.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="Callback URL"
                              value={steadfastWebhookUrl}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(steadfastWebhookUrl, "steadfast_url")}>
                                  {copiedKey === "steadfast_url" ? "Copied!" : "Copy URL"}
                                </Button>
                              }
                            />
                            <TextField
                              label="Webhook Secret"
                              value={webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(webhookSecret, "steadfast_secret")}>
                                  {copiedKey === "steadfast_secret" ? "Copied!" : "Copy Secret"}
                                </Button>
                              }
                              helpText="Paste in Steadfast Webhook Secret field."
                            />
                            <InlineStack align="end">
                              <Button
                                size="micro"
                                variant="plain"
                                tone="critical"
                                onClick={handleRegenerateWebhookSecret}
                                loading={isRegeneratingWebhookSecret}
                              >
                                Rotate / Regenerate Webhook Token
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </BlockStack>
                      )}

                      {/* Tab 3: Default Settings */}
                      {activeSetupTab === "settings" && (
                        <Card padding="500">
                          <BlockStack gap="400">
                            <BlockStack gap="100">
                              <Text as="h3" variant="headingMd" fontWeight="bold">Default Delivery &amp; COD Settings</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Configure default parcel preferences and delivery dispatch rules for Steadfast Courier.
                              </Text>
                            </BlockStack>
                            <Divider />
                            <BlockStack gap="400">
                              <Checkbox
                                label="Set Steadfast as default courier"
                                checked={defaultCourier === "steadfast"}
                                onChange={(newChecked) => {
                                  setDefaultCourier(newChecked ? "steadfast" : "pathao");
                                }}
                              />
                              <BlockStack gap="150">
                                <Text as="p" variant="bodyMd" fontWeight="medium">
                                  Default Delivery Type
                                </Text>
                                <InlineStack gap="400">
                                  <RadioButton
                                    label="Home Delivery"
                                    checked={steadfastDeliveryType === "home"}
                                    id="steadfast_delivery_home"
                                    name="steadfastDeliveryType"
                                    onChange={() => setSteadfastDeliveryType("home")}
                                  />
                                  <RadioButton
                                    label="Hub Delivery"
                                    checked={steadfastDeliveryType === "hub"}
                                    id="steadfast_delivery_hub"
                                    name="steadfastDeliveryType"
                                    onChange={() => setSteadfastDeliveryType("hub")}
                                  />
                                </InlineStack>
                              </BlockStack>
                              <TextField
                                label="Default Parcel Note"
                                value={steadfastParcelNote}
                                onChange={(val) => setSteadfastParcelNote(val)}
                                placeholder="e.g. Please call customer before delivery"
                                multiline={3}
                                autoComplete="off"
                                helpText="Don't use any special characters or emoji characters."
                              />
                            </BlockStack>
                            <Divider />
                            <InlineStack align="end" gap="300">
                              <Button variant="secondary" onClick={handleResetSteadfast}>
                                Reset
                              </Button>
                              <Button
                                variant="primary"
                                loading={isSubmittingSteadfast}
                                onClick={handleSaveSteadfast}
                              >
                                Save Settings
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Card>
                      )}
                    </>
                  )}

                  {/* ==================== 3. REDX SUB-VIEW ==================== */}
                  {activeCourierId === "redx" && (
                    <>
                      {/* Tab 1: API Configuration */}
                      {activeSetupTab === "api" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd" fontWeight="bold">REDX API Credentials</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Enter your REDX OpenAPI credentials for automated delivery booking.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="API Access Token"
                              type={showRedxToken ? "text" : "password"}
                              value={redxAccessToken}
                              onChange={(val) => setRedxAccessToken(val)}
                              placeholder="••••••••••••••••"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowRedxToken((prev) => !prev)}
                                >
                                  {showRedxToken ? "Hide" : "Show"}
                                </Button>
                              }
                              helpText="REDX OpenAPI Bearer token. Stored encrypted with AES-256-GCM."
                            />
                            <InlineStack gap="300" blockAlign="center">
                              <Button
                                size="medium"
                                loading={isFetchingRedxStores}
                                onClick={handleFetchRedxStores}
                              >
                                Verify Credentials & Fetch Pickup Stores
                              </Button>
                              <Text as="p" variant="bodyXs" tone="subdued">
                                Retrieve your active pickup stores directly from REDX API.
                              </Text>
                            </InlineStack>
                            {redxStores.length > 0 ? (
                              <Select
                                label="Select Pickup Store"
                                options={[
                                  { label: "-- Select REDX Pickup Store --", value: "" },
                                  ...redxStores.map((st) => ({
                                    label: `${st.name} (ID: ${st.id})`,
                                    value: String(st.id),
                                  })),
                                ]}
                                value={redxPickupStoreId}
                                onChange={(val) => {
                                  setRedxPickupStoreId(val);
                                  const found = redxStores.find((s) => String(s.id) === String(val));
                                  if (found) {
                                    setRedxPickupStoreName(found.name);
                                    setRedxLocationId(String(val));
                                    setRedxProfileId(found.name || String(val));
                                  }
                                }}
                                helpText="Selected warehouse is used as origin for REDX pickup dispatches."
                              />
                            ) : (
                              <TextField
                                label="Pickup Store ID / Location ID"
                                value={redxPickupStoreId}
                                onChange={(val) => {
                                  setRedxPickupStoreId(val);
                                  setRedxLocationId(val);
                                }}
                                placeholder="e.g. 101"
                                autoComplete="off"
                                helpText="Your numeric REDX pickup store ID. Click 'Verify Credentials & Fetch Pickup Stores' above to auto-load."
                              />
                            )}
                            <TextField
                              label="Pickup Store Name / Label"
                              value={redxPickupStoreName}
                              onChange={(val) => {
                                setRedxPickupStoreName(val);
                                if (!redxProfileId) setRedxProfileId(val);
                              }}
                              placeholder="e.g. Dhanmondi Warehouse"
                              autoComplete="off"
                            />
                            <TextField
                              label="Profile ID"
                              value={redxProfileId}
                              onChange={(val) => setRedxProfileId(val)}
                              placeholder="e.g. MyStore_Profile"
                              autoComplete="off"
                              helpText="Merchant Profile identifier used for REDX order tracking."
                            />
                          </BlockStack>
                          <Divider />
                          <InlineStack align="end">
                            <Button
                              variant="primary"
                              loading={isSubmittingRedx}
                              onClick={handleSaveRedX}
                            >
                              Save Settings
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      )}

                      {/* Tab 2: Webhook */}
                      {activeSetupTab === "webhook" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingMd" fontWeight="bold">Real-Time Webhook (Two-Way Status Sync)</Text>
                              <Badge tone="info">Live Webhook</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Paste in REDX Developer Portal &rarr; Webhook Setup to receive real-time parcel delivery status webhooks.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="Callback URL"
                              value={redxWebhookUrl}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(redxWebhookUrl, "redx_url")}>
                                  {copiedKey === "redx_url" ? "Copied!" : "Copy URL"}
                                </Button>
                              }
                            />
                            <TextField
                              label="Your Secret Key"
                              value={webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(webhookSecret, "redx_secret")}>
                                  {copiedKey === "redx_secret" ? "Copied!" : "Copy Key"}
                                </Button>
                              }
                              helpText="Paste in REDX Webhook Secret field."
                            />
                            <InlineStack align="end">
                              <Button
                                size="micro"
                                variant="plain"
                                tone="critical"
                                onClick={handleRegenerateWebhookSecret}
                                loading={isRegeneratingWebhookSecret}
                              >
                                Rotate / Regenerate Webhook Token
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </BlockStack>
                      )}

                      {/* Tab 3: Default Settings */}
                      {activeSetupTab === "settings" && (
                        <Card padding="500">
                          <BlockStack gap="400">
                            <BlockStack gap="100">
                              <Text as="h3" variant="headingMd" fontWeight="bold">REDX Fulfillment Defaults</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Configure default parcel preferences and automated dispatch parameters for REDX Delivery.
                              </Text>
                            </BlockStack>
                            <Divider />
                            <BlockStack gap="400">
                              <Checkbox
                                label="Set Redx as default courier"
                                checked={defaultCourier === "redx"}
                                onChange={(newChecked) => {
                                  setDefaultCourier(newChecked ? "redx" : "pathao");
                                }}
                              />
                              <TextField
                                label="Default Parcel Weight (kg)"
                                type="number"
                                value={redxDefaultWeight}
                                onChange={(val) => setRedxDefaultWeight(val)}
                                placeholder="0.5"
                                autoComplete="off"
                                min={0.1}
                                step={0.1}
                              />
                              <TextField
                                label="Default Parcel Note"
                                value={redxParcelNote}
                                onChange={(val) => setRedxParcelNote(val)}
                                placeholder="e.g. Handle with care - fragile cosmetics"
                                multiline={3}
                                autoComplete="off"
                                helpText="Don't use any special characters or emoji characters."
                              />
                            </BlockStack>
                            <Divider />
                            <InlineStack align="end" gap="300">
                              <Button variant="secondary" onClick={handleResetRedX}>
                                Reset
                              </Button>
                              <Button
                                variant="primary"
                                loading={isSubmittingRedx}
                                onClick={handleSaveRedX}
                              >
                                Save Settings
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Card>
                      )}
                    </>
                  )}

                  {/* ==================== 4. CARRYBEE SUB-VIEW ==================== */}
                  {activeCourierId === "carrybee" && (
                    <>
                      {/* Tab 1: API Configuration */}
                      {activeSetupTab === "api" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd" fontWeight="bold">CarryBee API Credentials</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Enter your CarryBee Client ID, Secret, and Client Context.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="Client ID"
                              value={carrybeeClientId}
                              onChange={(val) => setCarrybeeClientId(val)}
                              placeholder="Enter your CarryBee Client ID"
                              autoComplete="off"
                            />
                            <TextField
                              label="Client Secret"
                              type={showCarrybeeSecret ? "text" : "password"}
                              value={carrybeeClientSecret}
                              onChange={(val) => setCarrybeeClientSecret(val)}
                              placeholder="Enter your CarryBee Client Secret"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowCarrybeeSecret((prev) => !prev)}
                                >
                                  {showCarrybeeSecret ? "Hide" : "Show"}
                                </Button>
                              }
                            />
                            <TextField
                              label="Client Context"
                              type={showCarrybeeContext ? "text" : "password"}
                              value={carrybeeClientContext}
                              onChange={(val) => setCarrybeeClientContext(val)}
                              placeholder="Enter your unique CarryBee Client Context token"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowCarrybeeContext((prev) => !prev)}
                                >
                                  {showCarrybeeContext ? "Hide" : "Show"}
                                </Button>
                              }
                            />
                            <TextField
                              label="Store ID"
                              value={carrybeeStoreId}
                              onChange={(val) => setCarrybeeStoreId(val)}
                              placeholder="Enter your CarryBee Store ID (e.g. cb_store_101)"
                              autoComplete="off"
                            />
                            <TextField
                              label="Custom Webhook Secret (Optional)"
                              type={showCarrybeeWebhookSecret ? "text" : "password"}
                              value={carrybeeWebhookSecret}
                              onChange={(val) => setCarrybeeWebhookSecret(val)}
                              placeholder="Enter custom signature secret (optional)"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowCarrybeeWebhookSecret((prev) => !prev)}
                                >
                                  {showCarrybeeWebhookSecret ? "Hide" : "Show"}
                                </Button>
                              }
                            />
                            <Checkbox
                              label="Sandbox / Test API Mode"
                              checked={carrybeeSandbox}
                              onChange={(val) => setCarrybeeSandbox(val)}
                              helpText="Enable to run simulated orders in the CarryBee Sandbox environment."
                            />
                          </BlockStack>
                          <Divider />
                          <InlineStack align="end">
                            <Button
                              variant="primary"
                              loading={isSubmittingCarrybee}
                              onClick={handleSaveCarrybee}
                            >
                              Save Settings
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      )}

                      {/* Tab 2: Webhook */}
                      {activeSetupTab === "webhook" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingMd" fontWeight="bold">Real-Time Webhook (Two-Way Status Sync)</Text>
                              <Badge tone="info">Live Webhook</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Configure this Webhook Callback URL in your CarryBee Developer Settings.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="Callback URL"
                              value={carrybeeWebhookUrl}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(carrybeeWebhookUrl, "carrybee_url")}>
                                  {copiedKey === "carrybee_url" ? "Copied!" : "Copy URL"}
                                </Button>
                              }
                            />
                            <TextField
                              label="Your Secret Key"
                              value={carrybeeWebhookSecret || webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(carrybeeWebhookSecret || webhookSecret, "carrybee_secret")}>
                                  {copiedKey === "carrybee_secret" ? "Copied!" : "Copy Key"}
                                </Button>
                              }
                              helpText="Paste in CarryBee Webhook Secret field."
                            />
                            <InlineStack align="end">
                              <Button
                                size="micro"
                                variant="plain"
                                tone="critical"
                                onClick={handleRegenerateWebhookSecret}
                                loading={isRegeneratingWebhookSecret}
                              >
                                Rotate / Regenerate Webhook Token
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </BlockStack>
                      )}

                      {/* Tab 3: Default Settings */}
                      {activeSetupTab === "settings" && (
                        <Card padding="500">
                          <BlockStack gap="400">
                            <BlockStack gap="100">
                              <Text as="h3" variant="headingMd" fontWeight="bold">CarryBee Fulfillment Defaults</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Configure default parcel preferences and automated dispatch parameters for Carry Bee Logistics.
                              </Text>
                            </BlockStack>
                            <Divider />
                            <BlockStack gap="400">
                              <Checkbox
                                label="Set Carry Bee as default courier"
                                checked={defaultCourier === "carrybee"}
                                onChange={(newChecked) => {
                                  setDefaultCourier(newChecked ? "carrybee" : "pathao");
                                }}
                              />
                              <TextField
                                label="Default Parcel Weight (kg)"
                                type="number"
                                value={carrybeeDefaultWeight}
                                onChange={(val) => setCarrybeeDefaultWeight(val)}
                                placeholder="0.5"
                                autoComplete="off"
                                min={0.1}
                                step={0.1}
                              />
                              <TextField
                                label="Default Parcel Note"
                                value={carrybeeParcelNote}
                                onChange={(val) => setCarrybeeParcelNote(val)}
                                placeholder="e.g. Please call before delivery"
                                multiline={3}
                                autoComplete="off"
                                helpText="Don't use any special characters or emoji characters."
                              />
                              <BlockStack gap="150">
                                <Text as="p" variant="bodyMd" fontWeight="medium">
                                  Default Delivery Type
                                </Text>
                                <InlineStack gap="400">
                                  <RadioButton
                                    label="Normal Delivery"
                                    checked={carrybeeDeliveryType === "normal"}
                                    id="carrybee_delivery_normal"
                                    name="carrybeeDeliveryType"
                                    onChange={() => setCarrybeeDeliveryType("normal")}
                                  />
                                  <RadioButton
                                    label="Express Delivery"
                                    checked={carrybeeDeliveryType === "express"}
                                    id="carrybee_delivery_express"
                                    name="carrybeeDeliveryType"
                                    onChange={() => setCarrybeeDeliveryType("express")}
                                  />
                                </InlineStack>
                              </BlockStack>
                              <BlockStack gap="150">
                                <Text as="p" variant="bodyMd" fontWeight="medium">
                                  Default Product Type
                                </Text>
                                <InlineStack gap="400">
                                  <RadioButton
                                    label="Parcel"
                                    checked={carrybeeProductType === "parcel"}
                                    id="carrybee_product_parcel"
                                    name="carrybeeProductType"
                                    onChange={() => setCarrybeeProductType("parcel")}
                                  />
                                  <RadioButton
                                    label="Book"
                                    checked={carrybeeProductType === "book"}
                                    id="carrybee_product_book"
                                    name="carrybeeProductType"
                                    onChange={() => setCarrybeeProductType("book")}
                                  />
                                  <RadioButton
                                    label="Document"
                                    checked={carrybeeProductType === "document"}
                                    id="carrybee_product_document"
                                    name="carrybeeProductType"
                                    onChange={() => setCarrybeeProductType("document")}
                                  />
                                </InlineStack>
                              </BlockStack>
                            </BlockStack>
                            <Divider />
                            <InlineStack align="end" gap="300">
                              <Button variant="secondary" onClick={handleResetCarrybee}>
                                Reset
                              </Button>
                              <Button
                                variant="primary"
                                loading={isSubmittingCarrybee}
                                onClick={handleSaveCarrybee}
                              >
                                Save Settings
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Card>
                      )}
                    </>
                  )}

                  {/* ==================== 5. BAHOK SUB-VIEW ==================== */}
                  {activeCourierId === "bahok" && (
                    <>
                      {/* Tab 1: API Configuration */}
                      {activeSetupTab === "api" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd" fontWeight="bold">Bahok API Credentials</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Enter your Bahok Merchant ID, API Key, and Token for automated dispatch.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="Merchant ID"
                              value={bahokMerchantId}
                              onChange={(val) => setBahokMerchantId(val)}
                              placeholder="Enter your Bahok Merchant ID (e.g. BHK-12345)"
                              autoComplete="off"
                            />
                            <TextField
                              label="API Key"
                              value={bahokApiKey}
                              onChange={(val) => setBahokApiKey(val)}
                              placeholder="Enter your Bahok API Key"
                              autoComplete="off"
                            />
                            <TextField
                              label="API Secret / Token"
                              type={showBahokToken ? "text" : "password"}
                              value={bahokApiToken}
                              onChange={(val) => setBahokApiToken(val)}
                              placeholder="Enter your Bahok Authorization Token"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowBahokToken((prev) => !prev)}
                                >
                                  {showBahokToken ? "Hide" : "Show"}
                                </Button>
                              }
                            />
                            <TextField
                              label="Custom Webhook Secret (Optional)"
                              type={showBahokWebhookSecret ? "text" : "password"}
                              value={bahokWebhookSecret}
                              onChange={(val) => setBahokWebhookSecret(val)}
                              placeholder="Enter custom webhook secret (optional)"
                              autoComplete="off"
                              connectedRight={
                                <Button
                                  variant="plain"
                                  onClick={() => setShowBahokWebhookSecret((prev) => !prev)}
                                >
                                  {showBahokWebhookSecret ? "Hide" : "Show"}
                                </Button>
                              }
                            />
                          </BlockStack>
                          <Divider />
                          <InlineStack align="end">
                            <Button
                              variant="primary"
                              loading={isSubmittingBahok}
                              onClick={handleSaveBahok}
                            >
                              Save Settings
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      )}

                      {/* Tab 2: Webhook */}
                      {activeSetupTab === "webhook" && (
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingMd" fontWeight="bold">Real-Time Webhook (Two-Way Status Sync)</Text>
                              <Badge tone="info">Live Webhook</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Enter this URL in Bahok Merchant Portal &rarr; Settings &rarr; Webhook to receive parcel tracking updates.
                            </Text>
                          </BlockStack>
                          <Divider />
                          <BlockStack gap="300">
                            <TextField
                              label="Callback URL"
                              value={bahokWebhookUrl}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(bahokWebhookUrl, "bahok_url")}>
                                  {copiedKey === "bahok_url" ? "Copied!" : "Copy URL"}
                                </Button>
                              }
                            />
                            <TextField
                              label="Webhook Auth Token"
                              value={bahokWebhookSecret || webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(bahokWebhookSecret || webhookSecret, "bahok_secret")}>
                                  {copiedKey === "bahok_secret" ? "Copied!" : "Copy Token"}
                                </Button>
                              }
                              helpText="Bearer token for Bahok webhook authorization."
                            />
                            <InlineStack align="end">
                              <Button
                                size="micro"
                                variant="plain"
                                tone="critical"
                                onClick={handleRegenerateWebhookSecret}
                                loading={isRegeneratingWebhookSecret}
                              >
                                Rotate / Regenerate Webhook Token
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </BlockStack>
                      )}

                      {/* Tab 3: Default Settings */}
                      {activeSetupTab === "settings" && (
                        <Card padding="500">
                          <BlockStack gap="400">
                            <BlockStack gap="100">
                              <Text as="h3" variant="headingMd" fontWeight="bold">Bahok Fulfillment Defaults</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Configure default parcel preferences and automated dispatch parameters for Bahok Courier.
                              </Text>
                            </BlockStack>
                            <Divider />
                            <BlockStack gap="400">
                              <Checkbox
                                label="Set Bahok as default courier"
                                checked={defaultCourier === "bahok"}
                                onChange={(newChecked) => {
                                  setDefaultCourier(newChecked ? "bahok" : "pathao");
                                }}
                              />
                              <TextField
                                label="Default Parcel Note"
                                value={bahokParcelNote}
                                onChange={(val) => setBahokParcelNote(val)}
                                placeholder="e.g. Please call customer before delivery"
                                multiline={3}
                                autoComplete="off"
                                helpText="Don't use any special characters or emoji characters."
                              />
                            </BlockStack>
                            <Divider />
                            <InlineStack align="end" gap="300">
                              <Button variant="secondary" onClick={handleResetBahok}>
                                Reset
                              </Button>
                              <Button
                                variant="primary"
                                loading={isSubmittingBahok}
                                onClick={handleSaveBahok}
                              >
                                Save Settings
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Card>
                      )}
                    </>
                  )}
                </Card>
              </div>
            </div>
          </BlockStack>
        ) : (
          /* ================================================================ */
          /* MAIN 3-COLUMN DASHBOARD GRID VIEW                                */
          /* ================================================================ */
          <BlockStack gap="600">
            <BlockStack gap="200">
              <Text as="h1" variant="headingXl" fontWeight="bold">
                Courier Gateways
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Manage your credentials for Bangladesh&apos;s leading logistics partners to enable one-click booking and automated dispatch.
              </Text>
            </BlockStack>

            <div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
                gap: "24px",
                alignItems: "stretch",
              }}
            >
              {/* Card 1: Pathao Settings */}
              <div
                className="w-full bg-white rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "none",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "290px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "12px", minHeight: "56px" }}>
                    <CourierLogo courier="pathao" size={52} />
                  </div>
                  <div style={{ marginBottom: "6px" }}>
                    <Text as="h3" variant="headingMd" fontWeight="bold">
                      Pathao Courier
                    </Text>
                  </div>
                  <div style={{ marginBottom: "12px", display: "flex", justifyContent: "center" }}>
                    <Badge tone={isPathaoConnected ? "success" : undefined}>
                      {isPathaoConnected ? "● Active" : "Not Configured"}
                    </Badge>
                  </div>
                  <div style={{ color: "#64748B", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
                    Express parcel delivery and real-time consignment tracking via Pathao Merchant API.
                  </div>
                </div>
                <div style={{ marginTop: "auto", paddingTop: "20px", display: "flex", justifyContent: "flex-start", width: "100%" }}>
                  <Button
                    variant={isPathaoConnected ? "secondary" : "primary"}
                    onClick={() => {
                      setActiveCourierId("pathao");
                      setActiveSetupTab("api");
                    }}
                  >
                    Configure
                  </Button>
                </div>
              </div>

              {/* Card 2: Steadfast Settings */}
              <div
                className="w-full bg-white rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "none",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "290px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "12px", minHeight: "56px" }}>
                    <CourierLogo courier="steadfast" size={52} />
                  </div>
                  <div style={{ marginBottom: "6px" }}>
                    <Text as="h3" variant="headingMd" fontWeight="bold">
                      Steadfast Courier
                    </Text>
                  </div>
                  <div style={{ marginBottom: "12px", display: "flex", justifyContent: "center" }}>
                    <Badge tone={isSteadfastConnected ? "success" : undefined}>
                      {isSteadfastConnected ? "● Active" : "Not Configured"}
                    </Badge>
                  </div>
                  <div style={{ color: "#64748B", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
                    Nationwide door-to-door cash on delivery coverage with automated next-day merchant payouts.
                  </div>
                </div>
                <div style={{ marginTop: "auto", paddingTop: "20px", display: "flex", justifyContent: "flex-start", width: "100%" }}>
                  <Button
                    variant={isSteadfastConnected ? "secondary" : "primary"}
                    onClick={() => {
                      setActiveCourierId("steadfast");
                      setActiveSetupTab("api");
                    }}
                  >
                    Configure
                  </Button>
                </div>
              </div>

              {/* Card 3: REDX Settings */}
              <div
                className="w-full bg-white rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "none",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "290px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "12px", minHeight: "56px" }}>
                    <CourierLogo courier="redx" size={52} />
                  </div>
                  <div style={{ marginBottom: "6px" }}>
                    <Text as="h3" variant="headingMd" fontWeight="bold">
                      REDX Delivery
                    </Text>
                  </div>
                  <div style={{ marginBottom: "12px", display: "flex", justifyContent: "center" }}>
                    <Badge tone={isRedxConnected ? "success" : undefined}>
                      {isRedxConnected ? "● Active" : "Not Configured"}
                    </Badge>
                  </div>
                  <div style={{ color: "#64748B", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
                    Enterprise-grade logistics with extensive coverage across Dhaka and 64 districts with automated tracking.
                  </div>
                </div>
                <div style={{ marginTop: "auto", paddingTop: "20px", display: "flex", justifyContent: "flex-start", width: "100%" }}>
                  <Button
                    variant={isRedxConnected ? "secondary" : "primary"}
                    onClick={() => {
                      setActiveCourierId("redx");
                      setActiveSetupTab("api");
                    }}
                  >
                    Configure
                  </Button>
                </div>
              </div>

              {/* Card 4: CarryBee Settings */}
              <div
                className="w-full bg-white rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "none",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "290px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "12px", minHeight: "56px" }}>
                    <CourierLogo courier="carrybee" size={52} />
                  </div>
                  <div style={{ marginBottom: "6px" }}>
                    <Text as="h3" variant="headingMd" fontWeight="bold">
                      CarryBee Logistics
                    </Text>
                  </div>
                  <div style={{ marginBottom: "12px", display: "flex", justifyContent: "center" }}>
                    <Badge tone={isCarrybeeConnected ? "success" : undefined}>
                      {isCarrybeeConnected ? "● Active" : "Not Configured"}
                    </Badge>
                  </div>
                  <div style={{ color: "#64748B", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
                    Modern eCommerce logistics network with fast dispatch, real-time tracking, and automated COD payouts.
                  </div>
                </div>
                <div style={{ marginTop: "auto", paddingTop: "20px", display: "flex", justifyContent: "flex-start", width: "100%" }}>
                  <Button
                    variant={isCarrybeeConnected ? "secondary" : "primary"}
                    onClick={() => {
                      setActiveCourierId("carrybee");
                      setActiveSetupTab("api");
                    }}
                  >
                    Configure
                  </Button>
                </div>
              </div>

              {/* Card 5: Bahok Courier Settings */}
              <div
                className="w-full bg-white rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "none",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "290px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "12px", minHeight: "56px" }}>
                    <CourierLogo courier="bahok" size={52} />
                  </div>
                  <div style={{ marginBottom: "6px" }}>
                    <Text as="h3" variant="headingMd" fontWeight="bold">
                      Bahok Courier
                    </Text>
                  </div>
                  <div style={{ marginBottom: "12px", display: "flex", justifyContent: "center" }}>
                    <Badge tone={isBahokConnected ? "success" : undefined}>
                      {isBahokConnected ? "● Active" : "Not Configured"}
                    </Badge>
                  </div>
                  <div style={{ color: "#64748B", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
                    Reliable nationwide courier service with automated booking, SMS alerts, and fast COD reconciliation.
                  </div>
                </div>
                <div style={{ marginTop: "auto", paddingTop: "20px", display: "flex", justifyContent: "flex-start", width: "100%" }}>
                  <Button
                    variant={isBahokConnected ? "secondary" : "primary"}
                    onClick={() => {
                      setActiveCourierId("bahok");
                      setActiveSetupTab("api");
                    }}
                  >
                    Configure
                  </Button>
                </div>
              </div>
            </div>

            {/* SECTION 2: AUTOMATION RULES & AI WRAPPER (rendered on main dashboard) */}
            {/* ==================================================================== */}
            {/* SECTION 2: AUTOMATION RULES & AI WRAPPER                             */}
            {/* ==================================================================== */}
            <BlockStack gap="400">
              
          <BlockStack gap="050">
            <Text as="h2" variant="headingLg">
              স্মার্ট AI অ্যাড্রেস কারেকশন ও অটো-কুরিয়ার সিলেকশন
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              কাস্টমারের ভুল বা অসম্পূর্ণ ঠিকানা স্বয়ংক্রিয়ভাবে ঠিক করুন, ভুল জোনে পার্সেল যাওয়া বন্ধ করুন এবং রিটার্ন (RTO) খরচ বাঁচান।
            </Text>
          </BlockStack>

          <Layout>
            {/* Card A: Gemini AI Address Normalizer */}
            <Layout.Section>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <InlineStack gap="200" blockAlign="center">
                      <Box>
                        <Icon source={SparklesIcon} tone="magic" />
                      </Box>
                      <Text as="h3" variant="headingMd">
                        AI অ্যাড্রেস ভেরিফায়ার ও পার্সেল সুরক্ষা
                      </Text>
                      <Badge
                        tone={aiAddressCleaningEnabled ? "success" : "critical"}
                        progress={aiAddressCleaningEnabled ? "complete" : "incomplete"}
                      >
                        {aiAddressCleaningEnabled
                          ? "●Active"
                          : "○ Inactive"}
                      </Badge>
                    </InlineStack>

                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={aiConfig.isGeminiConfigured ? "success" : "attention"}>
                        {aiConfig.isGeminiConfigured
                          ? "Google Gemini AI মোড"
                          : "Local Keyword Mode"}
                      </Badge>
                      <Badge tone="info">
                        {`${aiConfig.addressCacheCount} টি অ্যাড্রেস সেভ করা আছে`}
                      </Badge>
                    </InlineStack>
                  </InlineStack>

                  <Text as="p" variant="bodySm" tone="subdued">
                    কাস্টমাররা বাংলিশ, ভুল বানান বা থানা ছাড়া ঠিকানা লিখলেও AI স্বয়ংক্রিয়ভাবে সঠিক জেলা ও থানা খুঁজে বের করে পাঠাও, রেডএক্স ও স্টিডফাস্টে সঠিক জোনে পার্সেল এন্ট্রি নিশ্চিত করে।
                  </Text>

                  <Box
                    padding="400"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <Checkbox
                        label="কুরিয়ারে অর্ডার পাঠানোর সময় Gemini AI অ্যাড্রেস কারেকশন চালু রাখুন"
                        helpText="“Send to Courier” বাটনে ক্লিক করার সাথে সাথে ঠিকানা স্বয়ংক্রিয়ভাবে ঠিক হবে এবং ভবিষ্যতে দ্রুত পার্সেল পাঠানোর জন্য ডাটাবেজে সেভ থাকবে।"
                        checked={aiAddressCleaningEnabled}
                        onChange={handleToggleAiCleaning}
                        disabled={isSubmittingAi}
                      />
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Card B: Auto-Routing Rules Manager */}
            <Layout.Section>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingMd">
                          Automatic Courier Selection Rules
                        </Text>
                        <Badge tone={isAutoRoutingEnabled ? "success" : "attention"}>
                          {isAutoRoutingEnabled ? "Active" : "Manual Mode"}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        বাংলাদেশের ৮টি বিভাগ এবং ৬৪টি জেলার জন্য আপনার পছন্দের কুরিয়ার সেটআপ করুন।
                      </Text>
                    </BlockStack>

                    <Button
                      variant="primary"
                      loading={isSavingRoutingSettings}
                      onClick={handleSaveRoutingSettings}
                    >
                      Save Courier Selection Rules
                    </Button>
                  </InlineStack>

                  <Divider />

                  {/* Master Automation Switch */}
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <Checkbox
                      label="Enable Automatic Courier Selection & Fraud Protection"
                      helpText="নতুন অর্ডার আসার সাথে সাথে কাস্টমারের ঠিকানার উপর ভিত্তি করে স্বয়ংক্রিয়ভাবে নির্ধারিত কুরিয়ার সিলেক্ট হবে এবং ফ্রড (প্রতারণা) ফিল্টারিং চেক হবে।"
                      checked={isAutoRoutingEnabled}
                      onChange={(newChecked) => setIsAutoRoutingEnabled(newChecked)}
                    />
                  </Box>

                  {/* Dynamic Rule Builder Rows */}
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="h4" variant="headingSm">
                          Custom Division &amp; District Rules ({customRoutes.length})
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          এই নিয়মগুলো উপর থেকে নিচে ক্রমানুসারে কাজ করবে। নির্দিষ্ট কোনো জেলার নিয়ম তার পুরো বিভাগের নিয়মের চেয়ে বেশি অগ্রাধিকার পাবে।
                        </Text>
                      </BlockStack>

                      <Button variant="secondary" onClick={handleAddRuleRow}>
                        + Create New Rule
                      </Button>
                    </InlineStack>

                    {customRoutes.length === 0 ? (
                      <Box
                        padding="400"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Text as="p" variant="bodySm" tone="subdued">
                          No custom district rules configured. All safe orders will route to your Default Courier below.
                        </Text>
                      </Box>
                    ) : (
                      <BlockStack gap="250">
                        {customRoutes.map((rule, index) => (
                          <Box
                            key={`rule-${index}`}
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <Grid>
                              {/* Division Select */}
                              <Grid.Cell
                                columnSpan={{
                                  xs: 6,
                                  sm: 6,
                                  md: 2,
                                  lg: 4,
                                  xl: 4,
                                }}
                              >
                                <Select
                                  label={`Rule #${index + 1}: Division`}
                                  options={divisionSelectOptions}
                                  value={rule.division}
                                  onChange={(val) =>
                                    handleDivisionChange(index, val)
                                  }
                                />
                              </Grid.Cell>

                              {/* District Select */}
                              <Grid.Cell
                                columnSpan={{
                                  xs: 6,
                                  sm: 6,
                                  md: 2,
                                  lg: 4,
                                  xl: 4,
                                }}
                              >
                                <Select
                                  label="District"
                                  options={getDistrictSelectOptions(rule.division)}
                                  value={rule.district}
                                  onChange={(val) =>
                                    handleDistrictChange(index, val)
                                  }
                                />
                              </Grid.Cell>

                              {/* Assigned Courier + Remove */}
                              <Grid.Cell
                                columnSpan={{
                                  xs: 6,
                                  sm: 6,
                                  md: 2,
                                  lg: 4,
                                  xl: 4,
                                }}
                              >
                                <InlineStack
                                  gap="200"
                                  blockAlign="end"
                                  wrap={false}
                                >
                                  <Box width="100%">
                                    <Select
                                      label="Assigned Courier"
                                      options={COURIER_OPTIONS}
                                      value={rule.courier}
                                      onChange={(val) =>
                                        handleCourierChange(index, val)
                                      }
                                    />
                                  </Box>
                                  <Box>
                                    <Button
                                      tone="critical"
                                      variant="secondary"
                                      accessibilityLabel={`Remove rule ${index + 1}`}
                                      icon={<Icon source={TrashRemoveIcon} />}
                                      onClick={() => handleRemoveRuleRow(index)}
                                    />
                                  </Box>
                                </InlineStack>
                              </Grid.Cell>
                            </Grid>
                          </Box>
                        ))}
                      </BlockStack>
                    )}
                  </BlockStack>

                  <Divider />

                  {/* Fallback Couriers & Fraud Risk Safety Net */}
                  <Grid>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                      <Select
                        label="Inside Dhaka Default Courier"
                        options={COURIER_OPTIONS}
                        value={insideDhakaCourier}
                        onChange={(val) => setInsideDhakaCourier(val)}
                        helpText="ঢাকা সিটির ভেতরের সমস্ত অর্ডারের জন্য প্রধান কুরিয়ার।"
                      />
                    </Grid.Cell>

                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                      <Select
                        label="Outside Dhaka Default Courier"
                        options={COURIER_OPTIONS}
                        value={outsideDhakaCourier}
                        onChange={(val) => setOutsideDhakaCourier(val)}
                        helpText="ঢাকা সিটির বাইরের সমস্ত অর্ডারের জন্য প্রধান কুরিয়ার।"
                      />
                    </Grid.Cell>

                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                      <Select
                        label="Catch-All Fallback Courier"
                        options={COURIER_OPTIONS}
                        value={defaultCourier}
                        onChange={(val) => setDefaultCourier(val)}
                        helpText="উপরে কোনো কাস্টম বা আঞ্চলিক নিয়ম ম্যাচ না করলে এই ব্যাকআপ কুরিয়ারটি ব্যবহার করা হবে।"
                      />
                    </Grid.Cell>
                  </Grid>

                  <Grid>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                      <TextField
                        label="Fraud Risk Safety Net: Minimum Delivery Success Rate"
                        type="number"
                        suffix="%"
                        value={minSuccessRate}
                        onChange={(val) => setMinSuccessRate(val)}
                        autoComplete="off"
                        helpText="যেসব কাস্টমারের আগের পার্সেল ডেলিভারির সফলতার হার (Success Rate) এই পার্সেন্টেজের চেয়ে কম, কুরিয়ারে লস এড়াতে তাদের অর্ডারগুলো স্বয়ংক্রিয়ভাবে লক হয়ে যাবে যাতে আপনি ম্যানুয়ালি চেক করতে পারেন।"
                      />
                    </Grid.Cell>
                  </Grid>

                  <Divider />

                  <InlineStack align="end" blockAlign="center">
                    <Button
                      variant="primary"
                      loading={isSavingRoutingSettings}
                      onClick={handleSaveRoutingSettings}
                    >
                      Save Courier Selection Rules
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

            </BlockStack>
          </BlockStack>
        )}
        </div>

        {/* ==================================================================== */}
        {/* SCENARIO B: SHIPPING LABEL & INVOICE PLACEHOLDERS                     */}
        {/* ==================================================================== */}
        {selectedSettingsTab === "shipping_label" && (
          <Card padding="600">
            <BlockStack gap="300" inlineAlign="center">
              <Text as="h2" variant="headingLg" alignment="center">
                Shipping Label Settings
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                Shipping Label Customization Settings Template
              </Text>
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                Configure thermal barcode label dimensions (4x6 / 100x150mm), custom merchant branding, barcode formats, and return policy notes.
              </Text>
            </BlockStack>
          </Card>
        )}

        {selectedSettingsTab === "invoice" && (
          <Card padding="600">
            <BlockStack gap="300" inlineAlign="center">
              <Text as="h2" variant="headingLg" alignment="center">
                Invoice Configuration
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                Invoice Configuration Template Setup
              </Text>
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                Customize A4 packing slips, store logo, branded headers, custom slogans, order breakdown items, and payment instructions.
              </Text>
            </BlockStack>
          </Card>
        )}
      
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
