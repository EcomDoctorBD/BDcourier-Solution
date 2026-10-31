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
  DropZone,
  Thumbnail,
  ChoiceList,
  Popover,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { CourierLogo } from "../components/CourierLogo";
import { DynamicBarcodeGraphic, getThermalBarcodeDimensions } from "./app.orders";
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
  districts?: string[];
  courier: string;
}

export interface AutoRoutingConfig {
  autoRoutingEnabled: boolean;
  isAutoRoutingEnabled: boolean;
  baseCity?: string;
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
  pathaoParcelNote?: string;
  steadfastParcelNote?: string;
  redxParcelNote?: string;
  carrybeeParcelNote?: string;
  bahokParcelNote?: string;
  defaultParcelNote?: string;
  pathaoDefaultWeight?: number;
  steadfastDefaultWeight?: number;
  redxDefaultWeight?: number;
  carrybeeDefaultWeight?: number;
  bahokDefaultWeight?: number;
  defaultParcelWeight?: number;
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

export const ALL_64_DISTRICT_OPTIONS = Array.from(
  new Set(Object.values(BANGLADESH_LOCATIONS).flat())
)
  .sort((a, b) => a.localeCompare(b))
  .map((d) => ({ label: d, value: d }));

export function DistrictMultiSelectPopover({
  division,
  selectedDistricts,
  disabled,
  onChange,
}: {
  division: string;
  selectedDistricts: string[];
  disabled?: boolean;
  onChange: (districts: string[]) => void;
}) {
  const [popoverActive, setPopoverActive] = useState(false);
  const divisionDistricts = BANGLADESH_LOCATIONS[division] || [];

  const isAllSelected =
    selectedDistricts.length === 0 ||
    (divisionDistricts.length > 0 &&
      divisionDistricts.every((d) => selectedDistricts.includes(d)));

  let buttonLabel = `All Districts in ${division}`;
  if (!isAllSelected && selectedDistricts.length === 1) {
    buttonLabel = selectedDistricts[0];
  } else if (!isAllSelected && selectedDistricts.length > 1) {
    buttonLabel = `${selectedDistricts.length} Districts (${selectedDistricts.slice(0, 2).join(", ")}${selectedDistricts.length > 2 ? "..." : ""})`;
  }

  const handleToggleAll = (checked: boolean) => {
    onChange([]);
  };

  const handleToggleDistrict = (district: string, checked: boolean) => {
    let current = isAllSelected ? [...divisionDistricts] : [...selectedDistricts];
    if (checked) {
      if (!current.includes(district)) current.push(district);
    } else {
      current = current.filter((d) => d !== district);
    }
    if (
      current.length === 0 ||
      (divisionDistricts.length > 0 && divisionDistricts.every((d) => current.includes(d)))
    ) {
      onChange([]);
    } else {
      onChange(current);
    }
  };

  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" fontWeight="medium">
        District
      </Text>
      <Popover
        active={popoverActive}
        activator={
          <Button
            disclosure
            fullWidth
            textAlign="left"
            disabled={disabled}
            onClick={() => setPopoverActive((prev) => !prev)}
          >
            {buttonLabel}
          </Button>
        }
        onClose={() => setPopoverActive(false)}
        preferredAlignment="left"
      >
        <div style={{ width: "260px", padding: "12px", maxHeight: "260px", overflowY: "auto" }}>
          <BlockStack gap="200">
            <Checkbox
              label={`All Districts in ${division}`}
              checked={isAllSelected}
              onChange={handleToggleAll}
            />
            <Divider />
            <BlockStack gap="150">
              {divisionDistricts.map((d) => {
                const isChecked = isAllSelected || selectedDistricts.includes(d);
                return (
                  <Checkbox
                    key={d}
                    label={d}
                    checked={isChecked}
                    onChange={(newChecked) => handleToggleDistrict(d, newChecked)}
                  />
                );
              })}
            </BlockStack>
          </BlockStack>
        </div>
      </Popover>
    </BlockStack>
  );
}

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

