import { useState, useEffect, type SVGProps } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
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
  Collapsible,
  Divider,
  Banner,
  Grid,
  Box,
  IndexTable,
  Select,
  Tabs,
  Icon,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import CourierConfig, {
  connectDB,
  ShippingZone,
  ZoneDistricts,
} from "../db.server";

export interface DistrictItem {
  id: string;
  name: string;
}

export interface DivisionGroup {
  divisionId: string;
  divisionName: string;
  bengaliName: string;
  districts: DistrictItem[];
}

export interface WeightTierInput {
  maxWeight: number;
  extraRate: number;
}

export interface HydratedShippingZone {
  id: string;
  merchantId: string;
  zoneName: string;
  baseRate: number;
  codSurchargeEnabled: boolean;
  codSurchargePercentage: number;
  weightTiers: WeightTierInput[];
  districtIds: string[];
}

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

/**
 * 1. Complete Fixed Dataset of the 8 Divisions & 64 Districts of Bangladesh (for Shipping Zones)
 */
export const BANGLADESH_DIVISIONS: DivisionGroup[] = [
  {
    divisionId: "dhaka",
    divisionName: "Dhaka Division",
    bengaliName: "ঢাকা বিভাগ (13 Districts)",
    districts: [
      { id: "dhaka", name: "Dhaka" },
      { id: "gazipur", name: "Gazipur" },
      { id: "narayanganj", name: "Narayanganj" },
      { id: "tangail", name: "Tangail" },
      { id: "manikganj", name: "Manikganj" },
      { id: "munshiganj", name: "Munshiganj" },
      { id: "narsingdi", name: "Narsingdi" },
      { id: "kishoreganj", name: "Kishoreganj" },
      { id: "faridpur", name: "Faridpur" },
      { id: "gopalganj", name: "Gopalganj" },
      { id: "madaripur", name: "Madaripur" },
      { id: "rajbari", name: "Rajbari" },
      { id: "shariatpur", name: "Shariatpur" },
    ],
  },
  {
    divisionId: "chattogram",
    divisionName: "Chattogram Division",
    bengaliName: "চট্টগ্রাম বিভাগ (11 Districts)",
    districts: [
      { id: "chattogram", name: "Chattogram" },
      { id: "coxs_bazar", name: "Cox's Bazar" },
      { id: "cumilla", name: "Cumilla" },
      { id: "brahmanbaria", name: "Brahmanbaria" },
      { id: "chandpur", name: "Chandpur" },
      { id: "noakhali", name: "Noakhali" },
      { id: "feni", name: "Feni" },
      { id: "lakshmipur", name: "Lakshmipur" },
      { id: "rangamati", name: "Rangamati" },
      { id: "khagrachhari", name: "Khagrachhari" },
      { id: "bandarban", name: "Bandarban" },
    ],
  },
  {
    divisionId: "rajshahi",
    divisionName: "Rajshahi Division",
    bengaliName: "রাজশাহী বিভাগ (8 Districts)",
    districts: [
      { id: "rajshahi", name: "Rajshahi" },
      { id: "bogura", name: "Bogura" },
      { id: "pabna", name: "Pabna" },
      { id: "sirajganj", name: "Sirajganj" },
      { id: "natore", name: "Natore" },
      { id: "naogaon", name: "Naogaon" },
      { id: "chapainawabganj", name: "Chapainawabganj" },
      { id: "joypurhat", name: "Joypurhat" },
    ],
  },
  {
    divisionId: "khulna",
    divisionName: "Khulna Division",
    bengaliName: "খুলনা বিভাগ (10 Districts)",
    districts: [
      { id: "khulna", name: "Khulna" },
      { id: "jashore", name: "Jashore" },
      { id: "kushtia", name: "Kushtia" },
      { id: "satkhira", name: "Satkhira" },
      { id: "bagerhat", name: "Bagerhat" },
      { id: "jhenaidah", name: "Jhenaidah" },
      { id: "magura", name: "Magura" },
      { id: "narail", name: "Narail" },
      { id: "chuadanga", name: "Chuadanga" },
      { id: "meherpur", name: "Meherpur" },
    ],
  },
  {
    divisionId: "barishal",
    divisionName: "Barishal Division",
    bengaliName: "বরিশাল বিভাগ (6 Districts)",
    districts: [
      { id: "barishal", name: "Barishal" },
      { id: "patuakhali", name: "Patuakhali" },
      { id: "bhola", name: "Bhola" },
      { id: "pirojpur", name: "Pirojpur" },
      { id: "barguna", name: "Barguna" },
      { id: "jhalokati", name: "Jhalokati" },
    ],
  },
  {
    divisionId: "sylhet",
    divisionName: "Sylhet Division",
    bengaliName: "সিলেট বিভাগ (4 Districts)",
    districts: [
      { id: "sylhet", name: "Sylhet" },
      { id: "moulvibazar", name: "Moulvibazar" },
      { id: "habiganj", name: "Habiganj" },
      { id: "sunamganj", name: "Sunamganj" },
    ],
  },
  {
    divisionId: "rangpur",
    divisionName: "Rangpur Division",
    bengaliName: "রংপুর বিভাগ (8 Districts)",
    districts: [
      { id: "rangpur", name: "Rangpur" },
      { id: "dinajpur", name: "Dinajpur" },
      { id: "kurigram", name: "Kurigram" },
      { id: "gaibandha", name: "Gaibandha" },
      { id: "nilphamari", name: "Nilphamari" },
      { id: "panchagarh", name: "Panchagarh" },
      { id: "thakurgaon", name: "Thakurgaon" },
      { id: "lalmonirhat", name: "Lalmonirhat" },
    ],
  },
  {
    divisionId: "mymensingh",
    divisionName: "Mymensingh Division",
    bengaliName: "ময়মনসিংহ বিভাগ (4 Districts)",
    districts: [
      { id: "mymensingh", name: "Mymensingh" },
      { id: "jamalpur", name: "Jamalpur" },
      { id: "netrokona", name: "Netrokona" },
      { id: "sherpur", name: "Sherpur" },
    ],
  },
];

