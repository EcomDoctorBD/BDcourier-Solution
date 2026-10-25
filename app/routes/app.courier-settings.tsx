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
  pathaoUsername: string;
  pathaoPassword: string;
  pathaoStoreId: string;
  pathaoStoreName: string;
  steadfastApiKey: string;
  steadfastSecretKey: string;
  redxEnvironment: string;
  redxAccessToken: string;
  redxPickupStoreId: string;
  redxPickupStoreName: string;
  redxProfileId: string;
  redxLocationId: string;
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

  const courierConfig: CourierCredentials = {
    pathaoEnvironment: storeConfig?.pathaoEnvironment || "production",
    pathaoClientId: storeConfig?.pathaoClientId || "",
    pathaoSecret: storeConfig?.pathaoSecret || "",
    pathaoUsername: storeConfig?.pathaoUsername || "",
    pathaoPassword: storeConfig?.pathaoPassword || "",
    pathaoStoreId: storeConfig?.pathaoStoreId || "",
    pathaoStoreName: storeConfig?.pathaoStoreName || "",
    steadfastApiKey: storeConfig?.steadfastApiKey || "",
    steadfastSecretKey: storeConfig?.steadfastSecretKey || "",
    redxEnvironment: storeConfig?.redxEnvironment || "production",
    redxAccessToken: storeConfig?.redxAccessToken || "",
    redxPickupStoreId: storeConfig?.redxPickupStoreId || storeConfig?.redxLocationId || "",
    redxPickupStoreName: storeConfig?.redxPickupStoreName || "",
    redxProfileId: storeConfig?.redxProfileId || "",
    redxLocationId: storeConfig?.redxLocationId || storeConfig?.redxPickupStoreId || "",
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
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash",
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

  // ==================== 1. SAVE PATHAO CREDENTIALS ====================
  if (actionType === "savePathao") {
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
    if (pathaoSecret) updateSet.pathaoSecret = encryptSecret(pathaoSecret);
    if (pathaoPassword) updateSet.pathaoPassword = encryptSecret(pathaoPassword);

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const isFullyConnected = Boolean(
      pathaoClientId && pathaoSecret && pathaoStoreId
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
    if (pathaoSecret) updateSet.pathaoSecret = encryptSecret(pathaoSecret);
    if (pathaoPassword) updateSet.pathaoPassword = encryptSecret(pathaoPassword);

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
    if (steadfastSecretKey) {
      updateSet.steadfastSecretKey = encryptSecret(steadfastSecretKey);
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const isFullyConnected = Boolean(steadfastApiKey && steadfastSecretKey);

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
    const redxEnvironment = String(formData.get("redxEnvironment") || "production").trim();
    const redxAccessToken = String(formData.get("redxAccessToken") || "").trim();
    const redxPickupStoreId = String(formData.get("redxPickupStoreId") || "").trim();
    const redxPickupStoreName = String(formData.get("redxPickupStoreName") || "").trim();
    const redxProfileId = String(formData.get("redxProfileId") || "").trim();
    const redxLocationId = String(formData.get("redxLocationId") || "").trim();

    const pickupId = redxPickupStoreId || redxLocationId;
    const profileId = redxProfileId || redxPickupStoreName || pickupId;

    const updateSet: Record<string, any> = {
      shopDomain,
      redxEnvironment: redxEnvironment === "sandbox" ? "sandbox" : "production",
      redxPickupStoreId: pickupId,
      redxPickupStoreName,
      redxProfileId: profileId,
      redxLocationId: pickupId,
    };
    if (redxAccessToken) {
      updateSet.redxAccessToken = encryptSecret(redxAccessToken);
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const isFullyConnected = Boolean(
      (redxAccessToken && pickupId) || (redxProfileId && redxLocationId)
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
    const redxEnvironment = String(formData.get("redxEnvironment") || "production").trim();
    const redxAccessToken = String(formData.get("redxAccessToken") || "").trim();

    const updateSet: Record<string, any> = {
      shopDomain,
      redxEnvironment: redxEnvironment === "sandbox" ? "sandbox" : "production",
    };
    if (redxAccessToken) {
      updateSet.redxAccessToken = encryptSecret(redxAccessToken);
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

  // ==================== 4. SAVE ROUTING & FRAUD SAFETY SETTINGS ====================
  if (actionType === "saveRoutingSettings") {
    const isAutoRoutingEnabled =
      String(formData.get("isAutoRoutingEnabled")) === "true" ||
      String(formData.get("autoRoutingEnabled")) === "true";

    const defaultCourierRaw = String(
      formData.get("defaultCourier") || "steadfast"
    ).trim();
    const validCouriers = ["pathao", "steadfast", "redx"];
    const defaultCourier = validCouriers.includes(defaultCourierRaw)
      ? defaultCourierRaw
      : "steadfast";

    const insideDhakaCourier = String(
      formData.get("insideDhakaCourier") || "pathao"
    ).trim();
    const outsideDhakaCourier = String(
      formData.get("outsideDhakaCourier") || "steadfast"
    ).trim();

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

  const pathaoWebhookUrl = `${appUrl}/api/webhooks/pathao?shop=${encodeURIComponent(shopDomain)}`;
  const steadfastWebhookUrl = `${appUrl}/api/webhooks/steadfast?shop=${encodeURIComponent(shopDomain)}`;
  const redxWebhookUrl = `${appUrl}/api/webhooks/redx?shop=${encodeURIComponent(shopDomain)}`;
  const webhookSecret = courierConfig.webhookSecret || "";

  // Collapsible gateway form states (compact summary by default)
  const [showPathaoForm, setShowPathaoForm] = useState(false);
  const [showSteadfastForm, setShowSteadfastForm] = useState(false);
  const [showRedxForm, setShowRedxForm] = useState(false);

  // ==================== 1. PATHAO GATEWAY STATE ====================
  const [pathaoEnvironment, setPathaoEnvironment] = useState(
    courierConfig.pathaoEnvironment || "production"
  );
  const [pathaoClientId, setPathaoClientId] = useState(courierConfig.pathaoClientId);
  const [pathaoSecret, setPathaoSecret] = useState(courierConfig.pathaoSecret);
  const [pathaoUsername, setPathaoUsername] = useState(courierConfig.pathaoUsername || "");
  const [pathaoPassword, setPathaoPassword] = useState(courierConfig.pathaoPassword || "");
  const [pathaoStoreId, setPathaoStoreId] = useState(courierConfig.pathaoStoreId);
  const [pathaoStoreName, setPathaoStoreName] = useState(courierConfig.pathaoStoreName || "");
  const [showPathaoSecret, setShowPathaoSecret] = useState(false);
  const [showPathaoPassword, setShowPathaoPassword] = useState(false);
  const [pathaoStores, setPathaoStores] = useState<PathaoStore[]>([]);

  const isPathaoConnected = Boolean(
    pathaoClientId.trim() && pathaoSecret.trim() && pathaoStoreId.trim()
  );

  const isSubmittingPathao =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "savePathao";

  const isFetchingPathaoStores =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "fetchPathaoStores";

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
    submit(formData, { method: "post" });
  };

  // ==================== 2. STEADFAST GATEWAY STATE ====================
  const [steadfastApiKey, setSteadfastApiKey] = useState(courierConfig.steadfastApiKey);
  const [steadfastSecretKey, setSteadfastSecretKey] = useState(courierConfig.steadfastSecretKey);
  const [showSteadfastSecret, setShowSteadfastSecret] = useState(false);

  const isSteadfastConnected = Boolean(
    steadfastApiKey.trim() && steadfastSecretKey.trim()
  );

  const isSubmittingSteadfast =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveSteadfast";

  const handleSaveSteadfast = () => {
    const formData = new FormData();
    formData.append("actionType", "saveSteadfast");
    formData.append("steadfastApiKey", steadfastApiKey);
    formData.append("steadfastSecretKey", steadfastSecretKey);
    submit(formData, { method: "post" });
  };

  // ==================== 3. REDX GATEWAY STATE ====================
  const [redxEnvironment, setRedxEnvironment] = useState(
    courierConfig.redxEnvironment || "production"
  );
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

  const isRedxConnected = Boolean(
    (redxAccessToken.trim() && redxPickupStoreId.trim()) ||
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
    formData.append("redxEnvironment", redxEnvironment);
    formData.append("redxAccessToken", redxAccessToken);
    submit(formData, { method: "post" });
  };

  const handleSaveRedX = () => {
    const formData = new FormData();
    formData.append("actionType", "saveRedX");
    formData.append("redxEnvironment", redxEnvironment);
    formData.append("redxAccessToken", redxAccessToken);
    formData.append("redxPickupStoreId", redxPickupStoreId);
    formData.append("redxPickupStoreName", redxPickupStoreName);
    formData.append("redxProfileId", redxProfileId || redxPickupStoreName || redxPickupStoreId);
    formData.append("redxLocationId", redxLocationId || redxPickupStoreId);
    submit(formData, { method: "post" });
  };

  useEffect(() => {
    if (actionData) {
      setShowBanner(true);
      if (actionData.actionType === "fetchPathaoStores" || actionData.actionType === "savePathao") {
        setShowPathaoForm(true);
      }
      if (actionData.actionType === "saveSteadfast") {
        setShowSteadfastForm(true);
      }
      if (actionData.actionType === "fetchRedxStores" || actionData.actionType === "saveRedX") {
        setShowRedxForm(true);
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
    <Page
      title="Courier Settings"
      subtitle={`Store: ${shopDomain} • Plan: ${currentPlan}`}
      backAction={{ content: "Dashboard", url: `/app${searchStr}` }}
    >
      <TitleBar title="Courier Settings" />

      <BlockStack gap="600">
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
        {/* SECTION 1: THE THREE COURIER GATEWAYS LAYOUT                         */}
        {/* ==================================================================== */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <BlockStack gap="050">
              <Text as="h2" variant="headingLg">
                Courier Gateways
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Manage your credentials for Bangladesh&apos;s leading logistics partners to enable one-click booking and automated dispatch.
              </Text>
            </BlockStack>
          </InlineStack>

          <Grid>
            {/* Card 1: Pathao Settings */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <CourierLogo courier="pathao" size={44} />
                      <Text as="h3" variant="headingMd">
                        Pathao Courier
                      </Text>
                    </InlineStack>

                    <Badge
                      tone={isPathaoConnected ? "success" : "attention"}
                      progress={isPathaoConnected ? "complete" : "incomplete"}
                    >
                      {isPathaoConnected ? "Connected" : "Not Configured"}
                    </Badge>
                  </InlineStack>

                  <Text as="p" variant="bodySm" tone="subdued">
                    Express parcel delivery and real-time consignment tracking via Pathao Merchant API.
                  </Text>

                  <Text as="p" variant="bodyXs" tone="subdued">
                    Required: Client ID, Client Secret, Username, Password, Store ID
                  </Text>

                  <InlineStack align="start">
                    <Button
                      onClick={() => setShowPathaoForm((prev) => !prev)}
                    >
                      {showPathaoForm
                        ? "Hide Configuration"
                        : isPathaoConnected
                        ? "Update Pathao"
                        : "Configure Pathao"}
                    </Button>
                  </InlineStack>

                  {showPathaoForm && (
                    <BlockStack gap="400">
                      <Divider />

                      <BlockStack gap="300">
                        <Select
                          label="API Environment"
                          options={[
                            { label: "Production (Hermes Live)", value: "production" },
                            { label: "Sandbox / Test API", value: "sandbox" },
                          ]}
                          value={pathaoEnvironment}
                          onChange={(val) => setPathaoEnvironment(val)}
                        />

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
                          helpText="Stored encrypted with AES-256-GCM. Used to renew OAuth tokens."
                        />

                        <InlineStack align="start">
                          <Button
                            size="medium"
                            loading={isFetchingPathaoStores}
                            onClick={handleFetchPathaoStores}
                            disabled={!pathaoClientId || !pathaoSecret || !pathaoUsername || !pathaoPassword}
                          >
                            Verify &amp; Fetch Stores
                          </Button>
                        </InlineStack>

                        {pathaoStores.length > 0 && (
                          <Select
                            label="Pickup Store"
                            options={[
                              { label: "-- Select a Pickup Store --", value: "" },
                              ...pathaoStores.map((s) => ({
                                label: `${s.store_name} (${s.store_address || "ID: " + s.store_id})`,
                                value: s.store_id,
                              })),
                            ]}
                            value={pathaoStoreId}
                            onChange={(val) => {
                              setPathaoStoreId(val);
                              const matched = pathaoStores.find((s) => s.store_id === val);
                              if (matched) setPathaoStoreName(matched.store_name);
                            }}
                            helpText={
                              pathaoStoreName
                                ? `Selected: ${pathaoStoreName} (ID: ${pathaoStoreId})`
                                : "Choose from verified stores"
                            }
                          />
                        )}

                        <TextField
                          label="Store ID"
                          value={pathaoStoreId}
                          onChange={(val) => setPathaoStoreId(val)}
                          placeholder="e.g. 10248"
                          autoComplete="off"
                          helpText={
                            pathaoStoreName
                              ? `Connected store: ${pathaoStoreName}`
                              : "Manual fallback or click 'Verify & Fetch Stores' above."
                          }
                        />

                        <Divider />

                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h4" variant="headingSm">
                              Real-Time Webhook (Two-Way Status Sync)
                            </Text>
                            <Badge tone="info">Live Webhook</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodyXs" tone="subdued">
                            Paste in Pathao Developer API &rarr; Webhook Integration:
                          </Text>
                          <TextField
                            label="Callback URL"
                            value={pathaoWebhookUrl}
                            readOnly
                            autoComplete="off"
                            connectedRight={
                              <Button
                                onClick={() =>
                                  copyToClipboard(pathaoWebhookUrl, "pathao_url")
                                }
                              >
                                {copiedKey === "pathao_url" ? "Copied!" : "Copy URL"}
                              </Button>
                            }
                          />
                          <TextField
                            label="Webhook Secret"
                            value={webhookSecret}
                            readOnly
                            autoComplete="off"
                            connectedRight={
                              <Button
                                onClick={() =>
                                  copyToClipboard(webhookSecret, "pathao_secret")
                                }
                              >
                                {copiedKey === "pathao_secret" ? "Copied!" : "Copy Secret"}
                              </Button>
                            }
                            helpText="Required for automated verification handshake in Pathao developer portal."
                          />
                        </BlockStack>
                      </BlockStack>

                      <InlineStack align="space-between" blockAlign="center">
                        <Button onClick={() => setShowPathaoForm(false)}>
                          Collapse
                        </Button>
                        <Button
                          variant="primary"
                          loading={isSubmittingPathao}
                          onClick={handleSavePathao}
                        >
                          Save Pathao Settings
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Grid.Cell>

            {/* Card 2: Steadfast Settings */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <CourierLogo courier="steadfast" size={44} />
                      <Text as="h3" variant="headingMd">
                        Steadfast Courier
                      </Text>
                    </InlineStack>

                    <Badge
                      tone={isSteadfastConnected ? "success" : "attention"}
                      progress={isSteadfastConnected ? "complete" : "incomplete"}
                    >
                      {isSteadfastConnected ? "Connected" : "Not Configured"}
                    </Badge>
                  </InlineStack>

                  <Text as="p" variant="bodySm" tone="subdued">
                    Fast Cash-on-Delivery (COD) fulfillment across all 64 Bangladeshi districts.
                  </Text>

                  <Text as="p" variant="bodyXs" tone="subdued">
                    Required: API Key, Secret Key
                  </Text>

                  <InlineStack align="start">
                    <Button
                      onClick={() => setShowSteadfastForm((prev) => !prev)}
                    >
                      {showSteadfastForm
                        ? "Hide Configuration"
                        : isSteadfastConnected
                        ? "Update Steadfast"
                        : "Configure Steadfast"}
                    </Button>
                  </InlineStack>

                  {showSteadfastForm && (
                    <BlockStack gap="400">
                      <Divider />

                      <BlockStack gap="300">
                        <TextField
                          label="API Key"
                          value={steadfastApiKey}
                          onChange={(val) => setSteadfastApiKey(val)}
                          placeholder="e.g. stf_live_api_key_..."
                          autoComplete="off"
                        />

                        <TextField
                          label="Secret Key"
                          type={showSteadfastSecret ? "text" : "password"}
                          value={steadfastSecretKey}
                          onChange={(val) => setSteadfastSecretKey(val)}
                          placeholder="••••••••••••••••"
                          autoComplete="off"
                          connectedRight={
                            <Button
                              variant="plain"
                              onClick={() => setShowSteadfastSecret((prev) => !prev)}
                            >
                              {showSteadfastSecret ? "Hide" : "Show"}
                            </Button>
                          }
                          helpText="Found under Steadfast Merchant Dashboard -> API Integration. Stored encrypted."
                        />
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h4" variant="headingSm">
                            Real-Time Webhook (Two-Way Status Sync)
                          </Text>
                          <Badge tone="info">Live Webhook</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodyXs" tone="subdued">
                          Paste in Steadfast Merchant Portal &rarr; API &rarr; Webhook:
                        </Text>
                        <TextField
                          label="Callback URL"
                          value={steadfastWebhookUrl}
                          readOnly
                          autoComplete="off"
                          connectedRight={
                            <Button
                              onClick={() =>
                                copyToClipboard(steadfastWebhookUrl, "steadfast_url")
                              }
                            >
                              {copiedKey === "steadfast_url" ? "Copied!" : "Copy URL"}
                            </Button>
                          }
                        />
                        <TextField
                          label="Bearer Token / Secret"
                          value={webhookSecret}
                          readOnly
                          autoComplete="off"
                          connectedRight={
                            <Button
                              onClick={() =>
                                copyToClipboard(webhookSecret, "steadfast_secret")
                              }
                            >
                              {copiedKey === "steadfast_secret" ? "Copied!" : "Copy Token"}
                            </Button>
                          }
                          helpText="Paste in Steadfast Webhook Bearer Token / Secret field."
                        />
                      </BlockStack>

                      <InlineStack align="space-between" blockAlign="center">
                        <Button onClick={() => setShowSteadfastForm(false)}>
                          Collapse
                        </Button>
                        <Button
                          variant="primary"
                          loading={isSubmittingSteadfast}
                          onClick={handleSaveSteadfast}
                        >
                          Save Steadfast Settings
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Grid.Cell>

            {/* Card 3: REDX Settings */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <CourierLogo courier="redx" size={44} />
                      <Text as="h3" variant="headingMd">
                        REDX Delivery
                      </Text>
                    </InlineStack>

                    <Badge
                      tone={isRedxConnected ? "success" : "attention"}
                      progress={isRedxConnected ? "complete" : "incomplete"}
                    >
                      {isRedxConnected ? "Connected" : "Not Configured"}
                    </Badge>
                  </InlineStack>

                  <Text as="p" variant="bodySm" tone="subdued">
                    64-district doorstep delivery network with automated pickup scheduling.
                  </Text>

                  <Text as="p" variant="bodyXs" tone="subdued">
                    Required: API Access Token, Pickup Store ID
                  </Text>

                  <InlineStack align="start">
                    <Button
                      onClick={() => setShowRedxForm((prev) => !prev)}
                    >
                      {showRedxForm
                        ? "Hide Configuration"
                        : isRedxConnected
                        ? "Update REDX"
                        : "Configure REDX"}
                    </Button>
                  </InlineStack>

                  {showRedxForm && (
                    <BlockStack gap="400">
                      <Divider />

                      <BlockStack gap="300">
                        <Select
                          label="API Environment"
                          options={[
                            { label: "Production (OpenAPI Live)", value: "production" },
                            { label: "Sandbox / Test API", value: "sandbox" },
                          ]}
                          value={redxEnvironment}
                          onChange={(val) => setRedxEnvironment(val)}
                        />

                        <TextField
                          label="API Access Token (JWT)"
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
                          helpText="Your REDX Open API token (stored encrypted with AES-256-GCM)."
                        />

                        <InlineStack align="start">
                          <Button
                            size="medium"
                            loading={isFetchingRedxStores}
                            onClick={handleFetchRedxStores}
                            disabled={!redxAccessToken}
                          >
                            Verify &amp; Fetch Stores
                          </Button>
                        </InlineStack>

                        {redxStores.length > 0 && (
                          <Select
                            label="Pickup Store"
                            options={[
                              { label: "-- Select a Pickup Store --", value: "" },
                              ...redxStores.map((s) => ({
                                label: `${s.name} (${s.address || "ID: " + s.id})`,
                                value: s.id,
                              })),
                            ]}
                            value={redxPickupStoreId}
                            onChange={(val) => {
                              setRedxPickupStoreId(val);
                              setRedxLocationId(val);
                              const matched = redxStores.find((s) => s.id === val);
                              if (matched) {
                                setRedxPickupStoreName(matched.name);
                                setRedxProfileId(matched.name);
                              }
                            }}
                            helpText={
                              redxPickupStoreName
                                ? `Selected: ${redxPickupStoreName} (ID: ${redxPickupStoreId})`
                                : "Choose from registered RedX stores"
                            }
                          />
                        )}

                        <TextField
                          label="Pickup Store ID"
                          value={redxPickupStoreId}
                          onChange={(val) => {
                            setRedxPickupStoreId(val);
                            setRedxLocationId(val);
                          }}
                          placeholder="e.g. 12948"
                          autoComplete="off"
                          helpText={
                            redxPickupStoreName
                              ? `Connected store: ${redxPickupStoreName}`
                              : "Manual ID fallback or click 'Verify & Fetch Stores' above."
                          }
                        />

                        <Divider />

                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h4" variant="headingSm">
                              Real-Time Webhook (Two-Way Status Sync)
                            </Text>
                            <Badge tone="info">Live Webhook</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodyXs" tone="subdued">
                            Paste in RedX Partner Portal &rarr; Settings &rarr; Webhook:
                          </Text>
                          <TextField
                            label="Callback URL"
                            value={redxWebhookUrl}
                            readOnly
                            autoComplete="off"
                            connectedRight={
                              <Button
                                onClick={() =>
                                  copyToClipboard(redxWebhookUrl, "redx_url")
                                }
                              >
                                {copiedKey === "redx_url" ? "Copied!" : "Copy URL"}
                              </Button>
                            }
                          />
                          <TextField
                            label="Webhook Secret"
                            value={webhookSecret}
                            readOnly
                            autoComplete="off"
                            connectedRight={
                              <Button
                                onClick={() =>
                                  copyToClipboard(webhookSecret, "redx_secret")
                                }
                              >
                                {copiedKey === "redx_secret" ? "Copied!" : "Copy Secret"}
                              </Button>
                            }
                            helpText="Paste in RedX Webhook Secret field."
                          />
                        </BlockStack>
                      </BlockStack>

                      <InlineStack align="space-between" blockAlign="center">
                        <Button onClick={() => setShowRedxForm(false)}>
                          Collapse
                        </Button>
                        <Button
                          variant="primary"
                          loading={isSubmittingRedx}
                          onClick={handleSaveRedX}
                        >
                          Save REDX Settings
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>
        </BlockStack>

        {/* ==================================================================== */}
        {/* SECTION 2: AUTOMATION RULES & AI WRAPPER                             */}
        {/* ==================================================================== */}
        <BlockStack gap="400">
          <BlockStack gap="050">
            <Text as="h2" variant="headingLg">
              Automatic Courier Selection &amp; Smart AI
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Automatic courier selection for district assignments and smart address correction.
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
                        Gemini AI Address Normalizer
                      </Text>
                      <Badge
                        tone={aiAddressCleaningEnabled ? "success" : "critical"}
                        progress={aiAddressCleaningEnabled ? "complete" : "incomplete"}
                      >
                        {aiAddressCleaningEnabled ? "Active" : "Inactive"}
                      </Badge>
                    </InlineStack>

                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={aiConfig.isGeminiConfigured ? "success" : "attention"}>
                        {aiConfig.isGeminiConfigured
                          ? "AI Normalizer Active"
                          : "Local Keyword Mode"}
                      </Badge>
                      <Badge tone="info">
                        {`${aiConfig.addressCacheCount} Cached Addresses`}
                      </Badge>
                    </InlineStack>
                  </InlineStack>

                  <Text as="p" variant="bodySm" tone="subdued">
                    During courier dispatch, messy Bangladeshi addresses (mixed Bengali, phonetics, missing thanas) are automatically normalized into canonical District &amp; Thana without slowing down Shopify checkouts.
                  </Text>

                  <Box
                    padding="400"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <Checkbox
                        label="Enable Gemini AI Address Normalization on Courier Dispatch"
                        helpText="Executes strictly when 'Send to Courier' is clicked. Normalized addresses are automatically saved for instant recurring lookups."
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
                        Map Bangladesh&apos;s 8 Divisions and 64 Districts to preferred couriers with fallback protection.
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
                      helpText="Incoming orders are evaluated against your fraud threshold and routed to the assigned Division/District courier."
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
                          Evaluated top to bottom. Specific district rules override division-wide rules.
                        </Text>
                      </BlockStack>

                      <Button variant="secondary" onClick={handleAddRuleRow}>
                        + Add Routing Rule
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
                        helpText="Primary courier assigned for orders inside Dhaka city."
                      />
                    </Grid.Cell>

                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                      <Select
                        label="Outside Dhaka Default Courier"
                        options={COURIER_OPTIONS}
                        value={outsideDhakaCourier}
                        onChange={(val) => setOutsideDhakaCourier(val)}
                        helpText="Primary courier assigned for orders outside Dhaka."
                      />
                    </Grid.Cell>

                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                      <Select
                        label="Catch-All Fallback Courier"
                        options={COURIER_OPTIONS}
                        value={defaultCourier}
                        onChange={(val) => setDefaultCourier(val)}
                        helpText="Fallback when no specific regional rule matches."
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
                        helpText="Orders from customers with a historical delivery success rate below this threshold are locked for manual verification before sending to courier."
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
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