export const getWarningBannerTheme = (colorCode: string, noteText: string = "") => {
  const isThankYou = /thank|thanks|ধন্যবাদ/i.test(noteText);
  switch (colorCode) {
    case "#dcfce7": // Thank You Green
      return {
        bg: "#dcfce7",
        text: "#166534",
        border: "#22c55e",
        icon: isThankYou ? "💖 " : "✨ ",
      };
    case "#dbeafe": // Info Blue
      return {
        bg: "#dbeafe",
        text: "#1e40af",
        border: "#3b82f6",
        icon: isThankYou ? "" : "ℹ️ ",
      };
    case "#fce7f3": // Soft Pink / Purple
      return {
        bg: "#fce7f3",
        text: "#9d174d",
        border: "#ec4899",
        icon: isThankYou ? "💖 " : "✨ ",
      };
    case "#f3f4f6": // Clean Gray / White
      return {
        bg: "#f3f4f6",
        text: "#1f2937",
        border: "#9ca3af",
        icon: "",
      };
    case "#fef3c7": // Warning Yellow (Default)
    default:
      return {
        bg: "#fef3c7",
        text: "#92400e",
        border: "#f59e0b",
        icon: isThankYou ? "✨ " : "⚠️ ",
      };
  }
};

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
  const canUseAutoRouting = ["pro", "advanced", "enterprise"].some((p) =>
    planLower.startsWith(p)
  );

  // Routing & Safety Settings
  const isAutoRoutingEnabled = Boolean(
    storeConfig?.isAutoRoutingEnabled ?? storeConfig?.autoRoutingEnabled ?? false
  );

  const baseCity = String(storeConfig?.baseCity || "Dhaka").trim();
  const rawCustomRoutes: CustomRouteRule[] =
    Array.isArray(storeConfig?.customRoutes) &&
    storeConfig.customRoutes.length > 0
      ? storeConfig.customRoutes.map((r: any) => ({
          division: String(r.division || "Dhaka"),
          district: String(r.district || "All Districts in Division"),
          districts: Array.isArray(r.districts)
            ? r.districts.map(String)
            : r.district && r.district !== "All Districts in Division"
            ? String(r.district).split(",").map((s) => s.trim())
            : [],
          courier: String(r.courier || "pathao"),
        }))
      : [
          { division: "Dhaka", district: "Dhaka", districts: ["Dhaka"], courier: "pathao" },
          {
            division: "Chattogram",
            district: "All Districts in Division",
            districts: [],
            courier: "steadfast",
          },
        ];

  const minSuccessRate = Number(
    storeConfig?.minSuccessRate ?? storeConfig?.minSafetySuccessRate ?? 70
  );

  const routingConfig: AutoRoutingConfig = {
    autoRoutingEnabled: isAutoRoutingEnabled,
    isAutoRoutingEnabled,
    baseCity: baseCity || "Dhaka",
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
    pathaoParcelNote: storeConfig?.pathaoParcelNote || "",
    steadfastParcelNote: storeConfig?.steadfastParcelNote || "",
    redxParcelNote: storeConfig?.redxParcelNote || "",
    carrybeeParcelNote: storeConfig?.carrybeeParcelNote || "",
    bahokParcelNote: storeConfig?.bahokParcelNote || "",
    defaultParcelNote: storeConfig?.defaultParcelNote || "",
    pathaoDefaultWeight: storeConfig?.pathaoDefaultWeight ?? storeConfig?.defaultParcelWeight ?? 0.5,
    steadfastDefaultWeight: storeConfig?.steadfastDefaultWeight ?? storeConfig?.defaultParcelWeight ?? 0.5,
    redxDefaultWeight: storeConfig?.redxDefaultWeight ?? storeConfig?.defaultParcelWeight ?? 0.5,
    carrybeeDefaultWeight: storeConfig?.carrybeeDefaultWeight ?? storeConfig?.defaultParcelWeight ?? 0.5,
    bahokDefaultWeight: storeConfig?.bahokDefaultWeight ?? storeConfig?.defaultParcelWeight ?? 0.5,
    defaultParcelWeight: storeConfig?.defaultParcelWeight ?? 0.5,
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

  const unifiedBrandLogo =
    (storeConfig as any)?.brandLogo ||
    (storeConfig as any)?.invoiceBrandLogo ||
    "";

  const shippingLabelConfig = {
    labelSize: (storeConfig as any)?.labelSize || "4in x 6in",
    labelStyle: (storeConfig as any)?.labelStyle || "standard",
    socialHandle: (storeConfig as any)?.socialHandle || "",
    warehouseWarning: (storeConfig as any)?.warehouseWarning || "FRAGILE / HANDLE WITH CARE",
    warningBannerColor: (storeConfig as any)?.warningBannerColor || "#fef3c7",
    brandName: (storeConfig as any)?.brandName || "",
    brandPhone: (storeConfig as any)?.brandPhone || "",
    brandAddress: (storeConfig as any)?.brandAddress || "",
    brandLogo: unifiedBrandLogo,
  };

  const invoiceConfig = {
    invoiceTemplate: (storeConfig as any)?.invoiceTemplate ?? "classic",
    invoiceBrandName: (storeConfig as any)?.invoiceBrandName || (storeConfig as any)?.brandName || "",
    invoiceBrandPhone: (storeConfig as any)?.invoiceBrandPhone || (storeConfig as any)?.brandPhone || "",
    invoiceBrandAddress: (storeConfig as any)?.invoiceBrandAddress || (storeConfig as any)?.brandAddress || "",
    invoiceBrandEmail: (storeConfig as any)?.invoiceBrandEmail || "",
    invoiceBrandWebsite: (storeConfig as any)?.invoiceBrandWebsite || "",
    invoiceBrandLogo: unifiedBrandLogo,
    invoiceAccentColor: (storeConfig as any)?.invoiceAccentColor || "#2563eb",
  };

  return json({
    shopDomain,
    currentPlan,
    isProOrEnterprise,
    canUseAutoRouting,
    courierConfig,
    routingConfig,
    aiConfig,
    appUrl,
    shippingLabelConfig,
    invoiceConfig,
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
    const pathaoParcelNote = String(formData.get("pathaoParcelNote") || "").trim();
    if (formData.has("pathaoParcelNote")) {
      updateSet.pathaoParcelNote = pathaoParcelNote;
    }
    const pathaoDefaultWeight = parseFloat(String(formData.get("pathaoDefaultWeight") || ""));
    if (!isNaN(pathaoDefaultWeight) && pathaoDefaultWeight > 0) {
      updateSet.pathaoDefaultWeight = pathaoDefaultWeight;
      updateSet.defaultParcelWeight = pathaoDefaultWeight;
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
    const steadfastParcelNote = String(formData.get("steadfastParcelNote") || "").trim();
    if (formData.has("steadfastParcelNote")) {
      updateSet.steadfastParcelNote = steadfastParcelNote;
    }
    const steadfastDefaultWeight = parseFloat(String(formData.get("steadfastDefaultWeight") || ""));
    if (!isNaN(steadfastDefaultWeight) && steadfastDefaultWeight > 0) {
      updateSet.steadfastDefaultWeight = steadfastDefaultWeight;
      updateSet.defaultParcelWeight = steadfastDefaultWeight;
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
    const redxParcelNote = String(formData.get("redxParcelNote") || "").trim();
    if (formData.has("redxParcelNote")) {
      updateSet.redxParcelNote = redxParcelNote;
    }
    const redxDefaultWeight = parseFloat(String(formData.get("redxDefaultWeight") || ""));
    if (!isNaN(redxDefaultWeight) && redxDefaultWeight > 0) {
      updateSet.redxDefaultWeight = redxDefaultWeight;
      updateSet.defaultParcelWeight = redxDefaultWeight;
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
    const carrybeeParcelNote = String(formData.get("carrybeeParcelNote") || "").trim();
    if (formData.has("carrybeeParcelNote")) {
      updateSet.carrybeeParcelNote = carrybeeParcelNote;
    }
    const carrybeeDefaultWeight = parseFloat(String(formData.get("carrybeeDefaultWeight") || ""));
    if (!isNaN(carrybeeDefaultWeight) && carrybeeDefaultWeight > 0) {
      updateSet.carrybeeDefaultWeight = carrybeeDefaultWeight;
      updateSet.defaultParcelWeight = carrybeeDefaultWeight;
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
    const bahokParcelNote = String(formData.get("bahokParcelNote") || "").trim();
    if (formData.has("bahokParcelNote")) {
      updateSet.bahokParcelNote = bahokParcelNote;
    }
    const bahokDefaultWeight = parseFloat(String(formData.get("bahokDefaultWeight") || ""));
    if (!isNaN(bahokDefaultWeight) && bahokDefaultWeight > 0) {
      updateSet.bahokDefaultWeight = bahokDefaultWeight;
      updateSet.defaultParcelWeight = bahokDefaultWeight;
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
    const rawStoreConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
    const currentPlanCheck = String(rawStoreConfig?.currentPlan || "Free").trim().toLowerCase();
    const isPlanEntitled = ["pro", "advanced", "enterprise"].some((p) =>
      currentPlanCheck.startsWith(p)
    );
    if (!isPlanEntitled) {
      return json({
        success: false,
        actionType: "saveRoutingSettings",
        message: "Automatic Courier Selection & District Routing is an advanced feature available on Pro, Advanced, and Enterprise plans. Please upgrade your plan under Pricing.",
      });
    }
    const isAutoRoutingEnabled =
      String(formData.get("isAutoRoutingEnabled")) === "true" ||
      String(formData.get("autoRoutingEnabled")) === "true";

    const allDistricts = Array.from(new Set(Object.values(BANGLADESH_LOCATIONS).flat()));
    const baseCityRaw = String(formData.get("baseCity") || "Dhaka").trim();
    const baseCity = allDistricts.includes(baseCityRaw) ? baseCityRaw : "Dhaka";

    const validCouriers = ["pathao", "steadfast", "redx", "carrybee", "bahok"];

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

    // Set fallback/default couriers to outsideDhakaCourier for seamless backward compatibility
    const defaultCourier = outsideDhakaCourier;
    const catchAllCourier = outsideDhakaCourier;

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

            const rawDistricts: string[] = Array.isArray(item.districts)
              ? item.districts.map(String)
              : item.district && item.district !== "All Districts in Division"
              ? String(item.district).split(",").map((s) => s.trim())
              : [];

            const validDistricts = rawDistricts.filter((d) =>
              divisionDistricts.includes(d)
            );

            const district =
              validDistricts.length === 1
                ? validDistricts[0]
                : validDistricts.length > 1
                ? validDistricts.join(", ")
                : "All Districts in Division";

            const courier = validCouriers.includes(String(item.courier))
              ? String(item.courier)
              : "pathao";

            return {
              division,
              district,
              districts: validDistricts,
              courier,
            };
          });
      }
    } catch {
      // ignore JSON parse error
    }

    if (parsedRoutes.length === 0 && (!customRoutesJson || customRoutesJson === "[]")) {
      parsedRoutes = [
        { division: "Dhaka", district: "Dhaka", districts: ["Dhaka"], courier: "pathao" },
        {
          division: "Chattogram",
          district: "All Districts in Division",
          districts: [],
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
          baseCity,
          customRoutes: parsedRoutes,
          defaultCourier,
          catchAllCourier,
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
      message: `Saved ${parsedRoutes.length} dynamic geo-routing rule(s), store base city (${baseCity}), and ${minSuccessRate}% fraud safety threshold.`,
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

  // ==================== 8. SAVE SHIPPING LABEL SETTINGS ====================
  if (actionType === "saveShippingLabelSettings") {
    const labelSize = String(formData.get("labelSize") || "4in x 6in").trim();
    const labelStyle = String(formData.get("labelStyle") || "standard").trim();
    const socialHandle = String(formData.get("socialHandle") || "").trim();
    const warehouseWarning = String(formData.get("warehouseWarning") || "FRAGILE / HANDLE WITH CARE").trim();
    const warningBannerColor = String(formData.get("warningBannerColor") || "#fef3c7").trim();
    const brandName = String(formData.get("brandName") || "").trim();
    const brandPhone = String(formData.get("brandPhone") || "").trim();
    const brandAddress = String(formData.get("brandAddress") || "").trim();
    const brandLogo = String(formData.get("brandLogo") || "").trim();

    // Enforce 500KB file size validation (500 * 1024 = 512,000 bytes)
    const MAX_LOGO_BYTES = 500 * 1024;
    if (brandLogo && brandLogo.startsWith("data:")) {
      const base64Data = brandLogo.split(",")[1] || "";
      const approxBytes = Math.ceil((base64Data.length * 3) / 4);
      if (approxBytes > MAX_LOGO_BYTES) {
        return json(
          {
            success: false,
            actionType: "saveShippingLabelSettings",
            message: "Logo file size must be 500KB or less. Please upload a smaller image.",
          },
          { status: 400 }
        );
      }
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          labelSize,
          labelStyle,
          socialHandle,
          warehouseWarning,
          warningBannerColor,
          brandName,
          brandPhone,
          brandAddress,
          brandLogo,
          invoiceBrandLogo: brandLogo, // Unified overwrite across templates
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return json({
      success: true,
      actionType: "saveShippingLabelSettings",
      message: "Shipping Label configuration saved successfully.",
    });
  }

  // ==================== 9. SAVE INVOICE SETTINGS ====================
  if (actionType === "saveInvoiceSettings") {
    const invoiceTemplate = String(formData.get("invoiceTemplate") || "classic").trim();
    const invoiceBrandName = String(formData.get("invoiceBrandName") || "").trim();
    const invoiceBrandPhone = String(formData.get("invoiceBrandPhone") || "").trim();
    const invoiceBrandAddress = String(formData.get("invoiceBrandAddress") || "").trim();
    const invoiceBrandEmail = String(formData.get("invoiceBrandEmail") || "").trim();
    const invoiceBrandWebsite = String(formData.get("invoiceBrandWebsite") || "").trim();
    const invoiceBrandLogo = String(formData.get("invoiceBrandLogo") || "").trim();
    const invoiceAccentColor = String(formData.get("invoiceAccentColor") || "#2563eb").trim();

    // Enforce 500KB file size validation (500 * 1024 = 512,000 bytes)
    const MAX_LOGO_BYTES = 500 * 1024;
    if (invoiceBrandLogo && invoiceBrandLogo.startsWith("data:")) {
      const base64Data = invoiceBrandLogo.split(",")[1] || "";
      const approxBytes = Math.ceil((base64Data.length * 3) / 4);
      if (approxBytes > MAX_LOGO_BYTES) {
        return json(
          {
            success: false,
            actionType: "saveInvoiceSettings",
            message: "Logo file size must be 500KB or less. Please upload a smaller image.",
          },
          { status: 400 }
        );
      }
    }

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          invoiceTemplate,
          invoiceBrandName,
          invoiceBrandPhone,
          invoiceBrandAddress,
          invoiceBrandEmail,
          invoiceBrandWebsite,
          invoiceBrandLogo,
          brandLogo: invoiceBrandLogo, // Unified overwrite across templates
          invoiceAccentColor,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return json({
      success: true,
      actionType: "saveInvoiceSettings",
      message: "Invoice configuration saved successfully.",
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
    canUseAutoRouting,
    courierConfig,
    routingConfig,
    aiConfig,
    appUrl,
    shippingLabelConfig,
    invoiceConfig,
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
  const [pathaoDefaultWeight, setPathaoDefaultWeight] = useState(String(courierConfig.pathaoDefaultWeight ?? "0.5"));
  const [pathaoParcelNote, setPathaoParcelNote] = useState(courierConfig.pathaoParcelNote || "");
  const [pathaoDeliveryType, setPathaoDeliveryType] = useState("regular");

  const handleResetPathao = () => {
    setPathaoDefaultWeight("0.5");
    setPathaoParcelNote("");
    setPathaoDeliveryType("regular");
    setDefaultCourier(routingConfig.defaultCourier || "steadfast");
  };

  const handleResetSteadfast = () => {
    setSteadfastDefaultWeight("0.5");
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
    setBahokDefaultWeight("0.5");
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
  const [steadfastDefaultWeight, setSteadfastDefaultWeight] = useState(String(courierConfig.steadfastDefaultWeight ?? "0.5"));
  const [steadfastDeliveryType, setSteadfastDeliveryType] = useState("home");
  const [steadfastParcelNote, setSteadfastParcelNote] = useState(courierConfig.steadfastParcelNote || "");

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
    formData.append("steadfastDefaultWeight", steadfastDefaultWeight);
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
  const [redxDefaultWeight, setRedxDefaultWeight] = useState(String(courierConfig.redxDefaultWeight ?? "0.5"));
  const [redxParcelNote, setRedxParcelNote] = useState(courierConfig.redxParcelNote || "");

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
  const [carrybeeDefaultWeight, setCarrybeeDefaultWeight] = useState(String(courierConfig.carrybeeDefaultWeight ?? "0.5"));
  const [carrybeeParcelNote, setCarrybeeParcelNote] = useState(courierConfig.carrybeeParcelNote || "");
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
  const [bahokDefaultWeight, setBahokDefaultWeight] = useState(String(courierConfig.bahokDefaultWeight ?? "0.5"));
  const [bahokParcelNote, setBahokParcelNote] = useState(courierConfig.bahokParcelNote || "");

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
    formData.append("bahokDefaultWeight", bahokDefaultWeight);
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
  const [baseCity, setBaseCity] = useState<string>(
    routingConfig.baseCity || "Dhaka"
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
    setBaseCity(routingConfig.baseCity || "Dhaka");
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
              districts: [],
            }
          : row
      )
    );
  };

  const handleDistrictsChange = (index: number, newDistricts: string[]) => {
    setCustomRoutes((prevRoutes) =>
      prevRoutes.map((row, idx) =>
        idx === index
          ? {
              ...row,
              districts: newDistricts,
              district:
                newDistricts.length === 0
                  ? "All Districts in Division"
                  : newDistricts.length === 1
                  ? newDistricts[0]
                  : newDistricts.join(", "),
            }
          : row
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
        districts: [],
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

  // ==================== 7. SHIPPING LABEL SETTINGS STATE ====================
  const [labelSize, setLabelSize] = useState<string>(
    shippingLabelConfig?.labelSize || "4in x 6in"
  );
  const [labelStyle, setLabelStyle] = useState<string>(
    shippingLabelConfig?.labelStyle || "standard"
  );
  const [socialHandle, setSocialHandle] = useState<string>(
    shippingLabelConfig?.socialHandle || ""
  );
  const [warehouseWarning, setWarehouseWarning] = useState<string>(
    shippingLabelConfig?.warehouseWarning || "FRAGILE / HANDLE WITH CARE"
  );
  const [warningBannerColor, setWarningBannerColor] = useState<string>(
    shippingLabelConfig?.warningBannerColor || "#fef3c7"
  );
  const [brandName, setBrandName] = useState<string>(
    shippingLabelConfig?.brandName || ""
  );
  const [brandPhone, setBrandPhone] = useState<string>(
    shippingLabelConfig?.brandPhone || ""
  );
  const [brandAddress, setBrandAddress] = useState<string>(
    shippingLabelConfig?.brandAddress || ""
  );
  const unifiedInitialLogo =
    shippingLabelConfig?.brandLogo ||
    invoiceConfig?.invoiceBrandLogo ||
    "";
  const [brandLogo, setBrandLogo] = useState<string>(unifiedInitialLogo);
  const [logoError, setLogoError] = useState<string>("");

  const isCompactLabel = [
    "4in x 2in",
    "3in x 2in",
    "2in x 1.5in",
    "1.5in x 1in",
    "2in x 1in",
    "2in x 1.15in",
    "2.2in x 1.4in",
    "2in x 2.95in",
  ].includes(labelSize);

  // Form field visibility rules:
  // - Brand Contacts (Phone, Address, Social Handle): Large sizes + "4in x 2in" (wide) + "2in x 2.95in" (tall)
  const canShowBrandContacts = ![
    "3in x 2in",
    "2in x 1.5in",
    "1.5in x 1in",
    "2in x 1in",
    "2in x 1.15in",
    "2.2in x 1.4in",
  ].includes(labelSize);

  // - Warehouse Warning & Theme: Large sizes ("4in x 6in", "3in x 4in", "3in x 3in") + "2in x 2.95in" (tall vertical space)
  const canShowWarehouseWarning = [
    "4in x 6in",
    "3in x 4in",
    "3in x 3in",
    "2in x 2.95in",
  ].includes(labelSize);

  const isUltraSmall = [
    "1.5in x 1in",
    "2in x 1in",
    "2in x 1.15in",
    "2.2in x 1.4in",
  ].includes(labelSize);
  const isWideHorizontal = labelSize === "4in x 2in";
  const isTallNarrow = labelSize === "2in x 2.95in";
  const isSquare3x3 = labelSize === "3in x 3in";
  const isMedium3x4 = labelSize === "3in x 4in";
  const isFullSlip = ["4in x 6in", "3in x 4in", "3in x 3in"].includes(labelSize);
  const barcodeDims = getThermalBarcodeDimensions(labelSize);

  const getLabelDimensions = (size: string) => {
    switch (size) {
      case "4in x 6in":
        return { maxWidth: "320px", minHeight: "460px", padding: "16px 18px", aspectRatio: "2 / 3" };
      case "3in x 4in":
        return { maxWidth: "300px", minHeight: "400px", padding: "10px 12px", aspectRatio: "3 / 4" };
      case "3in x 3in":
        return { maxWidth: "300px", minHeight: "300px", padding: "8px 10px", aspectRatio: "1 / 1" };
      case "4in x 2in":
        return { maxWidth: "340px", minHeight: "170px", padding: "6px 12px", aspectRatio: "2 / 1" };
      case "3in x 2in":
        return { maxWidth: "300px", minHeight: "195px", padding: "10px 12px", aspectRatio: "3 / 2" };
      case "2in x 1.5in":
        return { maxWidth: "260px", minHeight: "190px", padding: "8px 10px", aspectRatio: "4 / 3" };
      case "2in x 2.95in":
        return { maxWidth: "220px", minHeight: "315px", padding: "8px 8px", aspectRatio: "2 / 2.95" };
      case "2.2in x 1.4in":
        return { maxWidth: "260px", minHeight: "165px", padding: "3px 5px", aspectRatio: "2.2 / 1.4" };
      case "2in x 1.15in":
        return { maxWidth: "250px", minHeight: "144px", padding: "3px 5px", aspectRatio: "2 / 1.15" };
      case "2in x 1in":
        return { maxWidth: "250px", minHeight: "125px", padding: "3px 5px", aspectRatio: "2 / 1" };
      case "1.5in x 1in":
        return { maxWidth: "225px", minHeight: "150px", padding: "3px 5px", aspectRatio: "1.5 / 1" };
      default:
        return { maxWidth: "320px", minHeight: "460px", padding: "16px 18px", aspectRatio: "2 / 3" };
    }
  };

  const isSubmittingShippingLabel =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveShippingLabelSettings";

  const handleLogoUpload = (_files: File[], acceptedFiles: File[], rejectedFiles?: File[]) => {
    setLogoError("");
    if (rejectedFiles && rejectedFiles.length > 0) {
      setLogoError("Logo file size must be 500KB or less. Please upload a smaller image.");
      return;
    }
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const MAX_SIZE = 500 * 1024; // 512,000 bytes
      if (file.size > MAX_SIZE) {
        setLogoError("Logo file size must be 500KB or less. Please upload a smaller image.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        setBrandLogo(dataUrl);
        setLogoError("");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveLogo = () => {
    setBrandLogo("");
    setLogoError("");
  };

  const handleSaveShippingLabelSettings = () => {
    const formData = new FormData();
    formData.append("actionType", "saveShippingLabelSettings");
    formData.append("labelSize", labelSize);
    formData.append("labelStyle", labelStyle);
    formData.append("socialHandle", socialHandle);
    formData.append("warehouseWarning", warehouseWarning);
    formData.append("warningBannerColor", warningBannerColor);
    formData.append("brandName", brandName);
    formData.append("brandPhone", brandPhone);
    formData.append("brandAddress", brandAddress);
    formData.append("brandLogo", brandLogo);
    submit(formData, { method: "post" });
  };

  const handleResetShippingLabel = () => {
    setLabelSize(shippingLabelConfig?.labelSize || "4in x 6in");
    setLabelStyle(shippingLabelConfig?.labelStyle || "standard");
    setSocialHandle(shippingLabelConfig?.socialHandle || "");
    setWarehouseWarning(shippingLabelConfig?.warehouseWarning || "FRAGILE / HANDLE WITH CARE");
    setWarningBannerColor(shippingLabelConfig?.warningBannerColor || "#fef3c7");
    setBrandName(shippingLabelConfig?.brandName || "");
    setBrandPhone(shippingLabelConfig?.brandPhone || "");
    setBrandAddress(shippingLabelConfig?.brandAddress || "");
    setBrandLogo(shippingLabelConfig?.brandLogo || invoiceConfig?.invoiceBrandLogo || "");
    setLogoError("");
  };

  // ==================== 8. INVOICE SETTINGS STATE ====================
  const [invoiceTemplate, setInvoiceTemplate] = useState<string>(
    invoiceConfig?.invoiceTemplate ?? "classic"
  );
  const [invoiceBrandName, setInvoiceBrandName] = useState<string>(
    invoiceConfig?.invoiceBrandName || brandName || "SafeParcel Store"
  );
  const [invoiceBrandPhone, setInvoiceBrandPhone] = useState<string>(
    invoiceConfig?.invoiceBrandPhone || brandPhone || "+880 1711-000000"
  );
  const [invoiceBrandAddress, setInvoiceBrandAddress] = useState<string>(
    invoiceConfig?.invoiceBrandAddress || brandAddress || "House 42, Road 11, Banani, Dhaka"
  );
  const [invoiceBrandEmail, setInvoiceBrandEmail] = useState<string>(
    invoiceConfig?.invoiceBrandEmail || "support@safeparcelbd.com"
  );
  const [invoiceBrandWebsite, setInvoiceBrandWebsite] = useState<string>(
    invoiceConfig?.invoiceBrandWebsite || "www.safeparcelbd.com"
  );
  const [invoiceAccentColor, setInvoiceAccentColor] = useState<string>(
    invoiceConfig?.invoiceAccentColor || "#2563eb"
  );

  const isSubmittingInvoice =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveInvoiceSettings";

  const handleSaveInvoiceSettings = () => {
    const formData = new FormData();
    formData.append("actionType", "saveInvoiceSettings");
    formData.append("invoiceTemplate", invoiceTemplate);
    formData.append("invoiceBrandName", invoiceBrandName);
    formData.append("invoiceBrandPhone", invoiceBrandPhone);
    formData.append("invoiceBrandAddress", invoiceBrandAddress);
    formData.append("invoiceBrandEmail", invoiceBrandEmail);
    formData.append("invoiceBrandWebsite", invoiceBrandWebsite);
    formData.append("invoiceBrandLogo", brandLogo);
    formData.append("invoiceAccentColor", invoiceAccentColor);
    submit(formData, { method: "post" });
  };

  const handleResetInvoice = () => {
    setInvoiceTemplate(invoiceConfig?.invoiceTemplate ?? "classic");
    setInvoiceBrandName(invoiceConfig?.invoiceBrandName || brandName || "SafeParcel Store");
    setInvoiceBrandPhone(invoiceConfig?.invoiceBrandPhone || brandPhone || "+880 1711-000000");
    setInvoiceBrandAddress(invoiceConfig?.invoiceBrandAddress || brandAddress || "House 42, Road 11, Banani, Dhaka");
    setInvoiceBrandEmail(invoiceConfig?.invoiceBrandEmail || "support@safeparcelbd.com");
    setInvoiceBrandWebsite(invoiceConfig?.invoiceBrandWebsite || "www.safeparcelbd.com");
    setBrandLogo(invoiceConfig?.invoiceBrandLogo || shippingLabelConfig?.brandLogo || "");
    setInvoiceAccentColor(invoiceConfig?.invoiceAccentColor || "#2563eb");
    setLogoError("");
  };

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
    formData.append("baseCity", baseCity);
    formData.append("defaultCourier", outsideDhakaCourier);
    formData.append("catchAllCourier", outsideDhakaCourier);
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
          className="bg-white dark:bg-[#1a1a1a] rounded-lg border border-gray-200 dark:border-gray-800"
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
                className="w-full md:w-80 flex-shrink-0 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm"
                style={{
                  width: "280px",
                  backgroundColor: "var(--p-color-bg-surface, #FFFFFF)",
                  borderRadius: "16px",
                  padding: "20px",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                  border: "1px solid var(--p-color-border, #E2E8F0)",
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
                    borderBottom: "1px solid var(--p-color-border, #F1F5F9)",
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
                    className={activeSetupTab === "api" ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      fontSize: "13px",
                      fontWeight: activeSetupTab === "api" ? 700 : 500,
                      backgroundColor: activeSetupTab === "api" ? "var(--p-color-bg-surface-selected, #F1F5F9)" : "transparent",
                      color: activeSetupTab === "api" ? "var(--p-color-text, #0F172A)" : "var(--p-color-text-secondary, #64748B)",
                      border: activeSetupTab === "api" ? "1px solid var(--p-color-border, #CBD5E1)" : "1px solid transparent",
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
                    className={activeSetupTab === "webhook" ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      fontSize: "13px",
                      fontWeight: activeSetupTab === "webhook" ? 700 : 500,
                      backgroundColor: activeSetupTab === "webhook" ? "var(--p-color-bg-surface-selected, #F1F5F9)" : "transparent",
                      color: activeSetupTab === "webhook" ? "var(--p-color-text, #0F172A)" : "var(--p-color-text-secondary, #64748B)",
                      border: activeSetupTab === "webhook" ? "1px solid var(--p-color-border, #CBD5E1)" : "1px solid transparent",
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
                    className={activeSetupTab === "settings" ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      fontSize: "13px",
                      fontWeight: activeSetupTab === "settings" ? 700 : 500,
                      backgroundColor: activeSetupTab === "settings" ? "var(--p-color-bg-surface-selected, #F1F5F9)" : "transparent",
                      color: activeSetupTab === "settings" ? "var(--p-color-text, #0F172A)" : "var(--p-color-text-secondary, #64748B)",
                      border: activeSetupTab === "settings" ? "1px solid var(--p-color-border, #CBD5E1)" : "1px solid transparent",
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
                              Enter your Pathao API credentials to connect your courier account.
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
                            />
                            <TextField
                              label="Merchant Username (Email)"
                              value={pathaoUsername}
                              onChange={(val) => setPathaoUsername(val)}
                              placeholder="merchant@example.com"
                              autoComplete="off"
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
                            />
                            <InlineStack gap="300" blockAlign="center">
                              <Button
                                size="medium"
                                loading={isFetchingPathaoStores}
                                onClick={handleFetchPathaoStores}
                              >
                                Verify Credentials & Fetch Stores
                              </Button>
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
                                label="Store ID"
                                value={pathaoStoreId}
                                onChange={(val) => setPathaoStoreId(val)}
                                placeholder="e.g. 12345"
                                autoComplete="off"
                                helpText="Click 'Verify Credentials & Fetch Stores' above to load your store ID automatically."
                              />
                            )}
                          </BlockStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Button
                              variant="plain"
                              tone="critical"
                              onClick={handleResetPathao}
                            >
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
                              Copy and paste this URL and Secret Token into your Pathao Merchant Portal webhook settings to sync delivery statuses automatically.
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
                            />
                            <TextField
                              label="Webhook Secret Token"
                              value={webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(webhookSecret, "pathao_secret")}>
                                  {copiedKey === "pathao_secret" ? "Copied!" : "Copy Token"}
                                </Button>
                              }
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
                              <Text as="h3" variant="headingMd" fontWeight="bold">Pathao Default Settings</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Set your default parcel weight and delivery note for Pathao orders.
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
                                helpText="Avoid using emojis or special characters."
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
                            </BlockStack>
                            <Divider />
                            <InlineStack align="space-between" blockAlign="center">
                              <Button
                                variant="plain"
                                tone="critical"
                                onClick={handleResetPathao}
                              >
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
                              Enter your Steadfast API credentials to connect your courier account.
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
                          <InlineStack align="space-between" blockAlign="center">
                            <Button
                              variant="plain"
                              tone="critical"
                              onClick={handleResetSteadfast}
                            >
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
                              Copy and paste this URL and Secret Token into your Steadfast Merchant Portal webhook settings to sync delivery statuses automatically.
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
                              label="Webhook Secret Token"
                              value={webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(webhookSecret, "steadfast_secret")}>
                                  {copiedKey === "steadfast_secret" ? "Copied!" : "Copy Token"}
                                </Button>
                              }
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
                              <Text as="h3" variant="headingMd" fontWeight="bold">Steadfast Default Settings</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Set your default parcel weight and delivery note for Steadfast orders.
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
                              <TextField
                                label="Default Parcel Weight (kg)"
                                type="number"
                                value={steadfastDefaultWeight}
                                onChange={(val) => setSteadfastDefaultWeight(val)}
                                placeholder="0.5"
                                autoComplete="off"
                                min={0.1}
                                step={0.1}
                              />
                              <TextField
                                label="Default Parcel Note"
                                value={steadfastParcelNote}
                                onChange={(val) => setSteadfastParcelNote(val)}
                                placeholder="e.g. Please call customer before delivery"
                                multiline={3}
                                autoComplete="off"
                                helpText="Avoid using emojis or special characters."
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
                            </BlockStack>
                            <Divider />
                            <InlineStack align="space-between" blockAlign="center">
                              <Button
                                variant="plain"
                                tone="critical"
                                onClick={handleResetSteadfast}
                              >
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
                              Enter your REDX API credentials to connect your courier account.
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
                            />
                            <InlineStack gap="300" blockAlign="center">
                              <Button
                                size="medium"
                                loading={isFetchingRedxStores}
                                onClick={handleFetchRedxStores}
                              >
                                Verify Credentials & Fetch Pickup Stores
                              </Button>
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
                                label="Store ID"
                                value={redxPickupStoreId}
                                onChange={(val) => {
                                  setRedxPickupStoreId(val);
                                  setRedxLocationId(val);
                                }}
                                placeholder="e.g. 101"
                                autoComplete="off"
                                helpText="Click 'Verify Credentials & Fetch Stores' above to load your store ID automatically."
                              />
                            )}
                          </BlockStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Button
                              variant="plain"
                              tone="critical"
                              onClick={handleResetRedX}
                            >
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
                              Copy and paste this URL and Secret Token into your REDX Merchant Portal webhook settings to sync delivery statuses automatically.
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
                              label="Webhook Secret Token"
                              value={webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(webhookSecret, "redx_secret")}>
                                  {copiedKey === "redx_secret" ? "Copied!" : "Copy Token"}
                                </Button>
                              }
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
                              <Text as="h3" variant="headingMd" fontWeight="bold">REDX Default Settings</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Set your default parcel weight and delivery note for REDX orders.
                              </Text>
                            </BlockStack>
                            <Divider />
                            <BlockStack gap="400">
                              <Checkbox
                                label="Set REDX as default courier"
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
                                placeholder="e.g. Please call customer before delivery"
                                multiline={3}
                                autoComplete="off"
                                helpText="Avoid using emojis or special characters."
                              />
                            </BlockStack>
                            <Divider />
                            <InlineStack align="space-between" blockAlign="center">
                              <Button
                                variant="plain"
                                tone="critical"
                                onClick={handleResetRedX}
                              >
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
                              Enter your CarryBee API credentials to connect your courier account.
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
                              placeholder="••••••••••••••••"
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
                              placeholder="••••••••••••••••"
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
                          </BlockStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Button
                              variant="plain"
                              tone="critical"
                              onClick={handleResetCarrybee}
                            >
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
                              Copy and paste this URL and Secret Token into your CarryBee Merchant Portal webhook settings to sync delivery statuses automatically.
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
                              label="Webhook Secret Token"
                              value={carrybeeWebhookSecret || webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(carrybeeWebhookSecret || webhookSecret, "carrybee_secret")}>
                                  {copiedKey === "carrybee_secret" ? "Copied!" : "Copy Token"}
                                </Button>
                              }
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
                              <Text as="h3" variant="headingMd" fontWeight="bold">CarryBee Default Settings</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Set your default parcel weight and delivery note for CarryBee orders.
                              </Text>
                            </BlockStack>
                            <Divider />
                            <BlockStack gap="400">
                              <Checkbox
                                label="Set CarryBee as default courier"
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
                                helpText="Avoid using emojis or special characters."
                              />
                            </BlockStack>
                            <Divider />
                            <InlineStack align="space-between" blockAlign="center">
                              <Button
                                variant="plain"
                                tone="critical"
                                onClick={handleResetCarrybee}
                              >
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
                              Enter your Bahok API credentials to connect your courier account.
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
                              placeholder="••••••••••••••••"
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
                          </BlockStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Button
                              variant="plain"
                              tone="critical"
                              onClick={handleResetBahok}
                            >
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
                              Copy and paste this URL and Secret Token into your Bahok Merchant Portal webhook settings to sync delivery statuses automatically.
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
                              label="Webhook Secret Token"
                              value={bahokWebhookSecret || webhookSecret}
                              readOnly
                              autoComplete="off"
                              connectedRight={
                                <Button onClick={() => copyToClipboard(bahokWebhookSecret || webhookSecret, "bahok_secret")}>
                                  {copiedKey === "bahok_secret" ? "Copied!" : "Copy Token"}
                                </Button>
                              }
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
                              <Text as="h3" variant="headingMd" fontWeight="bold">Bahok Default Settings</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Set your default parcel weight and delivery note for Bahok orders.
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
                                label="Default Parcel Weight (kg)"
                                type="number"
                                value={bahokDefaultWeight}
                                onChange={(val) => setBahokDefaultWeight(val)}
                                placeholder="0.5"
                                autoComplete="off"
                                min={0.1}
                                step={0.1}
                              />
                              <TextField
                                label="Default Parcel Note"
                                value={bahokParcelNote}
                                onChange={(val) => setBahokParcelNote(val)}
                                placeholder="e.g. Please call customer before delivery"
                                multiline={3}
                                autoComplete="off"
                                helpText="Avoid using emojis or special characters."
                              />
                            </BlockStack>
                            <Divider />
                            <InlineStack align="space-between" blockAlign="center">
                              <Button
                                variant="plain"
                                tone="critical"
                                onClick={handleResetBahok}
                              >
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
                className="w-full bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200 border border-gray-200 dark:border-gray-800"
                style={{
                  backgroundColor: "var(--p-color-bg-surface, #FFFFFF)",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "1px solid var(--p-color-border, #E2E8F0)",
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
                  <div className="text-slate-500 dark:text-slate-400" style={{ color: "var(--p-color-text-secondary, #64748B)", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
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
                className="w-full bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200 border border-gray-200 dark:border-gray-800"
                style={{
                  backgroundColor: "var(--p-color-bg-surface, #FFFFFF)",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "1px solid var(--p-color-border, #E2E8F0)",
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
                  <div className="text-slate-500 dark:text-slate-400" style={{ color: "var(--p-color-text-secondary, #64748B)", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
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
                className="w-full bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200 border border-gray-200 dark:border-gray-800"
                style={{
                  backgroundColor: "var(--p-color-bg-surface, #FFFFFF)",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "1px solid var(--p-color-border, #E2E8F0)",
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
                  <div className="text-slate-500 dark:text-slate-400" style={{ color: "var(--p-color-text-secondary, #64748B)", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
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
                className="w-full bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200 border border-gray-200 dark:border-gray-800"
                style={{
                  backgroundColor: "var(--p-color-bg-surface, #FFFFFF)",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "1px solid var(--p-color-border, #E2E8F0)",
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
                  <div className="text-slate-500 dark:text-slate-400" style={{ color: "var(--p-color-text-secondary, #64748B)", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
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
                className="w-full bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200 border border-gray-200 dark:border-gray-800"
                style={{
                  backgroundColor: "var(--p-color-bg-surface, #FFFFFF)",
                  borderRadius: "16px",
                  boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.03)",
                  border: "1px solid var(--p-color-border, #E2E8F0)",
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
                  <div className="text-slate-500 dark:text-slate-400" style={{ color: "var(--p-color-text-secondary, #64748B)", fontSize: "13px", lineHeight: "1.5", textAlign: "center", maxWidth: "280px" }}>
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
                  {!canUseAutoRouting && (
                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #cbd5e1",
                        borderRadius: "10px",
                        padding: "14px 16px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "8px",
                            background: "#e2e8f0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#475569",
                            fontSize: "18px",
                          }}
                        >
                          🔒
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>
                            Automatic Courier Selection is available on Pro, Advanced &amp; Enterprise plans
                          </div>
                          <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
                            Upgrade your plan to automatically route parcels to your preferred couriers based on customer location.
                          </div>
                        </div>
                      </div>
                      <Button url="/app/pricing" variant="primary">
                        Upgrade Plan
                      </Button>
                    </div>
                  )}

                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingMd">
                          Automatic Courier Selection Rules
                        </Text>
                        <Badge tone={!canUseAutoRouting ? "attention" : isAutoRoutingEnabled ? "success" : "attention"}>
                          {!canUseAutoRouting ? "Locked (Upgrade Required)" : isAutoRoutingEnabled ? "Active" : "Manual Mode"}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        কোন এলাকার অর্ডারের জন্য কোন কুরিয়ার আগে থেকে সিলেক্ট হয়ে থাকবে তা এখানে সেট করুন 
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <Divider />

                  <div>
                    <BlockStack gap="400">
                      {/* Master Automation Switch */}
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Checkbox
                          label="Enable Automatic Courier Selection & Fraud Protection"
                          helpText="চালু থাকলে অর্ডার পেজের ড্রপডাউনে কাস্টমারের জেলা অনুযায়ী আপনার পছন্দের কুরিয়ারটি অটোমেটিক সিলেক্ট হয়ে থাকবে।"
                          checked={!canUseAutoRouting ? false : isAutoRoutingEnabled}
                          disabled={!canUseAutoRouting}
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
                              নির্দিষ্ট কোনো বিভাগ বা একসাথে একাধিক জেলার জন্য আলাদা কুরিয়ার সেট করতে চাইলে এখানে রুল তৈরি করুন।
                            </Text>
                          </BlockStack>

                          <Button variant="secondary" disabled={!canUseAutoRouting} onClick={handleAddRuleRow}>
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
                                      disabled={!canUseAutoRouting}
                                      onChange={(val) =>
                                        handleDivisionChange(index, val)
                                      }
                                    />
                                  </Grid.Cell>

                                  {/* District Multi-Select Popover */}
                                  <Grid.Cell
                                    columnSpan={{
                                      xs: 6,
                                      sm: 6,
                                      md: 2,
                                      lg: 4,
                                      xl: 4,
                                    }}
                                  >
                                    <DistrictMultiSelectPopover
                                      division={rule.division}
                                      selectedDistricts={
                                        rule.districts && rule.districts.length > 0
                                          ? rule.districts
                                          : rule.district && rule.district !== "All Districts in Division"
                                          ? rule.district.split(",").map((s) => s.trim())
                                          : []
                                      }
                                      disabled={!canUseAutoRouting}
                                      onChange={(newDistricts) =>
                                        handleDistrictsChange(index, newDistricts)
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
                                          disabled={!canUseAutoRouting}
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
                                          disabled={!canUseAutoRouting}
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

                      {/* Dynamic Store City -> Inside & Outside Default Couriers */}
                      <Grid>
                        {/* Column 1: Your Store City (District) */}
                        <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                          <Select
                            label="Your Store City (District)"
                            options={ALL_64_DISTRICT_OPTIONS}
                            value={baseCity}
                            disabled={!canUseAutoRouting}
                            onChange={(val) => setBaseCity(val)}
                            helpText="আপনার স্টোর বা গোডাউন কোন জেলায় অবস্থিত তা সিলেক্ট করুন।"
                          />
                        </Grid.Cell>

                        {/* Column 2: Inside ${baseCity} Default Courier */}
                        <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                          <Select
                            label={`Inside ${baseCity} Default Courier`}
                            options={COURIER_OPTIONS}
                            value={insideDhakaCourier}
                            disabled={!canUseAutoRouting}
                            onChange={(val) => setInsideDhakaCourier(val)}
                            helpText={`${baseCity} জেলার ভেতরের সব অর্ডারের জন্য কোন কুরিয়ারটি অটোমেটিক সিলেক্ট হবে।`}
                          />
                        </Grid.Cell>

                        {/* Column 3: Outside ${baseCity} Default Courier */}
                        <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                          <Select
                            label={`Outside ${baseCity} Default Courier`}
                            options={COURIER_OPTIONS}
                            value={outsideDhakaCourier}
                            disabled={!canUseAutoRouting}
                            onChange={(val) => setOutsideDhakaCourier(val)}
                            helpText={`${baseCity} জেলার বাইরের সব অর্ডারের জন্য কোন কুরিয়ারটি অটোমেটিক সিলেক্ট হবে।`}
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
                            disabled={!canUseAutoRouting}
                            onChange={(val) => setMinSuccessRate(val)}
                            autoComplete="off"
                            helpText="কাস্টমারের আগের ডেলিভারি রেকর্ড এই পার্সেন্টেজের কম হলে অর্ডারটিতে অটোমেটিক কুরিয়ার বসবে না, যাতে আপনি আগে কল দিয়ে কনফার্ম করতে পারেন।"
                          />
                        </Grid.Cell>
                      </Grid>

                      <Divider />

                      <InlineStack align="end" blockAlign="center">
                        <Button
                          variant="primary"
                          loading={isSavingRoutingSettings}
                          disabled={!canUseAutoRouting}
                          onClick={handleSaveRoutingSettings}
                        >
                          Save Courier Selection Rules
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

            </BlockStack>
          </BlockStack>
        )}
        </div>

        {/* ==================================================================== */}
        {/* SCENARIO B: SHIPPING LABEL INTERACTIVE DUAL-PANE VIEW                */}
        {/* ==================================================================== */}
        {selectedSettingsTab === "shipping_label" && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "24px",
              alignItems: "start",
            }}
          >
                        {/* LEFT PANEL: TWO SEPARATE WHITE CARDS (16px GAP) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* BLOCK 1: Title "Label Design Template" */}
              <Card padding="500">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingSm" fontWeight="bold">
                    Label Design Template
                  </Text>
                  <ChoiceList
                    title="Label Design Template"
                    titleHidden
                    choices={[
                      {
                        label: "Standard",
                        value: "standard",
                        helpText: "Free & Starter plan",
                      },
                      {
                        label: "Modern",
                        value: "brand_centric",
                        helpText: "Growth & Pro plan",
                      },
                      {
                        label: "Premium",
                        value: "smart_warehouse",
                        helpText: "Advanced & Enterprise plan",
                      },
                    ]}
                    selected={labelStyle ? [labelStyle] : ["standard"]}
                    onChange={(selected) => setLabelStyle(selected[0] || "standard")}
                  />
                </BlockStack>
              </Card>

              {/* BLOCK 2: Title "Brand Details" */}
              <Card padding="500">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingSm" fontWeight="bold">
                    Brand Details
                  </Text>

                  {/* Label Size Dropdown placed at the very top of Block 2 */}
                  <Select
                    label="Label Size *"
                    options={[
                      { label: "4in x 6in", value: "4in x 6in" },
                      { label: "4in x 2in", value: "4in x 2in" },
                      { label: "3in x 4in", value: "3in x 4in" },
                      { label: "3in x 3in", value: "3in x 3in" },
                      { label: "3in x 2in", value: "3in x 2in" },
                      { label: "2in x 1.5in", value: "2in x 1.5in" },
                      { label: "1.5in x 1in", value: "1.5in x 1in" },
                      { label: "2in x 1in", value: "2in x 1in" },
                      { label: "2in x 1.15in", value: "2in x 1.15in" },
                      { label: "2.2in x 1.4in", value: "2.2in x 1.4in" },
                      { label: "2in x 2.95in", value: "2in x 2.95in" },
                    ]}
                    value={labelSize}
                    onChange={(val) => setLabelSize(val)}
                  />

                  {/* PRO TIER FIELD: Social Media Handle (Enabled for large sizes, 4in x 2in, and 2in x 2.95in) */}
                  {canShowBrandContacts && labelStyle === "brand_centric" && (
                    <TextField
                      label="Instagram / Facebook handle (@brand)"
                      value={socialHandle}
                      onChange={(val) => setSocialHandle(val)}
                      placeholder="e.g. @safeparcelbd or fb.com/safeparcelbd"
                      autoComplete="off"
                    />
                  )}

                  {/* ENTERPRISE TIER FIELD: Fallback Custom Warehouse Warning Label & Theme (Enabled for large sizes and 2in x 2.95in) */}
                  {canShowWarehouseWarning && labelStyle === "smart_warehouse" && (
                    <BlockStack gap="200">
                      <Select
                        label="Fallback Warehouse Warning Label"
                        options={[
                          { label: "FRAGILE / HANDLE WITH CARE", value: "FRAGILE / HANDLE WITH CARE" },
                          { label: "DO NOT BEND / WATERPROOF", value: "DO NOT BEND / WATERPROOF" },
                          { label: "VERIFY CONTENTS BEFORE DELIVERY", value: "VERIFY CONTENTS BEFORE DELIVERY" },
                          { label: "KEEP DRY / APPAREL GOODS", value: "KEEP DRY / APPAREL GOODS" },
                          { label: "HIGH VALUE CONSIGNMENT", value: "HIGH VALUE CONSIGNMENT" },
                          { label: "Custom Warning / Note...", value: "custom" },
                        ]}
                        value={[
                          "FRAGILE / HANDLE WITH CARE",
                          "DO NOT BEND / WATERPROOF",
                          "VERIFY CONTENTS BEFORE DELIVERY",
                          "KEEP DRY / APPAREL GOODS",
                          "HIGH VALUE CONSIGNMENT",
                        ].includes(warehouseWarning) ? warehouseWarning : "custom"}
                        onChange={(val) => {
                          if (val !== "custom") {
                            setWarehouseWarning(val);
                          }
                        }}
                      />
                      <TextField
                        label="Warning / Note Text"
                        labelHidden
                        value={warehouseWarning}
                        onChange={(val) => setWarehouseWarning(val)}
                        placeholder="e.g. FRAGILE / HANDLE WITH CARE or Thank you for your order!"
                        autoComplete="off"
                      />
                      <Select
                        label="Banner Background Color"
                        options={[
                          { label: "Warning Yellow (Default)", value: "#fef3c7" },
                          { label: "Thank You Green", value: "#dcfce7" },
                          { label: "Info Blue", value: "#dbeafe" },
                          { label: "Soft Pink / Purple", value: "#fce7f3" },
                          { label: "Clean Gray / White", value: "#f3f4f6" },
                        ]}
                        value={warningBannerColor}
                        onChange={(val) => setWarningBannerColor(val)}
                      />
                    </BlockStack>
                  )}

                  <TextField
                    label="Brand Name"
                    value={brandName}
                    onChange={(val) => setBrandName(val)}
                    placeholder="e.g. My Awesome Shop"
                    autoComplete="off"
                  />

                  {/* Additional Brand Contacts: Enabled for large sizes, 4in x 2in, and 2in x 2.95in */}
                  {canShowBrandContacts && (
                    <>
                      <TextField
                        label="Brand Phone"
                        value={brandPhone}
                        onChange={(val) => setBrandPhone(val)}
                        placeholder="e.g. 01700000000"
                        autoComplete="off"
                      />
                      <TextField
                        label="Brand Address"
                        value={brandAddress}
                        onChange={(val) => setBrandAddress(val)}
                        placeholder="e.g. House 12, Road 4, Dhanmondi, Dhaka"
                        autoComplete="off"
                      />
                    </>
                  )}

                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      Brand Logo
                    </Text>
                    {logoError && (
                      <div style={{ marginBottom: "8px" }}>
                        <Banner tone="critical" onDismiss={() => setLogoError("")}>
                          <p>{logoError}</p>
                        </Banner>
                      </div>
                    )}
                    {brandLogo ? (
                      <div
                        style={{
                          overflow: "hidden",
                          borderRadius: "8px",
                          border: "1px solid var(--p-color-border, #E2E8F0)",
                          padding: "12px",
                          backgroundColor: "var(--p-color-bg-surface-secondary, #F8FAFC)",
                        }}
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", overflow: "hidden" }}>
                            <div
                              style={{
                                width: "auto",
                                maxWidth: "180px",
                                maxHeight: "64px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                                backgroundColor: "#ffffff",
                                border: "1px solid #f1f5f9",
                                borderRadius: "6px",
                                padding: "4px",
                              }}
                            >
                              <img
                                src={brandLogo}
                                alt={brandName || "Brand Logo"}
                                style={{
                                  maxHeight: "64px",
                                  maxWidth: "180px",
                                  width: "auto",
                                  height: "auto",
                                  objectFit: "contain",
                                  display: "block",
                                  margin: "0 auto",
                                }}
                              />
                            </div>
                            <Text as="span" variant="bodySm">
                              Custom Logo Uploaded
                            </Text>
                          </div>
                          <Button variant="plain" tone="critical" onClick={handleRemoveLogo}>
                            Remove Logo
                          </Button>
                        </InlineStack>
                      </div>
                    ) : (
                      <div style={{ overflow: "hidden", borderRadius: "8px" }}>
                        <DropZone
                          allowMultiple={false}
                          accept="image/*"
                          type="image"
                          onDrop={handleLogoUpload}
                          variableHeight
                        >
                          <DropZone.FileUpload actionHint="Accepts .png, .jpg, .svg up to 500KB" />
                        </DropZone>
                      </div>
                    )}
                  </BlockStack>

                  <Divider />

                  <InlineStack align="space-between" blockAlign="center">
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={handleResetShippingLabel}
                    >
                      Reset
                    </Button>
                    <Button
                      variant="primary"
                      loading={isSubmittingShippingLabel}
                      onClick={handleSaveShippingLabelSettings}
                    >
                      Save Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </div>

            {/* RIGHT PANEL: PREVIEW LIVE REACT ENGINE */}
            <Card padding="500">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd" fontWeight="bold">
                    {`Preview (${labelSize})`}
                  </Text>
                  {labelStyle && (
                    <Badge
                      tone={
                        labelStyle === "smart_warehouse"
                          ? "magic"
                          : labelStyle === "brand_centric"
                          ? "attention"
                          : "info"
                      }
                    >
                      {labelStyle === "smart_warehouse"
                        ? "Premium"
                        : labelStyle === "brand_centric"
                        ? "Modern"
                        : "Standard"}
                    </Badge>
                  )}
                </InlineStack>

                <Divider />

                {/* EMPTY / BLANK STATE HANDLING */}
                {!brandName.trim() && !brandLogo ? (
                  <div
                    style={{
                      border: "1px dashed var(--p-color-border, #CBD5E1)",
                      borderRadius: "12px",
                      padding: "48px 20px",
                      textAlign: "center",
                      backgroundColor: "var(--p-color-bg-surface-secondary, #F8FAFC)",
                    }}
                  >
                    <Text as="p" variant="bodyMd" tone="subdued">
                      ⚠️ Brand name or logo is required
                    </Text>
                  </div>
                ) : (
                  /* ACTIVE LIVE LABEL GENERATION */
                  <div
                    className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    style={{
                      backgroundColor: "var(--p-color-bg-surface-secondary, #F1F5F9)",
                      border: "1px solid var(--p-color-border, transparent)",
                      padding: "24px 16px",
                      borderRadius: "12px",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      minHeight: "360px",
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: "#FFFFFF",
                        color: "#000000",
                        border: "2px solid #000000",
                        borderRadius: "4px",
                        padding: getLabelDimensions(labelSize).padding,
                        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.12)",
                        fontFamily: "'Courier New', Courier, monospace, sans-serif",
                        maxWidth: getLabelDimensions(labelSize).maxWidth,
                        minHeight: getLabelDimensions(labelSize).minHeight,
                        aspectRatio: getLabelDimensions(labelSize).aspectRatio,
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: isUltraSmall ? "2px" : isWideHorizontal ? "3px" : isSquare3x3 ? "3px" : isCompactLabel ? "6px" : "8px",
                        transition: "all 0.2s ease-in-out",
                        boxSizing: "border-box",
                        overflow: "hidden",
                      }}
                    >
                      {/* TOP HEADER SECTION */}
                      {isUltraSmall ? (
                        /* ULTRA-SMALL (1.5x1, 2x1, 2x1.15, 2.2x1.4): Single compact horizontal top row */
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", width: "100%", overflow: "hidden" }}>
                          {brandLogo && (
                            <img
                              src={brandLogo}
                              alt={brandName}
                              style={{ maxHeight: "13px", maxWidth: "45px", objectFit: "contain", flexShrink: 0 }}
                            />
                          )}
                          {brandName.trim() && (
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: "8.5px",
                                textTransform: "uppercase",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                lineHeight: 1.1,
                              }}
                              title={brandName}
                            >
                              {brandName}
                            </span>
                          )}
                        </div>
                      ) : isWideHorizontal ? (
                        /* 4in x 2in (Wide Strip): Brand Logo/Name on LEFT, Brand Phone/Address or Social on RIGHT */
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: "6px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0, maxWidth: "55%" }}>
                            {brandLogo && (
                              <img
                                src={brandLogo}
                                alt={brandName}
                                style={{ maxHeight: "18px", maxWidth: "60px", objectFit: "contain", flexShrink: 0 }}
                              />
                            )}
                            {brandName.trim() && (
                              <div
                                style={{
                                  fontWeight: 800,
                                  fontSize: "11px",
                                  textTransform: "uppercase",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  lineHeight: 1.15,
                                }}
                                title={brandName}
                              >
                                {brandName}
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              textAlign: "right",
                              fontSize: "8px",
                              color: "#333333",
                              lineHeight: 1.15,
                              minWidth: 0,
                              maxWidth: "50%",
                              overflow: "hidden",
                            }}
                          >
                            {labelStyle === "brand_centric" && socialHandle.trim() ? (
                              <div
                                style={{
                                  color: "#1d4ed8",
                                  fontWeight: 700,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                📱 {socialHandle.startsWith("@") ? socialHandle : `@${socialHandle}`}
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "flex-end",
                                  gap: "1px",
                                }}
                              >
                                {brandPhone.trim() && (
                                  <div
                                    style={{
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      maxWidth: "100%",
                                    }}
                                  >
                                    📞 {brandPhone}
                                  </div>
                                )}
                                {brandAddress.trim() && (
                                  <div
                                    style={{
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      maxWidth: "100%",
                                    }}
                                    title={brandAddress}
                                  >
                                    📍 {brandAddress}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* Standard Top Header (4x6, 3x4, 3x3, 3x2, 2x1.5, 2x2.95) */
                        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
                          {brandLogo && (
                            <img
                              src={brandLogo}
                              alt={brandName}
                              style={{
                                maxHeight: isSquare3x3 ? "20px" : isMedium3x4 ? "26px" : isCompactLabel ? "22px" : "36px",
                                maxWidth: "160px",
                                objectFit: "contain",
                                marginBottom: isSquare3x3 ? "2px" : isCompactLabel ? "2px" : "4px",
                              }}
                            />
                          )}
                          {brandName.trim() && (
                            <div
                              style={{
                                fontWeight: 800,
                                fontSize: isSquare3x3 ? "11px" : isCompactLabel ? "11px" : "15px",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                lineHeight: 1.15,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                maxWidth: "100%",
                                maxHeight: isCompactLabel ? "16px" : "22px",
                              }}
                              title={brandName}
                            >
                              {brandName}
                            </div>
                          )}
                          {canShowBrandContacts && labelStyle === "brand_centric" && socialHandle.trim() && (
                            <div
                              style={{
                                fontSize: isTallNarrow ? "8.5px" : "9.5px",
                                fontWeight: 700,
                                color: "#1d4ed8",
                                marginTop: "2px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "3px",
                              }}
                            >
                              <span>📱 {socialHandle.startsWith("@") ? socialHandle : `@${socialHandle}`}</span>
                            </div>
                          )}
                          {canShowBrandContacts && (brandPhone.trim() || brandAddress.trim()) && (
                            <div
                              style={{
                                fontSize: isTallNarrow ? "8px" : "9px",
                                color: "#333333",
                                marginTop: "2px",
                                lineHeight: 1.2,
                              }}
                            >
                              {brandPhone.trim() && <div>📞 {brandPhone}</div>}
                              {brandAddress.trim() && <div>📍 {brandAddress}</div>}
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ borderBottom: "1.5px dashed #000000", width: "100%" }} />

                      {/* MIDDLE DEMO DATA SECTION (Order No, Customer, Phone, COD) */}
                      {isUltraSmall ? (
                        /* Ultra-compact Demo Data for 1.5x1, 2x1, 2x1.15, 2.2x1.4 */
                        <div
                          style={{
                            fontSize: "8px",
                            lineHeight: 1.15,
                            display: "flex",
                            flexDirection: "column",
                            gap: "1px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>Order:</span>
                            <span style={{ fontWeight: 800 }}>#DD0001</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>To:</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "65%" }}>নাফিস / Nahid</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>Phone:</span>
                            <span>01334455667</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              borderTop: "1px dashed #000000",
                              paddingTop: "1px",
                              marginTop: "1px",
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>COD:</span>
                            <span style={{ fontWeight: 800 }}>৳1,250</span>
                          </div>
                        </div>
                      ) : isWideHorizontal ? (
                        /* 4in x 2in Grid Layout to save vertical space and prevent overflow */
                        <div
                          style={{
                            fontSize: "8.5px",
                            lineHeight: 1.2,
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            columnGap: "10px",
                            rowGap: "1px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>Order No:</span>
                            <span style={{ fontWeight: 800 }}>#DD0001</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>Phone:</span>
                            <span>01334455667</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>Name:</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>নাফিস / Nahid</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              borderTop: "1px dashed #000000",
                              paddingTop: "1px",
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>Total COD:</span>
                            <span style={{ fontWeight: 800 }}>৳1,250</span>
                          </div>
                        </div>
                      ) : (
                        /* Standard Stacked Demo Data (4x6, 3x4, 3x3, 3x2, 2x1.5, 2x2.95) */
                        <div
                          style={{
                            fontSize: isSquare3x3 ? "9.5px" : isCompactLabel ? "10px" : "11.5px",
                            lineHeight: isSquare3x3 ? 1.2 : isCompactLabel ? 1.3 : 1.4,
                            display: "flex",
                            flexDirection: "column",
                            gap: isSquare3x3 ? "1px" : isCompactLabel ? "1px" : "2px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>Order No:</span>
                            <span style={{ fontWeight: 800 }}>#DD0001</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>Name:</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>নাফিস / Nahid</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700 }}>Phone:</span>
                            <span>01334455667</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              borderTop: "1px dashed #000000",
                              paddingTop: "2px",
                              marginTop: "1px",
                            }}
                          >
                            <span style={{ fontWeight: 700, textTransform: "uppercase" }}>Total COD:</span>
                            <span style={{ fontWeight: 800 }}>৳1,250</span>
                          </div>
                        </div>
                      )}

                      <div style={{ borderBottom: "1.5px dashed #000000", width: "100%" }} />

                      {/* BOTTOM BARCODE GRAPHIC SECTION */}
                      <div
                        style={{
                          textAlign: "center",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto",
                          width: "100%",
                          gap: "1px",
                        }}
                      >
                        <DynamicBarcodeGraphic
                          code="TRK-984210"
                          width={barcodeDims.width}
                          maxWidth={barcodeDims.maxWidth}
                          height={barcodeDims.height}
                          showText={true}
                          fontSize={
                            isUltraSmall
                              ? "7.5px"
                              : isWideHorizontal
                              ? "8px"
                              : isSquare3x3
                              ? "8px"
                              : isMedium3x4
                              ? "9px"
                              : isCompactLabel
                              ? "8.5px"
                              : "11px"
                          }
                        />
                      </div>

                      {/* DYNAMIC TEMPLATE-SPECIFIC FOOTER / EXTRA SECTION (Rendered for Full Slips + 2in x 2.95in) */}
                      {(isFullSlip || isTallNarrow) && (
                        <>
                          {labelStyle === "standard" && (
                            <div
                              style={{
                                borderTop: "1.5px dashed #000000",
                                paddingTop: "4px",
                                marginTop: "1px",
                                fontSize: isSquare3x3 || isTallNarrow ? "8.5px" : "10px",
                                color: "#374151",
                                lineHeight: 1.25,
                              }}
                            >
                              <strong>Note:</strong> Please handle with care • Fragile (Standard Fallback)
                            </div>
                          )}

                          {labelStyle === "brand_centric" && (
                            <div
                              style={{
                                borderTop: "1.5px dashed #000000",
                                paddingTop: "4px",
                                marginTop: "1px",
                                textAlign: "center",
                                display: "flex",
                                flexDirection: "column",
                                gap: "2px",
                              }}
                            >
                              <div
                                style={{
                                  backgroundColor: "#111827",
                                  color: "#ffffff",
                                  padding: isSquare3x3 || isTallNarrow ? "3px 6px" : "4px 8px",
                                  borderRadius: "3px",
                                  fontWeight: 800,
                                  fontSize: isSquare3x3 || isTallNarrow ? "8.5px" : "10px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.5px",
                                }}
                              >
                                Thank you for shopping with us!
                              </div>
                            </div>
                          )}

                          {labelStyle === "smart_warehouse" && (
                            <div
                              style={{
                                borderTop: "1.5px solid #000000",
                                paddingTop: isSquare3x3 ? "3px" : "4px",
                                marginTop: "1px",
                                display: "flex",
                                flexDirection: "column",
                                gap: isSquare3x3 ? "2px" : "3px",
                              }}
                            >
                              {/* Fallback Custom Warehouse Warning / Note Banner */}
                              {(() => {
                                const theme = getWarningBannerTheme(warningBannerColor, warehouseWarning);
                                return (
                                  <div
                                    style={{
                                      border: `1px solid ${theme.border}`,
                                      backgroundColor: theme.bg,
                                      color: theme.text,
                                      padding: isSquare3x3 || isTallNarrow ? "2px 4px" : "3px 6px",
                                      borderRadius: "3px",
                                      fontSize: isSquare3x3 || isTallNarrow ? "8px" : "9px",
                                      fontWeight: 800,
                                      textAlign: "center",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.5px",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {theme.icon}{warehouseWarning || "FRAGILE / HANDLE WITH CARE"}
                                  </div>
                                );
                              })()}

                              {/* Clean Split-Line & Line Items for Full Slips (4x6, 3x4, 3x3) */}
                              {isFullSlip && (
                                <>
                                  <div
                                    style={{
                                      borderTop: "1px dashed #000000",
                                      paddingTop: "2px",
                                      display: "flex",
                                      justifyContent: "space-between",
                                      fontSize: isSquare3x3 ? "7.5px" : "8.5px",
                                      fontWeight: 800,
                                      textTransform: "uppercase",
                                      color: "#000000",
                                    }}
                                  >
                                    <span>FULFILLMENT SLIP</span>
                                    <span>ITEMS: 2</span>
                                  </div>

                                  {isSquare3x3 ? (
                                    /* 3in x 3in Condensed Single-Line Item Summary to prevent any bottom overflow */
                                    <div
                                      style={{
                                        fontSize: "7.5px",
                                        color: "#111827",
                                        lineHeight: 1.2,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "1px",
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                                        <span style={{ fontWeight: 700 }}>1. Dunhill Desire (L)</span>
                                        <span style={{ fontFamily: "monospace", color: "#4b5563" }}>SKU: DNH-RED-L · x1</span>
                                      </div>
                                      <div style={{ display: "flex", justifyContent: "space-between", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                                        <span style={{ fontWeight: 700 }}>2. Denim Jean (32)</span>
                                        <span style={{ fontFamily: "monospace", color: "#4b5563" }}>SKU: JNS-IND-32 · x1</span>
                                      </div>
                                    </div>
                                  ) : (
                                    /* 4in x 6in and 3in x 4in Clean Item Rows */
                                    <div
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: isMedium3x4 ? "1px" : "3px",
                                        fontSize: isMedium3x4 ? "8px" : "9px",
                                        color: "#111827",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "baseline",
                                          borderBottom: "1px dotted #cccccc",
                                          paddingBottom: isMedium3x4 ? "1px" : "2px",
                                        }}
                                      >
                                        <div style={{ maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          <div style={{ fontWeight: 700 }}>Item: Dunhill Desire Red - Variant: L</div>
                                          <div style={{ fontSize: isMedium3x4 ? "7.5px" : "8px", fontFamily: "monospace", color: "#4b5563" }}>
                                            SKU: DNH-RED-L-01 | Bin: A-04
                                          </div>
                                        </div>
                                        <span style={{ fontWeight: 800 }}>Qty: 1</span>
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "baseline",
                                        }}
                                      >
                                        <div style={{ maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          <div style={{ fontWeight: 700 }}>Item: Denim Indigo Jean - Variant: 32</div>
                                          <div style={{ fontSize: isMedium3x4 ? "7.5px" : "8px", fontFamily: "monospace", color: "#4b5563" }}>
                                            SKU: JNS-IND-32-04 | Bin: B-02
                                          </div>
                                        </div>
                                        <span style={{ fontWeight: 800 }}>Qty: 1</span>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </BlockStack>
            </Card>
          </div>
        )}

        {selectedSettingsTab === "invoice" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.15fr",
              gap: "20px",
              alignItems: "start",
            }}
          >
            {/* LEFT PANEL: TWO SEPARATE WHITE CARDS (16px GAP) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Card 1: Title "Invoice Template (A4 Size)" */}
              <Card padding="500">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingSm" fontWeight="bold">
                    Invoice Template (A4 Size)
                  </Text>
                  <ChoiceList
                    title="Invoice Template (A4 Size)"
                    titleHidden
                    choices={[
                      {
                        label: "Standard",
                        value: "classic",
                        helpText: "Free & Starter plan",
                      },
                      {
                        label: "Modern",
                        value: "modern",
                        helpText: "Growth & Pro plan",
                      },
                      {
                        label: "Premium",
                        value: "warehouse",
                        helpText: "Advanced & Enterprise plan",
                      },
                    ]}
                    selected={invoiceTemplate ? [invoiceTemplate] : []}
                    onChange={(selected) => setInvoiceTemplate(selected[0] || "")}
                  />
                </BlockStack>
              </Card>

              {/* Card 2: Title "Brand Details" */}
              <Card padding="500">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingSm" fontWeight="bold">
                    Brand Details
                  </Text>

                  {/* Brand Logo Dropzone */}
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" fontWeight="medium">
                      Brand Logo
                    </Text>
                    {logoError && (
                      <div style={{ marginBottom: "8px" }}>
                        <Banner tone="critical" onDismiss={() => setLogoError("")}>
                          <p>{logoError}</p>
                        </Banner>
                      </div>
                    )}
                    {brandLogo ? (
                      <div
                        style={{
                          overflow: "hidden",
                          borderRadius: "8px",
                          border: "1px solid #e5e7eb",
                          padding: "12px",
                          backgroundColor: "#f9fafb",
                        }}
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", overflow: "hidden" }}>
                            <div
                              style={{
                                width: "auto",
                                maxWidth: "180px",
                                maxHeight: "64px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                                backgroundColor: "#ffffff",
                                border: "1px solid #f1f5f9",
                                borderRadius: "6px",
                                padding: "4px",
                              }}
                            >
                              <img
                                src={brandLogo}
                                alt={invoiceBrandName || "Brand Logo"}
                                style={{
                                  maxHeight: "64px",
                                  maxWidth: "180px",
                                  width: "auto",
                                  height: "auto",
                                  objectFit: "contain",
                                  display: "block",
                                  margin: "0 auto",
                                }}
                              />
                            </div>
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              Custom Logo Uploaded
                            </Text>
                          </div>
                          <Button
                            size="micro"
                            tone="critical"
                            variant="plain"
                            onClick={handleRemoveLogo}
                          >
                            Remove Logo
                          </Button>
                        </InlineStack>
                      </div>
                    ) : (
                      <div style={{ overflow: "hidden", borderRadius: "8px" }}>
                        <DropZone
                          allowMultiple={false}
                          accept="image/*"
                          type="image"
                          onDrop={handleLogoUpload}
                          variableHeight
                        >
                          <DropZone.FileUpload actionHint="Accepts .png, .jpg, .svg up to 500KB" />
                        </DropZone>
                      </div>
                    )}
                  </BlockStack>

                  <TextField
                    label="Brand Name"
                    value={invoiceBrandName}
                    onChange={setInvoiceBrandName}
                    autoComplete="off"
                    placeholder="e.g., SafeParcel Store"
                    requiredIndicator
                  />

                  <TextField
                    label="Brand Phone"
                    value={invoiceBrandPhone}
                    onChange={setInvoiceBrandPhone}
                    autoComplete="tel"
                    placeholder="e.g., +880 1711-000000"
                  />

                  <TextField
                    label="Brand Address"
                    value={invoiceBrandAddress}
                    onChange={setInvoiceBrandAddress}
                    autoComplete="street-address"
                    placeholder="e.g., House 42, Road 11, Banani, Dhaka"
                    multiline={2}
                  />

                  <TextField
                    label="Brand Email"
                    value={invoiceBrandEmail}
                    onChange={setInvoiceBrandEmail}
                    autoComplete="email"
                    placeholder="e.g., support@safeparcelbd.com"
                  />

                  <TextField
                    label="Brand Website"
                    value={invoiceBrandWebsite}
                    onChange={setInvoiceBrandWebsite}
                    autoComplete="url"
                    placeholder="e.g., www.safeparcelbd.com"
                  />

                  {/* Responsive Color Picker: Visible ONLY if Modern or Warehouse is active */}
                  {(invoiceTemplate === "modern" || invoiceTemplate === "warehouse") && (
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm" fontWeight="medium">
                          Accent Brand Color
                        </Text>
                        <span
                          className="w-5 h-5 rounded-full border border-gray-300 shadow-xs inline-block"
                          style={{ backgroundColor: invoiceAccentColor }}
                        />
                      </InlineStack>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={invoiceAccentColor}
                          onChange={(e) => setInvoiceAccentColor(e.target.value)}
                          className="w-10 h-10 p-0.5 rounded cursor-pointer border border-gray-300 bg-white"
                          title="Choose accent brand color"
                        />
                        <div className="flex-1">
                          <TextField
                            label="Hex Code"
                            labelHidden
                            value={invoiceAccentColor}
                            onChange={setInvoiceAccentColor}
                            autoComplete="off"
                            placeholder="#2563eb"
                          />
                        </div>
                      </div>
                      {/* Quick Preset Swatches */}
                      <div className="flex items-center gap-2 pt-1">
                        {[
                          { name: "Royal Blue", color: "#2563eb" },
                          { name: "Indigo", color: "#4f46e5" },
                          { name: "Emerald", color: "#059669" },
                          { name: "Crimson", color: "#dc2626" },
                          { name: "Amber", color: "#d97706" },
                          { name: "Dark Slate", color: "#0f172a" },
                        ].map((preset) => (
                          <button
                            key={preset.color}
                            type="button"
                            onClick={() => setInvoiceAccentColor(preset.color)}
                            className="w-6 h-6 rounded-full border transition-transform hover:scale-110 cursor-pointer shadow-xs"
                            style={{
                              backgroundColor: preset.color,
                              outline:
                                invoiceAccentColor.toLowerCase() === preset.color.toLowerCase()
                                  ? "2px solid #2563eb"
                                  : "none",
                              outlineOffset: "2px",
                            }}
                            title={preset.name}
                          />
                        ))}
                      </div>
                    </BlockStack>
                  )}

                  <Divider />

                  {/* Primary Action Row with Separated Reset and Save Settings Buttons */}
                  <InlineStack align="space-between" blockAlign="center">
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={handleResetInvoice}
                    >
                      Reset
                    </Button>
                    <Button
                      variant="primary"
                      size="large"
                      onClick={handleSaveInvoiceSettings}
                      loading={isSubmittingInvoice}
                      disabled={!invoiceBrandName.trim()}
                    >
                      Save Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </div>

            {/* RIGHT PANEL: PREVIEW */}
            <div style={{ position: "sticky", top: "20px" }}>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd" fontWeight="bold">
                      Preview
                    </Text>
                    {invoiceTemplate && (
                      <Badge
                        tone={
                          invoiceTemplate === "warehouse"
                            ? "magic"
                            : invoiceTemplate === "modern"
                            ? "attention"
                            : "info"
                        }
                      >
                        {invoiceTemplate === "warehouse"
                          ? "Premium"
                          : invoiceTemplate === "modern"
                          ? "Modern"
                          : "Standard"}
                      </Badge>
                    )}
                  </InlineStack>

                  {/* EMPTY STATE HANDLING: If invoiceTemplate is empty or null */}
                  {!invoiceTemplate ? (
                    <div className="py-16 px-6 text-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/30 my-6">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 text-blue-600 mb-3 text-xl">
                        ℹ️
                      </div>
                      <Text as="h3" variant="headingSm" tone="subdued">
                        ℹ️ Please select an invoice template
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Select Standard, Modern, or Premium from the left panel to load the interactive A4 sheet preview.
                      </Text>
                    </div>
                  ) : (
                    /* A4 SHEET CONTAINER */
                    <div
                      style={{
                        background: "#f9fafb",
                        padding: "16px",
                        borderRadius: "8px",
                        border: "1px solid #f3f4f6",
                        overflowX: "auto",
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      <div
                        style={{
                          background: "#ffffff",
                          border: "1px solid #e5e7eb",
                          borderRadius: "6px",
                          padding: "20px 24px",
                          boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
                          width: "100%",
                          maxWidth: "680px",
                          aspectRatio: "210 / 297",
                          minHeight: "680px",
                          margin: "0 auto",
                          boxSizing: "border-box",
                          color: "#1f2937",
                          fontSize: "12px",
                          fontFamily: "system-ui, -apple-system, sans-serif",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          overflow: "hidden",
                        }}
                      >
                        {/* ==================== A. CLASSIC TIER VIEW ==================== */}
                        {invoiceTemplate === "classic" && (
                          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
                            <div>
                              {/* Top Row: Brand logo/name on top-left; large "INVOICE", Order ID: #1001, and Date on top-right */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  {brandLogo ? (
                                    <img
                                      src={brandLogo}
                                      alt={invoiceBrandName || "Brand Logo"}
                                      style={{ height: "40px", maxWidth: "150px", objectFit: "contain", marginBottom: "6px" }}
                                    />
                                  ) : (
                                    <div style={{ fontSize: "20px", fontWeight: "700", color: "#111827", marginBottom: "4px" }}>
                                      {invoiceBrandName || "SafeParcel Store"}
                                    </div>
                                  )}
                                  <div style={{ fontSize: "11px", color: "#4b5563", lineHeight: "1.5" }}>
                                    <div>{invoiceBrandAddress || "House 42, Road 11, Banani, Dhaka"}</div>
                                    <div>Phone: {invoiceBrandPhone || "+880 1711-000000"}</div>
                                    {invoiceBrandEmail && <div>Email: {invoiceBrandEmail}</div>}
                                    {invoiceBrandWebsite && <div>Web: {invoiceBrandWebsite}</div>}
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: "24px", fontWeight: "800", color: "#111827", textTransform: "uppercase", letterSpacing: "1px" }}>
                                    INVOICE
                                  </div>
                                  <div style={{ marginTop: "6px", fontSize: "11px", color: "#4b5563", lineHeight: "1.6" }}>
                                    <div>
                                      <span style={{ fontWeight: "600", color: "#1f2937" }}>Order ID:</span> #1001
                                    </div>
                                    <div>
                                      <span style={{ fontWeight: "600", color: "#1f2937" }}>Date:</span> 27th Oct, 2026
                                    </div>
                                    <div>
                                      <span style={{ fontWeight: "600", color: "#1f2937" }}>Payment:</span> COD
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Divider line */}
                              <div style={{ borderBottom: "1px solid #e5e7eb", margin: "16px 0" }} />

                              {/* Billing Row: BILL FROM on left, BILL TO on right */}
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", fontSize: "11px" }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: "700", color: "#4b5563", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.5px", marginBottom: "4px" }}>
                                    BILL FROM
                                  </div>
                                  <div style={{ fontWeight: "600", color: "#111827", fontSize: "12px" }}>
                                    {invoiceBrandName || "SafeParcel Store"}
                                  </div>
                                  <div style={{ color: "#4b5563", marginTop: "2px", lineHeight: "1.5" }}>
                                    {invoiceBrandAddress || "House 42, Road 11, Banani, Dhaka"}<br />
                                    Phone: {invoiceBrandPhone || "+880 1711-000000"}
                                  </div>
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: "700", color: "#4b5563", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.5px", marginBottom: "4px" }}>
                                    BILL TO
                                  </div>
                                  <div style={{ fontWeight: "600", color: "#111827", fontSize: "12px" }}>
                                    Nahid Rahman
                                  </div>
                                  <div style={{ color: "#4b5563", marginTop: "2px", lineHeight: "1.5" }}>
                                    Plot 14, Sector 7, Uttara, Dhaka - 1230<br />
                                    Phone: +880 1812-345678
                                  </div>
                                </div>
                              </div>

                              {/* Items Table */}
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", marginTop: "12px" }}>
                                <thead>
                                  <tr style={{ background: "#1f2937", color: "#ffffff" }}>
                                    <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: "600" }}>Item</th>
                                    <th style={{ padding: "6px 8px", textAlign: "center", fontWeight: "600", whiteSpace: "nowrap" }}>Qty</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: "600", whiteSpace: "nowrap" }}>Price</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: "600", whiteSpace: "nowrap" }}>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                                    <td style={{ padding: "6px 8px" }}>
                                      <div style={{ fontWeight: "600", color: "#111827" }}>
                                        Premium Cotton Drop-Shoulder T-Shirt - Black / L
                                      </div>
                                      <div style={{ fontSize: "10px", color: "#6b7280" }}>SKU: TSH-BLK-L-01</div>
                                    </td>
                                    <td style={{ padding: "6px 8px", textAlign: "center", color: "#111827", fontWeight: "500", whiteSpace: "nowrap" }}>2</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#4b5563", whiteSpace: "nowrap" }}>৳ 850</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "600", color: "#111827", whiteSpace: "nowrap" }}>৳ 1,700</td>
                                  </tr>
                                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                                    <td style={{ padding: "6px 8px" }}>
                                      <div style={{ fontWeight: "600", color: "#111827" }}>
                                        Slim Fit Stretch Denim Jeans - Indigo / 32
                                      </div>
                                      <div style={{ fontSize: "10px", color: "#6b7280" }}>SKU: JNS-IND-32-04</div>
                                    </td>
                                    <td style={{ padding: "6px 8px", textAlign: "center", color: "#111827", fontWeight: "500", whiteSpace: "nowrap" }}>1</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#4b5563", whiteSpace: "nowrap" }}>৳ 1,450</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "600", color: "#111827", whiteSpace: "nowrap" }}>৳ 1,450</td>
                                  </tr>
                                </tbody>
                              </table>

                              {/* Summary Box */}
                              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
                                <div style={{ width: "220px", marginLeft: "auto", fontSize: "11px" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "3px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Subtotal:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 3,150</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "3px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Discount:</span>
                                    <span style={{ color: "#059669", fontWeight: "500", whiteSpace: "nowrap" }}>- ৳ 150</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "3px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Shipping:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 60</span>
                                  </div>
                                  <div style={{ borderTop: "2px solid #111827", marginTop: "6px", paddingTop: "6px", display: "flex", justifyContent: "space-between", fontWeight: "700", fontSize: "13px", color: "#111827" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Total Payable:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 3,060</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Footer */}
                            <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #e5e7eb", textAlign: "center", fontSize: "10px", color: "#6b7280" }}>
                              <p style={{ fontWeight: "600", color: "#1f2937", marginBottom: "2px" }}>
                                Thank you for your business!
                              </p>
                              <p>
                                For exchange or delivery inquiries, please contact {invoiceBrandPhone || "+880 1711-000000"}.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* ==================== B. MODERN (PRO) TIER VIEW ==================== */}
                        {invoiceTemplate === "modern" && (
                          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
                            <div>
                              {/* Top Accent bar */}
                              <div
                                style={{
                                  height: "4px",
                                  backgroundColor: invoiceAccentColor,
                                  borderRadius: "2px",
                                  marginBottom: "16px",
                                  transition: "background-color 0.2s ease",
                                }}
                              />
                              {/* Top Header */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: "16px" }}>
                                <div>
                                  <div
                                    style={{
                                      fontSize: "24px",
                                      fontWeight: "900",
                                      letterSpacing: "-0.5px",
                                      color: invoiceAccentColor,
                                    }}
                                  >
                                    INVOICE
                                  </div>
                                  <div style={{ marginTop: "6px", fontSize: "11px", color: "#4b5563", lineHeight: "1.5" }}>
                                    <div>
                                      <span style={{ fontWeight: "600", color: "#1f2937" }}>Order ID:</span> #1001
                                    </div>
                                    <div>
                                      <span style={{ fontWeight: "600", color: "#1f2937" }}>Date:</span> 27th Oct, 2026
                                    </div>
                                    <div style={{ marginTop: "4px" }}>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          padding: "2px 8px",
                                          borderRadius: "4px",
                                          fontSize: "10px",
                                          fontWeight: "700",
                                          color: "#ffffff",
                                          textTransform: "uppercase",
                                          backgroundColor: invoiceAccentColor,
                                        }}
                                      >
                                        COD · Due on Delivery
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div style={{ textAlign: "right" }}>
                                  {brandLogo ? (
                                    <img
                                      src={brandLogo}
                                      alt={invoiceBrandName || "Brand Logo"}
                                      style={{ height: "40px", maxWidth: "150px", objectFit: "contain", marginLeft: "auto", marginBottom: "6px" }}
                                    />
                                  ) : (
                                    <div style={{ fontSize: "20px", fontWeight: "700", color: "#111827", marginBottom: "4px" }}>
                                      {invoiceBrandName || "SafeParcel Store"}
                                    </div>
                                  )}
                                  <div style={{ fontSize: "11px", color: "#4b5563", lineHeight: "1.5" }}>
                                    <div>{invoiceBrandAddress || "House 42, Road 11, Banani, Dhaka"}</div>
                                    <div>Phone: {invoiceBrandPhone || "+880 1711-000000"}</div>
                                    {invoiceBrandEmail && <div>Email: {invoiceBrandEmail}</div>}
                                    {invoiceBrandWebsite && (
                                      <div style={{ fontWeight: "600", color: invoiceAccentColor }}>
                                        {invoiceBrandWebsite}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Middle Dual-Box */}
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", padding: "12px 0", fontSize: "11px" }}>
                                <div style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#f9fafb" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: "700", textTransform: "uppercase", fontSize: "10px", color: "#4b5563", marginBottom: "4px" }}>
                                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", display: "inline-block", backgroundColor: invoiceAccentColor }} />
                                    BILL FROM
                                  </div>
                                  <div style={{ fontWeight: "700", color: "#111827", fontSize: "12px" }}>
                                    {invoiceBrandName || "SafeParcel Store"}
                                  </div>
                                  <div style={{ color: "#4b5563", marginTop: "2px", lineHeight: "1.4" }}>
                                    <div>{invoiceBrandAddress || "House 42, Road 11, Banani, Dhaka"}</div>
                                    <div>Tel: {invoiceBrandPhone || "+880 1711-000000"}</div>
                                  </div>
                                </div>

                                <div style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#f9fafb" }}>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: "700", textTransform: "uppercase", fontSize: "10px", color: "#4b5563", marginBottom: "4px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", display: "inline-block", background: "#10b981" }} />
                                      BILL TO
                                    </div>
                                    <span style={{ fontSize: "9px", fontWeight: "600", color: "#047857", background: "#d1fae5", padding: "1px 6px", borderRadius: "4px" }}>
                                      Verified Buyer
                                    </span>
                                  </div>
                                  <div style={{ fontWeight: "700", color: "#111827", fontSize: "12px" }}>
                                    Nahid Rahman
                                  </div>
                                  <div style={{ color: "#4b5563", marginTop: "2px", lineHeight: "1.4" }}>
                                    <div>Plot 14, Sector 7, Uttara, Dhaka - 1230</div>
                                    <div>Phone: +880 1812-345678</div>
                                  </div>
                                </div>
                              </div>

                              {/* Modern Order Table */}
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", marginTop: "10px" }}>
                                <thead>
                                  <tr style={{ borderBottom: "2px solid #e5e7eb", color: "#4b5563", fontWeight: "700", textTransform: "uppercase", fontSize: "10px" }}>
                                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Product Description</th>
                                    <th style={{ padding: "6px 8px", textAlign: "center", whiteSpace: "nowrap" }}>Qty</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>Price</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                                    <td style={{ padding: "6px 8px" }}>
                                      <div style={{ fontWeight: "600", color: "#111827" }}>Premium Cotton Drop-Shoulder T-Shirt</div>
                                      <div style={{ fontSize: "10px", color: "#6b7280" }}>Black / L · SKU: TSH-BLK-L-01</div>
                                    </td>
                                    <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: "600", color: "#111827", whiteSpace: "nowrap" }}>2</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#4b5563", whiteSpace: "nowrap" }}>৳ 850</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "700", color: "#111827", whiteSpace: "nowrap" }}>৳ 1,700</td>
                                  </tr>
                                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                                    <td style={{ padding: "6px 8px" }}>
                                      <div style={{ fontWeight: "600", color: "#111827" }}>Slim Fit Stretch Denim Jeans</div>
                                      <div style={{ fontSize: "10px", color: "#6b7280" }}>Indigo / 32 · SKU: JNS-IND-32-04</div>
                                    </td>
                                    <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: "600", color: "#111827", whiteSpace: "nowrap" }}>1</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#4b5563", whiteSpace: "nowrap" }}>৳ 1,450</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "700", color: "#111827", whiteSpace: "nowrap" }}>৳ 1,450</td>
                                  </tr>
                                </tbody>
                              </table>

                              {/* Modern Financial Summary */}
                              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                                <div style={{ width: "220px", background: "#f9fafb", padding: "12px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "11px" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "3px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Subtotal:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 3,150</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "3px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Discount:</span>
                                    <span style={{ color: "#059669", fontWeight: "500", whiteSpace: "nowrap" }}>- ৳ 150</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "3px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Shipping:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 60</span>
                                  </div>
                                  <div
                                    style={{
                                      paddingTop: "6px",
                                      marginTop: "6px",
                                      borderTop: "1px solid #e5e7eb",
                                      display: "flex",
                                      justifyContent: "space-between",
                                      fontWeight: "800",
                                      fontSize: "13px",
                                      color: invoiceAccentColor,
                                    }}
                                  >
                                    <span style={{ whiteSpace: "nowrap" }}>Total Payable:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 3,060</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Modern Footer */}
                            <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10px", color: "#6b7280" }}>
                              <div>
                                <span style={{ fontWeight: "700", color: "#374151" }}>{invoiceBrandName || "SafeParcel Store"}</span>
                                {" · Official Store Invoice"}
                              </div>
                              <div style={{ fontWeight: "600", color: invoiceAccentColor }}>
                                Verified E-Commerce Invoice
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ==================== C. WAREHOUSE FULFILLMENT (ENTERPRISE / NEW) TIER VIEW ==================== */}
                        {invoiceTemplate === "warehouse" && (
                          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
                            <div>
                              {/* Warehouse Dual-Identity Banner Header: INVOICE / PACKING SLIP */}
                              <div style={{ border: `2px solid ${invoiceAccentColor || "#2563eb"}`, padding: "8px 12px", borderRadius: "4px", background: "#f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                <div>
                                  <div style={{ fontSize: "14px", fontWeight: "900", letterSpacing: "1px", color: invoiceAccentColor || "#2563eb", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                                    INVOICE / PACKING SLIP
                                  </div>
                                  <div style={{ fontSize: "10px", fontWeight: "600", color: "#4b5563", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
                                    ENTERPRISE WAREHOUSE DISPATCH · HUB: DAC-NORTH
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: "13px", fontWeight: "800", color: "#111827", whiteSpace: "nowrap" }}>
                                    ORDER #1001
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#6b7280", whiteSpace: "nowrap" }}>
                                    27th Oct, 2026 · 14:32:00
                                  </div>
                                </div>
                              </div>

                              {/* Brand & Warehouse Info Row */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: "12px", borderBottom: "1px solid #d1d5db", fontSize: "11px" }}>
                                <div>
                                  {brandLogo ? (
                                    <img
                                      src={brandLogo}
                                      alt={invoiceBrandName || "Brand Logo"}
                                      style={{ height: "36px", maxWidth: "140px", objectFit: "contain", marginBottom: "4px" }}
                                    />
                                  ) : (
                                    <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827", marginBottom: "2px" }}>
                                      {invoiceBrandName || "SafeParcel Store"}
                                    </div>
                                  )}
                                  <div style={{ color: "#4b5563", fontSize: "10px", lineHeight: "1.4" }}>
                                    <div>{invoiceBrandAddress || "House 42, Road 11, Banani, Dhaka"}</div>
                                    <div>Dispatch Hotline: {invoiceBrandPhone || "+880 1711-000000"}</div>
                                  </div>
                                </div>
                                <div style={{ textAlign: "right", fontSize: "10px", color: "#4b5563", lineHeight: "1.4" }}>
                                  <div><span style={{ fontWeight: "700", color: "#1f2937" }}>Fulfillment:</span> Auto-Routing</div>
                                  <div><span style={{ fontWeight: "700", color: "#1f2937" }}>Courier Partner:</span> Steadfast Express</div>
                                  <div><span style={{ fontWeight: "700", color: "#1f2937" }}>Tracking Ref:</span> SF-84920412-BD</div>
                                </div>
                              </div>

                              {/* Consignee Recipient Block */}
                              <div style={{ margin: "14px 0", padding: "10px", background: "#f3f4f6", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "11px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                <div>
                                  <div style={{ fontSize: "10px", fontWeight: "700", color: "#374151", textTransform: "uppercase" }}>
                                    Ship To (Consignee)
                                  </div>
                                  <div style={{ fontWeight: "700", color: "#111827", fontSize: "12px", marginTop: "2px" }}>
                                    Nahid Rahman
                                  </div>
                                  <div style={{ color: "#374151", fontSize: "10px", marginTop: "2px", lineHeight: "1.4" }}>
                                    Plot 14, Sector 7, Uttara, Dhaka - 1230<br />
                                    Phone: +880 1812-345678
                                  </div>
                                </div>
                                <div style={{ borderLeft: "1px solid #d1d5db", paddingLeft: "12px" }}>
                                  <div style={{ fontSize: "10px", fontWeight: "700", color: "#374151", textTransform: "uppercase" }}>
                                    Payment Instructions
                                  </div>
                                  <div style={{ fontSize: "12px", fontWeight: "700", color: invoiceAccentColor || "#2563eb", marginTop: "2px" }}>
                                    COLLECT CASH: ৳ 3,060
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#4b5563", marginTop: "2px" }}>
                                    Weight: 0.85 kg | Fragile/Apparel
                                  </div>
                                </div>
                              </div>

                              {/* Order Table with Barcode Metadata */}
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", marginTop: "10px" }}>
                                <thead>
                                  <tr style={{ backgroundColor: invoiceAccentColor || "#2563eb", color: "#ffffff", fontWeight: "700", fontSize: "10px", textTransform: "uppercase" }}>
                                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Item Details & Barcode</th>
                                    <th style={{ padding: "6px 6px", textAlign: "center", whiteSpace: "nowrap" }}>Bin</th>
                                    <th style={{ padding: "6px 6px", textAlign: "center", whiteSpace: "nowrap" }}>Pick</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>Price</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                                    <td style={{ padding: "6px 8px" }}>
                                      <div style={{ fontWeight: "600", color: "#111827" }}>
                                        Premium Cotton Drop-Shoulder T-Shirt - Black / L
                                      </div>
                                      <div style={{ marginTop: "3px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "nowrap" }}>
                                        <span style={{ fontFamily: "monospace", fontSize: "9px", background: "#f3f4f6", padding: "1px 5px", borderRadius: "3px", border: "1px solid #e5e7eb", color: "#374151", fontWeight: "700", whiteSpace: "nowrap" }}>
                                          SKU: TSH-BLK-L-01
                                        </span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "1px", height: "13px", padding: "0 4px", background: "#ffffff", border: "1px solid #e5e7eb", flexShrink: 0 }}>
                                          {[2,1,3,1,2,1,1,3,2,1,2,3,1,1,2,1,3,2,1,2].map((w, i) => (
                                            <span
                                              key={i}
                                              style={{ background: "#000000", display: "inline-block", height: "100%", width: `${w}px` }}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                    <td style={{ padding: "6px 6px", textAlign: "center", fontFamily: "monospace", fontSize: "10px", color: "#374151", whiteSpace: "nowrap" }}>
                                      A-04-12
                                    </td>
                                    <td style={{ padding: "6px 6px", textAlign: "center", fontWeight: "700", color: "#111827", whiteSpace: "nowrap" }}>
                                      2
                                    </td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#374151", whiteSpace: "nowrap" }}>৳ 850</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "700", color: "#111827", whiteSpace: "nowrap" }}>৳ 1,700</td>
                                  </tr>
                                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                                    <td style={{ padding: "6px 8px" }}>
                                      <div style={{ fontWeight: "600", color: "#111827" }}>
                                        Slim Fit Stretch Denim Jeans - Indigo / 32
                                      </div>
                                      <div style={{ marginTop: "3px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "nowrap" }}>
                                        <span style={{ fontFamily: "monospace", fontSize: "9px", background: "#f3f4f6", padding: "1px 5px", borderRadius: "3px", border: "1px solid #e5e7eb", color: "#374151", fontWeight: "700", whiteSpace: "nowrap" }}>
                                          SKU: JNS-IND-32-04
                                        </span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "1px", height: "13px", padding: "0 4px", background: "#ffffff", border: "1px solid #e5e7eb", flexShrink: 0 }}>
                                          {[1,3,1,2,1,3,2,1,1,2,3,1,2,1,1,3,1,2,2,1].map((w, i) => (
                                            <span
                                              key={i}
                                              style={{ background: "#000000", display: "inline-block", height: "100%", width: `${w}px` }}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                    <td style={{ padding: "6px 6px", textAlign: "center", fontFamily: "monospace", fontSize: "10px", color: "#374151", whiteSpace: "nowrap" }}>
                                      B-02-08
                                    </td>
                                    <td style={{ padding: "6px 6px", textAlign: "center", fontWeight: "700", color: "#111827", whiteSpace: "nowrap" }}>
                                      1
                                    </td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#374151", whiteSpace: "nowrap" }}>৳ 1,450</td>
                                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "700", color: "#111827", whiteSpace: "nowrap" }}>৳ 1,450</td>
                                  </tr>
                                </tbody>
                              </table>

                              {/* Warehouse Totals */}
                              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                                <div style={{ width: "220px", fontSize: "11px" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "2px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Items Subtotal:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 3,150</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "2px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Discount:</span>
                                    <span style={{ color: "#059669", fontWeight: "500", whiteSpace: "nowrap" }}>- ৳ 150</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", padding: "2px 0" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Shipping Fee:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 60</span>
                                  </div>
                                  <div style={{ borderTop: `2px solid ${invoiceAccentColor || "#2563eb"}`, paddingTop: "4px", marginTop: "4px", display: "flex", justifyContent: "space-between", fontWeight: "900", fontSize: "13px", color: invoiceAccentColor || "#2563eb" }}>
                                    <span style={{ whiteSpace: "nowrap" }}>Total COD to Collect:</span>
                                    <span style={{ whiteSpace: "nowrap" }}>৳ 3,060</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Order Status QR Code Vector Box */}
                            <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "2px dashed #d1d5db" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #e5e7eb" }}>
                                <div style={{ padding: "4px", background: "#ffffff", borderRadius: "4px", border: "1px solid #d1d5db", flexShrink: 0 }}>
                                  <svg
                                    style={{ width: "44px", height: "44px" }}
                                    viewBox="0 0 100 100"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <rect x="5" y="5" width="26" height="26" fill="black" />
                                    <rect x="9" y="9" width="18" height="18" fill="white" />
                                    <rect x="13" y="13" width="10" height="10" fill="black" />
                                    <rect x="69" y="5" width="26" height="26" fill="black" />
                                    <rect x="73" y="9" width="18" height="18" fill="white" />
                                    <rect x="77" y="13" width="10" height="10" fill="black" />
                                    <rect x="5" y="69" width="26" height="26" fill="black" />
                                    <rect x="9" y="73" width="18" height="18" fill="white" />
                                    <rect x="13" y="77" width="10" height="10" fill="black" />
                                    <rect x="36" y="8" width="8" height="8" fill="black" />
                                    <rect x="48" y="14" width="8" height="8" fill="black" />
                                    <rect x="36" y="24" width="6" height="6" fill="black" />
                                    <rect x="48" y="32" width="8" height="8" fill="black" />
                                    <rect x="12" y="38" width="6" height="6" fill="black" />
                                    <rect x="24" y="44" width="8" height="8" fill="black" />
                                    <rect x="38" y="44" width="8" height="8" fill="black" />
                                    <rect x="52" y="48" width="6" height="6" fill="black" />
                                    <rect x="66" y="38" width="8" height="8" fill="black" />
                                    <rect x="78" y="44" width="8" height="8" fill="black" />
                                    <rect x="38" y="60" width="8" height="8" fill="black" />
                                    <rect x="50" y="66" width="8" height="8" fill="black" />
                                    <rect x="66" y="60" width="6" height="6" fill="black" />
                                    <rect x="78" y="68" width="8" height="8" fill="black" />
                                    <rect x="40" y="78" width="8" height="8" fill="black" />
                                    <rect x="56" y="84" width="8" height="8" fill="black" />
                                    <rect x="70" y="82" width="6" height="6" fill="black" />
                                    <rect x="84" y="82" width="6" height="6" fill="black" />
                                  </svg>
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                                    <span style={{ fontWeight: "700", fontSize: "11px", color: invoiceAccentColor || "#2563eb", textTransform: "uppercase" }}>
                                      Order Status QR Code
                                    </span>
                                    <span style={{ fontSize: "9px", background: `${invoiceAccentColor || "#2563eb"}15`, color: invoiceAccentColor || "#2563eb", border: `1px solid ${invoiceAccentColor || "#2563eb"}33`, fontWeight: "700", padding: "1px 6px", borderRadius: "3px" }}>
                                      Enterprise
                                    </span>
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#6b7280", lineHeight: "1.4" }}>
                                    Scan with your camera to track live parcel delivery updates instantly via SafeParcel BD.
                                  </div>
                                  <div style={{ fontFamily: "monospace", fontSize: "9px", color: "#9ca3af", marginTop: "2px" }}>
                                    AUTH-HASH: 9a8f2c31e4b7 · PARCEL: #1001-SF
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </BlockStack>
              </Card>
            </div>
          </div>
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