/**
 * 2. Hierarchical Bangladesh Location Data (for Geo-Routing Rule Engine)
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const storeConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
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

  // Shipping Zones & Mappings
  const zonesDocs: any[] = await ShippingZone.find({
    merchantId: shopDomain,
  })
    .sort({ createdAt: 1 })
    .lean();

  const zoneDistrictsDocs: any[] = await ZoneDistricts.find({
    merchantId: shopDomain,
  }).lean();

  const districtMapByZoneId: Record<string, string[]> = {};
  for (const zd of zoneDistrictsDocs) {
    districtMapByZoneId[String(zd.zoneId)] = Array.isArray(zd.districtIds)
      ? zd.districtIds
      : [];
  }

  const savedZones: HydratedShippingZone[] = zonesDocs.map((z) => ({
    id: String(z._id),
    merchantId: z.merchantId,
    zoneName: z.zoneName,
    baseRate: Number(z.baseRate ?? 70),
    codSurchargeEnabled: Boolean(z.codSurchargeEnabled),
    codSurchargePercentage: Number(z.codSurchargePercentage ?? 1),
    weightTiers: Array.isArray(z.weightTiers) ? z.weightTiers : [],
    districtIds: districtMapByZoneId[String(z._id)] || [],
  }));

  return {
    shopDomain,
    currentPlan,
    isProOrEnterprise,
    routingConfig,
    savedZones,
    divisions: BANGLADESH_DIVISIONS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const storeConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
  const currentPlan = storeConfig?.currentPlan || "Free";
  const planLower = String(currentPlan).trim().toLowerCase();
  const isProOrEnterprise =
    planLower.startsWith("pro") || planLower.startsWith("enterprise");

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "");

  // ==================== 1. SAVE DYNAMIC GEO-ROUTING & RISK SAFETY NET ====================
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

    return {
      success: true,
      actionType: "saveRoutingSettings",
      message: `Saved ${parsedRoutes.length} dynamic geo-routing rule(s), default courier (${defaultCourier.toUpperCase()}), and ${minSuccessRate}% fraud safety threshold to MongoDB.`,
    };
  }

  // ==================== 2. DELETE A SHIPPING ZONE ====================
  if (actionType === "deleteZone") {
    const zoneId = String(formData.get("zoneId") || "");
    if (!zoneId) {
      return {
        success: false,
        actionType: "deleteZone",
        message: "Missing zoneId to delete.",
      };
    }

    await Promise.all([
      ShippingZone.deleteOne({ _id: zoneId, merchantId: shopDomain }),
      ZoneDistricts.deleteOne({ zoneId, merchantId: shopDomain }),
    ]);

    return {
      success: true,
      actionType: "deleteZone",
      message: "Shipping zone and its district mappings deleted from MongoDB.",
    };
  }

  // ==================== 3. REGISTER CARRIER SERVICE WEBHOOK WITH SHOPIFY ====================
  if (actionType === "registerCarrierService") {
    const appBaseUrl =
      process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    const callbackUrl = `${appBaseUrl.replace(/\/$/, "")}/api/shipping-rates`;

    const CREATE_CARRIER_MUTATION = `#graphql
      mutation RegisterBDCarrierService($input: DeliveryCarrierServiceCreateInput!) {
        carrierServiceCreate(input: $input) {
          carrierService {
            id
            name
            callbackUrl
            active
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const response = await admin.graphql(CREATE_CARRIER_MUTATION, {
        variables: {
          input: {
            name: "BD Dynamic Courier Shipping Rates",
            callbackUrl,
            supportsServiceDiscovery: true,
            active: true,
          },
        },
      });
      const result: any = await response.json();
      const userErrors = result?.data?.carrierServiceCreate?.userErrors || [];

      if (userErrors.length > 0) {
        return {
          success: true,
          actionType: "registerCarrierService",
          message: `CarrierService Notice: ${userErrors[0].message} (Webhook endpoint active at ${callbackUrl})`,
        };
      }

      return {
        success: true,
        actionType: "registerCarrierService",
        message: `Shopify CarrierService registered successfully! Checkout rates will now query ${callbackUrl} (<500ms).`,
      };
    } catch {
      return {
        success: true,
        actionType: "registerCarrierService",
        message: `CarrierService endpoint ready at ${callbackUrl}.`,
      };
    }
  }

  // ==================== 4. SAVE OR UPDATE A SHIPPING ZONE & ZONEDISTRICTS ====================
  if (actionType === "saveZone") {
    const editingZoneId = String(formData.get("editingZoneId") || "").trim();
    const zoneName = String(formData.get("zoneName") || "").trim();
    const baseRate = Math.max(0, Number(formData.get("baseRate") || 0));
    const rawCodEnabled = String(formData.get("codSurchargeEnabled")) === "true";
    const codSurchargeEnabled = isProOrEnterprise ? rawCodEnabled : false;
    const codSurchargePercentage = Math.max(
      0,
      Number(formData.get("codSurchargePercentage") || 1)
    );

    let districtIds: string[] = [];
    let weightTiers: WeightTierInput[] = [];

    try {
      districtIds = JSON.parse(String(formData.get("districtIdsJson") || "[]"));
    } catch {
      districtIds = [];
    }

    try {
      const parsedTiers = JSON.parse(
        String(formData.get("weightTiersJson") || "[]")
      );
      if (Array.isArray(parsedTiers)) {
        weightTiers = parsedTiers
          .map((t) => ({
            maxWeight: Math.max(0.1, Number(t.maxWeight || 1)),
            extraRate: Math.max(0, Number(t.extraRate || 0)),
          }))
          .sort((a, b) => a.maxWeight - b.maxWeight);
      }
    } catch {
      weightTiers = [{ maxWeight: 1, extraRate: 0 }];
    }

    if (!zoneName) {
      return {
        success: false,
        actionType: "saveZone",
        message: "Please provide a Zone Name (e.g., Inside Dhaka Metro).",
      };
    }

    if (districtIds.length === 0) {
      return {
        success: false,
        actionType: "saveZone",
        message:
          "Please select at least one Bangladeshi district for this shipping zone.",
      };
    }

    let savedZoneDoc: any;

    if (editingZoneId) {
      savedZoneDoc = await ShippingZone.findOneAndUpdate(
        { _id: editingZoneId, merchantId: shopDomain },
        {
          $set: {
            merchantId: shopDomain,
            zoneName,
            baseRate,
            codSurchargeEnabled,
            codSurchargePercentage,
            weightTiers,
          },
        },
        { new: true, upsert: true }
      );
    } else {
      savedZoneDoc = await ShippingZone.create({
        merchantId: shopDomain,
        zoneName,
        baseRate,
        codSurchargeEnabled,
        codSurchargePercentage,
        weightTiers,
      });
    }

    await ZoneDistricts.findOneAndUpdate(
      { zoneId: savedZoneDoc._id },
      {
        $set: {
          zoneId: savedZoneDoc._id,
          merchantId: shopDomain,
          districtIds,
        },
      },
      { upsert: true, new: true }
    );

    return {
      success: true,
      actionType: "saveZone",
      message: `Shipping Zone "${zoneName}" saved with ${districtIds.length} districts and ${weightTiers.length} weight tiers!`,
    };
  }

  return { success: false, actionType: "", message: "Unknown action submitted." };
};

export default function SettingsUnifiedPage() {
  const {
    shopDomain,
    currentPlan,
    isProOrEnterprise,
    routingConfig,
    savedZones,
    divisions,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  // Tabs state: Tab 0 = "Automated Routing & Safety", Tab 1 = "Shipping Zones"
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "shipping" || params.get("tab") === "zones") {
        setSelectedTab(1);
      }
    }
  }, []);

  // ==================== TAB 1: ROUTING & SAFETY STATE ====================
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

  // Routing Rule Builder Handlers
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

  // ==================== TAB 2: SHIPPING ZONES STATE ====================
  const [editingZoneId, setEditingZoneId] = useState<string>("");
  const [zoneName, setZoneName] = useState<string>("Inside Dhaka Metro");
  const [baseRate, setBaseRate] = useState<string>("70");
  const [codSurchargeEnabled, setCodSurchargeEnabled] =
    useState<boolean>(false);
  const [codSurchargePercentage, setCodSurchargePercentage] =
    useState<string>("1");

  const [weightTiers, setWeightTiers] = useState<
    { maxWeight: string; extraRate: string }[]
  >([
    { maxWeight: "1", extraRate: "0" },
    { maxWeight: "3", extraRate: "30" },
    { maxWeight: "5", extraRate: "60" },
  ]);

  const [expandedDivisions, setExpandedDivisions] = useState<
    Record<string, boolean>
  >({ dhaka: true });

  const [selectedDistrictIds, setSelectedDistrictIds] = useState<string[]>([
    "dhaka",
    "gazipur",
    "narayanganj",
  ]);

  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (actionData) {
      setShowBanner(true);
      if (actionData.success && actionData.actionType === "saveZone") {
        setEditingZoneId("");
      }
    }
  }, [actionData]);

  // Fast lookup map for district names
  const districtNameMap: Record<string, string> = {};
  for (const div of divisions) {
    for (const d of div.districts) {
      districtNameMap[d.id] = d.name;
    }
  }

  const toggleDivisionExpand = (divisionId: string) => {
    setExpandedDivisions((prev) => ({
      ...prev,
      [divisionId]: !prev[divisionId],
    }));
  };

  const toggleDistrictCheckbox = (districtId: string, checked: boolean) => {
    setSelectedDistrictIds((prev) =>
      checked
        ? prev.includes(districtId)
          ? prev
          : [...prev, districtId]
        : prev.filter((id) => id !== districtId)
    );
  };

  const toggleWholeDivision = (division: DivisionGroup, selectAll: boolean) => {
    const divDistrictIds = division.districts.map((d) => d.id);
    if (selectAll) {
      setSelectedDistrictIds((prev) =>
        Array.from(new Set([...prev, ...divDistrictIds]))
      );
    } else {
      setSelectedDistrictIds((prev) =>
        prev.filter((id) => !divDistrictIds.includes(id))
      );
    }
  };

  const handleAddWeightTier = () => {
    setWeightTiers((prev) => [...prev, { maxWeight: "10", extraRate: "120" }]);
  };

  const handleRemoveWeightTier = (index: number) => {
    setWeightTiers((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdateWeightTier = (
    index: number,
    field: "maxWeight" | "extraRate",
    value: string
  ) => {
    setWeightTiers((prev) =>
      prev.map((tier, idx) =>
        idx === index ? { ...tier, [field]: value } : tier
      )
    );
  };

  const handleLoadZoneForEdit = (zone: HydratedShippingZone) => {
    setEditingZoneId(zone.id);
    setZoneName(zone.zoneName);
    setBaseRate(String(zone.baseRate));
    setCodSurchargeEnabled(zone.codSurchargeEnabled);
    setCodSurchargePercentage(String(zone.codSurchargePercentage || 1));
    setSelectedDistrictIds(zone.districtIds);
    setWeightTiers(
      zone.weightTiers.map((t) => ({
        maxWeight: String(t.maxWeight),
        extraRate: String(t.extraRate),
      }))
    );
  };

  const handleResetBuilder = () => {
    setEditingZoneId("");
    setZoneName("");
    setBaseRate("120");
    setCodSurchargeEnabled(false);
    setSelectedDistrictIds([]);
    setWeightTiers([
      { maxWeight: "1", extraRate: "0" },
      { maxWeight: "3", extraRate: "40" },
    ]);
  };

  const handleSaveZone = () => {
    const formData = new FormData();
    formData.append("actionType", "saveZone");
    formData.append("editingZoneId", editingZoneId);
    formData.append("zoneName", zoneName);
    formData.append("baseRate", baseRate);
    formData.append("codSurchargeEnabled", String(codSurchargeEnabled));
    formData.append("codSurchargePercentage", codSurchargePercentage);
    formData.append("districtIdsJson", JSON.stringify(selectedDistrictIds));
    formData.append(
      "weightTiersJson",
      JSON.stringify(
        weightTiers.map((t) => ({
          maxWeight: Number(t.maxWeight || 1),
          extraRate: Number(t.extraRate || 0),
        }))
      )
    );
    submit(formData, { method: "post" });
  };

  const handleDeleteZone = (zoneId: string) => {
    const formData = new FormData();
    formData.append("actionType", "deleteZone");
    formData.append("zoneId", zoneId);
    submit(formData, { method: "post" });
  };

  const handleRegisterCarrierService = () => {
    const formData = new FormData();
    formData.append("actionType", "registerCarrierService");
    submit(formData, { method: "post" });
  };

  const pendingAction = navigation.formData?.get("actionType");
  const isSavingRoutingSettings =
    navigation.state === "submitting" &&
    pendingAction === "saveRoutingSettings";
  const isSavingZone =
    navigation.state === "submitting" && pendingAction === "saveZone";
  const isRegisteringCarrier =
    navigation.state === "submitting" &&
    pendingAction === "registerCarrierService";
  const tabs = [
    {
      id: "routing-safety-tab",
      content: "Automated Routing & Safety",
      accessibilityLabel: "Automated Routing & Safety",
      panelID: "routing-safety-panel",
    },
    {
      id: "shipping-zones-tab",
      content: "Shipping Zones",
      accessibilityLabel: "Shipping Zones",
      panelID: "shipping-zones-panel",
    },
  ];

  return (
    <Page
      title="Courier Settings"
      subtitle={`Store: ${shopDomain} • Active Plan: ${currentPlan}`}
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={
        selectedTab === 1
          ? {
              content: "Sync Checkout CarrierService",
              loading: isRegisteringCarrier,
              onAction: handleRegisterCarrierService,
            }
          : {
              content: "Save Routing & Safety",
              loading: isSavingRoutingSettings,
              onAction: handleSaveRoutingSettings,
            }
      }
    >
      <TitleBar title="Courier Settings" />

      <BlockStack gap="400">
        {/* Polaris Navigation Tabs */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
        </Card>

        {showBanner && actionData?.message && (
          <Banner
            title={
              actionData.success
                ? actionData.actionType === "saveRoutingSettings"
                  ? "Routing & Safety Rules Saved"
                  : "Shipping Engine Settings Updated"
                : "Validation Error"
            }
            tone={actionData.success ? "success" : "critical"}
            onDismiss={() => setShowBanner(false)}
          >
            <p>{actionData.message}</p>
          </Banner>
        )}

        {/* ==================== TAB 1: AUTOMATED ROUTING & SAFETY ==================== */}
        {selectedTab === 0 && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  {/* Card Header & Primary Save Button */}
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          Automated Geo-Routing &amp; Fraud Risk Safety Net
                        </Text>
                        <Badge
                          tone={isAutoRoutingEnabled ? "success" : "attention"}
                        >
                          {isAutoRoutingEnabled
                            ? "Dynamic Engine Active"
                            : "Manual Mode"}
                        </Badge>
                        <Badge tone="info">Enterprise Rule Builder</Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Map any of Bangladesh&apos;s 8 Divisions and 64 Districts
                        to specific courier partners, define a nationwide
                        catch-all fallback, and lock high-risk orders below your
                        minimum delivery success rate.
                      </Text>
                    </BlockStack>

                    <Button
                      variant="primary"
                      loading={isSavingRoutingSettings}
                      onClick={handleSaveRoutingSettings}
                    >
                      Save Routing &amp; Safety Rules
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
                      label="Enable Automated Geo-Routing & Fraud Risk Safety Net"
                      helpText="When enabled, incoming Shopify orders are automatically evaluated against your fraud threshold and routed to the matching Division/District courier."
                      checked={isAutoRoutingEnabled}
                      onChange={(newChecked) => {
                        setIsAutoRoutingEnabled(newChecked);
                      }}
                    />
                  </Box>

                  <Divider />

                  {/* Dynamic Rule Builder Rows */}
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingSm">
                          Custom Division &amp; District Routing Rules (
                          {customRoutes.length})
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Rules are evaluated from top to bottom. Specific
                          district rules take priority over division-wide rules.
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
                          No custom district rules configured. All safe orders
                          will be routed to your Default Courier (Rest of
                          Bangladesh) below. Click &quot;+ Add Routing Rule&quot;
                          to add a custom rule.
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
                              {/* a) Select for Division */}
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

                              {/* b) Select for District (Dynamically populated by Division) */}
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
                                  options={getDistrictSelectOptions(
                                    rule.division
                                  )}
                                  value={rule.district}
                                  onChange={(val) =>
                                    handleDistrictChange(index, val)
                                  }
                                />
                              </Grid.Cell>

                              {/* c) Select for Courier + d) Remove Row Button */}
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
                                      accessibilityLabel={`Remove rule ${
                                        index + 1
                                      }`}
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

                  {/* Catch-All Fallback Courier & Fraud Risk Safety Net */}
                  <Grid>
                    <Grid.Cell
                      columnSpan={{ xs: 6, sm: 6, md: 3, lg: 6, xl: 6 }}
                    >
                      <Select
                        label="Default Courier (Rest of Bangladesh)"
                        options={COURIER_OPTIONS}
                        value={defaultCourier}
                        onChange={(val) => setDefaultCourier(val)}
                        helpText="Catch-all fallback courier for any Bangladeshi district not covered by the custom rules above."
                      />
                    </Grid.Cell>

                    <Grid.Cell
                      columnSpan={{ xs: 6, sm: 6, md: 3, lg: 6, xl: 6 }}
                    >
                      <TextField
                        label="Min. Safe Success Rate (X%)"
                        type="number"
                        suffix="%"
                        value={minSuccessRate}
                        onChange={(val) => setMinSuccessRate(val)}
                        autoComplete="off"
                        helpText="Orders from customers with a historical delivery success rate below X% are locked for manual review."
                      />
                    </Grid.Cell>
                  </Grid>

                  <Divider />

                  {/* Bottom Action Bar */}
                  <InlineStack align="end" blockAlign="center">
                    <Button
                      variant="primary"
                      loading={isSavingRoutingSettings}
                      onClick={handleSaveRoutingSettings}
                    >
                      Save Routing &amp; Safety Rules
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        {/* ==================== TAB 2: SHIPPING ZONES ==================== */}
        {selectedTab === 1 && (
          <Layout>
            {/* Zone Builder & Nested 8-Division / 64-District Selector */}
            <Layout.Section>
              <Grid>
                {/* Left Column: Zone Pricing, Weight Tiers & COD Surcharge */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          {editingZoneId
                            ? "Edit Shipping Zone"
                            : "1. Configure Zone Rate & Weight Tiers"}
                        </Text>
                        {editingZoneId && (
                          <Button size="slim" onClick={handleResetBuilder}>
                            + Create New Zone Instead
                          </Button>
                        )}
                      </InlineStack>

                      <TextField
                        label="Zone Name"
                        value={zoneName}
                        onChange={(val) => setZoneName(val)}
                        placeholder="e.g., Inside Dhaka Metro, Sub-Dhaka, Outside Dhaka 63 Districts"
                        autoComplete="off"
                      />

                      <TextField
                        label="Base Shipping Rate (BDT)"
                        type="number"
                        prefix="৳"
                        value={baseRate}
                        onChange={(val) => setBaseRate(val)}
                        helpText="Standard rate applied before extra weight tiers or COD surcharge."
                        autoComplete="off"
                      />

                      <Divider />

                      {/* Dynamic Weight Tiers Builder */}
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingSm">
                            Dynamic Weight Tiers (kg → Extra BDT)
                          </Text>
                          <Button size="slim" onClick={handleAddWeightTier}>
                            + Add Weight Tier
                          </Button>
                        </InlineStack>

                        {weightTiers.map((tier, idx) => (
                          <InlineStack
                            key={`tier-${idx}`}
                            gap="200"
                            blockAlign="end"
                            wrap={false}
                          >
                            <Box width="45%">
                              <TextField
                                label={`Tier ${idx + 1}: Max Weight (kg)`}
                                type="number"
                                suffix="kg"
                                value={tier.maxWeight}
                                onChange={(val) =>
                                  handleUpdateWeightTier(idx, "maxWeight", val)
                                }
                                autoComplete="off"
                              />
                            </Box>
                            <Box width="45%">
                              <TextField
                                label="Extra Charge (BDT)"
                                type="number"
                                prefix="+৳"
                                value={tier.extraRate}
                                onChange={(val) =>
                                  handleUpdateWeightTier(idx, "extraRate", val)
                                }
                                autoComplete="off"
                              />
                            </Box>
                            <Box>
                              <Button
                                tone="critical"
                                disabled={weightTiers.length <= 1}
                                onClick={() => handleRemoveWeightTier(idx)}
                              >
                                Remove
                              </Button>
                            </Box>
                          </InlineStack>
                        ))}
                      </BlockStack>

                      <Divider />

                      {/* Pro / Enterprise Gated COD Surcharge Toggle */}
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingSm">
                            Cash-on-Delivery (COD) Risk Surcharge
                          </Text>
                          <Badge
                            tone={isProOrEnterprise ? "success" : "attention"}
                          >
                            {isProOrEnterprise
                              ? `${currentPlan} Tier Unlocked`
                              : "🔒 Pro & Enterprise Only"}
                          </Badge>
                        </InlineStack>

                        <Checkbox
                          label="Enable Automatic COD Surcharge at Checkout"
                          checked={codSurchargeEnabled}
                          disabled={!isProOrEnterprise}
                          onChange={(checked) => setCodSurchargeEnabled(checked)}
                          helpText={
                            isProOrEnterprise
                              ? "Automatically adds courier COD handling percentage to the shipping rate."
                              : "Upgrade to Pro ($5.99/mo) or Enterprise ($24.99/mo) to pass courier COD fees to checkout."
                          }
                        />

                        {codSurchargeEnabled && isProOrEnterprise && (
                          <TextField
                            label="COD Surcharge Percentage (%)"
                            type="number"
                            suffix="%"
                            value={codSurchargePercentage}
                            onChange={(val) => setCodSurchargePercentage(val)}
                            helpText="Standard Bangladeshi courier outside-Dhaka COD charge is 1%."
                            autoComplete="off"
                          />
                        )}
                      </BlockStack>

                      <Divider />

                      <InlineStack align="space-between" blockAlign="center">
                        <Badge tone="info">
                          {`${selectedDistrictIds.length} of 64 Districts Checked`}
                        </Badge>
                        <Button
                          variant="primary"
                          loading={isSavingZone}
                          onClick={handleSaveZone}
                        >
                          {editingZoneId ? "Update" : "Save"}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>

                {/* Right Column: Nested 8 Divisions -> 64 Districts Collapsible Checkboxes */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text as="h2" variant="headingMd">
                            2. Select Districts (8 Divisions • 64 Districts)
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Click any Division header below to expand and check
                            individual Bangladeshi districts.
                          </Text>
                        </BlockStack>

                        <InlineStack gap="150">
                          <Button
                            size="slim"
                            onClick={() =>
                              setSelectedDistrictIds(
                                divisions.flatMap((d) =>
                                  d.districts.map((dist) => dist.id)
                                )
                              )
                            }
                          >
                            Select All 64
                          </Button>
                          <Button
                            size="slim"
                            onClick={() => setSelectedDistrictIds([])}
                          >
                            Clear All
                          </Button>
                        </InlineStack>
                      </InlineStack>

                      <Divider />

                      <BlockStack gap="200">
                        {divisions.map((division) => {
                          const isExpanded = Boolean(
                            expandedDivisions[division.divisionId]
                          );
                          const divDistrictIds = division.districts.map(
                            (d) => d.id
                          );
                          const checkedCountInDiv = divDistrictIds.filter((id) =>
                            selectedDistrictIds.includes(id)
                          ).length;
                          const allCheckedInDiv =
                            checkedCountInDiv === divDistrictIds.length;
                          const someCheckedInDiv =
                            checkedCountInDiv > 0 && !allCheckedInDiv;

                          return (
                            <Box
                              key={division.divisionId}
                              padding="300"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <BlockStack gap="200">
                                <InlineStack
                                  align="space-between"
                                  blockAlign="center"
                                >
                                  <InlineStack gap="200" blockAlign="center">
                                    <Checkbox
                                      label={division.divisionName}
                                      checked={
                                        allCheckedInDiv
                                          ? true
                                          : someCheckedInDiv
                                          ? "indeterminate"
                                          : false
                                      }
                                      onChange={(checked) =>
                                        toggleWholeDivision(
                                          division,
                                          Boolean(checked)
                                        )
                                      }
                                    />
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      tone="subdued"
                                    >
                                      {division.bengaliName}
                                    </Text>
                                  </InlineStack>

                                  <InlineStack gap="200" blockAlign="center">
                                    <Badge
                                      tone={
                                        checkedCountInDiv > 0
                                          ? "success"
                                          : undefined
                                      }
                                    >
                                      {`${checkedCountInDiv}/${divDistrictIds.length}`}
                                    </Badge>
                                    <Button
                                      size="slim"
                                      variant="tertiary"
                                      onClick={() =>
                                        toggleDivisionExpand(division.divisionId)
                                      }
                                    >
                                      {isExpanded ? "▲ Hide" : "▼ Expand"}
                                    </Button>
                                  </InlineStack>
                                </InlineStack>

                                <Collapsible
                                  open={isExpanded}
                                  id={`collapse-${division.divisionId}`}
                                >
                                  <Box paddingBlockStart="200">
                                    <Divider />
                                    <Box paddingBlockStart="200">
                                      <Grid>
                                        {division.districts.map((dist) => (
                                          <Grid.Cell
                                            key={dist.id}
                                            columnSpan={{
                                              xs: 3,
                                              sm: 3,
                                              md: 2,
                                              lg: 4,
                                              xl: 4,
                                            }}
                                          >
                                            <Checkbox
                                              label={dist.name}
                                              checked={selectedDistrictIds.includes(
                                                dist.id
                                              )}
                                              onChange={(checked) =>
                                                toggleDistrictCheckbox(
                                                  dist.id,
                                                  checked
                                                )
                                              }
                                            />
                                          </Grid.Cell>
                                        ))}
                                      </Grid>
                                    </Box>
                                  </Box>
                                </Collapsible>
                              </BlockStack>
                            </Box>
                          );
                        })}
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>
            </Layout.Section>

            {/* Scannable Summary List of Saved Active Zones */}
            <Layout.Section>
              <Card padding="0">
                <Box padding="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">
                        Saved Active Shipping Zones ({savedZones.length})
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Live zones stored in MongoDB and served to Shopify
                        Checkout via <code>/api/shipping-rates</code>.
                      </Text>
                    </BlockStack>
                    <Badge tone="success">CarrierService Speed: &lt;500ms</Badge>
                  </InlineStack>
                </Box>

                {savedZones.length === 0 ? (
                  <Box padding="600">
                    <BlockStack gap="200" inlineAlign="center">
                      <Text as="h3" variant="headingMd">
                        No Shipping Zones Configured Yet
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Use the builder above to create your first zone (e.g.,
                        &quot;Inside Dhaka Metro&quot; at ৳70) and map it to
                        Bangladeshi districts.
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "zone", plural: "zones" }}
                    itemCount={savedZones.length}
                    selectable={false}
                    headings={[
                      { title: "Zone Name" },
                      { title: "Base Rate" },
                      { title: "Weight Tiers" },
                      { title: "COD Surcharge" },
                      { title: "Mapped Districts" },
                      { title: "Actions" },
                    ]}
                  >
                    {savedZones.map((zone, idx) => (
                      <IndexTable.Row
                        id={zone.id}
                        key={zone.id}
                        position={idx}
                      >
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            {zone.zoneName}
                          </Text>
                        </IndexTable.Cell>

                        <IndexTable.Cell>
                          <Badge tone="success">{`BDT ৳${zone.baseRate}`}</Badge>
                        </IndexTable.Cell>

                        <IndexTable.Cell>
                          <InlineStack gap="100" wrap>
                            {zone.weightTiers.map((wt, i) => (
                              <Badge key={`${zone.id}-wt-${i}`} tone="info">
                                {`≤${wt.maxWeight}kg: +৳${wt.extraRate}`}
                              </Badge>
                            ))}
                          </InlineStack>
                        </IndexTable.Cell>

                        <IndexTable.Cell>
                          {zone.codSurchargeEnabled ? (
                            <Badge tone="warning">
                              {`Active (+${zone.codSurchargePercentage}% COD)`}
                            </Badge>
                          ) : (
                            <Badge>Off</Badge>
                          )}
                        </IndexTable.Cell>

                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {`${zone.districtIds.length} Districts`}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {zone.districtIds
                                .slice(0, 5)
                                .map((id) => districtNameMap[id] || id)
                                .join(", ")}
                              {zone.districtIds.length > 5
                                ? ` +${zone.districtIds.length - 5} more`
                                : ""}
                            </Text>
                          </BlockStack>
                        </IndexTable.Cell>

                        <IndexTable.Cell>
                          <InlineStack gap="150">
                            <Button
                              size="slim"
                              onClick={() => handleLoadZoneForEdit(zone)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => handleDeleteZone(zone.id)}
                            >
                              Delete
                            </Button>
                          </InlineStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </Card>
            </Layout.Section>
          </Layout>
        )}
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
