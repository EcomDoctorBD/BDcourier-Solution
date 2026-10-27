import { useState, useEffect } from "react";
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
  Collapsible,
  Divider,
  Banner,
  Grid,
  Box,
  IndexTable,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { syncAppDeliveryProfileWithShopify } from "../services/shipping-profile.server";
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

/**
 * Complete Fixed Dataset of the 8 Divisions & 64 Districts of Bangladesh
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const [rawZones, rawDistricts, storeConfig] = await Promise.all([
    ShippingZone.find({ merchantId: shopDomain }).sort({ createdAt: -1 }).lean(),
    ZoneDistricts.find({ merchantId: shopDomain }).lean(),
    CourierConfig.findOne({ shopDomain }).lean(),
  ]);

  const districtMap: Record<string, string[]> = {};
  for (const item of rawDistricts) {
    if (item.zoneId) {
      districtMap[String(item.zoneId)] = item.districtIds || [];
    }
  }

  const savedZones: HydratedShippingZone[] = rawZones.map((z: any) => ({
    id: String(z._id),
    merchantId: z.merchantId,
    zoneName: z.zoneName,
    baseRate: Number(z.baseRate) || 0,
    codSurchargeEnabled: Boolean(z.codSurchargeEnabled),
    codSurchargePercentage: Number(z.codSurchargePercentage) || 0,
    weightTiers: Array.isArray(z.weightTiers)
      ? z.weightTiers.map((wt: any) => ({
          maxWeight: Number(wt.maxWeight) || 0,
          extraRate: Number(wt.extraRate) || 0,
        }))
      : [],
    districtIds: districtMap[String(z._id)] || [],
  }));

  const isSynced =
    savedZones.length === 0 ? true : Boolean(storeConfig?.shippingRatesSynced);

  return json({
    shopDomain,
    savedZones,
    currentPlan: storeConfig?.currentPlan || "Free",
    isSynced,
    appDeliveryProfileId: storeConfig?.appDeliveryProfileId || null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "");

  // ==================== 1. DELETE A SHIPPING ZONE ====================
  if (actionType === "deleteZone") {
    const zoneId = String(formData.get("zoneId") || "");
    if (!zoneId) {
      return json({
        success: false,
        actionType: "deleteZone",
        message: "Missing zoneId to delete.",
      });
    }

    await Promise.all([
      ShippingZone.deleteOne({ _id: zoneId, merchantId: shopDomain }),
      ZoneDistricts.deleteOne({ zoneId, merchantId: shopDomain }),
    ]);

    const remainingZonesCount = await ShippingZone.countDocuments({
      merchantId: shopDomain,
    });
    const newSyncedStatus = remainingZonesCount === 0 ? true : false;
    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: { shippingRatesSynced: newSyncedStatus } },
      { upsert: true }
    );

    return json({
      success: true,
      actionType: "deleteZone",
      isSynced: newSyncedStatus,
      message:
        remainingZonesCount === 0
          ? "Shipping zone deleted. No remaining zones configured."
          : "Shipping zone deleted. Please sync to update your live checkout rates.",
    });
  }

  // ==================== 2. REGISTER APP-OWNED DELIVERY PROFILE (OPTION A: coversAllItems) ====================
  if (actionType === "registerCarrierService") {
    const syncResult = await syncAppDeliveryProfileWithShopify(
      admin,
      request,
      shopDomain
    );

    return json({
      success: syncResult.success,
      actionType: "registerCarrierService",
      isSynced: syncResult.success,
      message: syncResult.message,
    });
  }

  // ==================== 3. SAVE OR UPDATE A SHIPPING ZONE ====================
  if (actionType === "saveZone") {
    const zoneId = String(formData.get("zoneId") || "").trim();
    const zoneName = String(formData.get("zoneName") || "").trim();
    const baseRate = Number(formData.get("baseRate")) || 0;
    const codSurchargeEnabled =
      String(formData.get("codSurchargeEnabled")) === "true";
    const codSurchargePercentage =
      Number(formData.get("codSurchargePercentage")) || 0;

    let weightTiers: WeightTierInput[] = [];
    try {
      const tiersRaw = String(formData.get("weightTiersJson") || "[]");
      weightTiers = JSON.parse(tiersRaw);
    } catch {
      weightTiers = [];
    }

    let districtIds: string[] = [];
    try {
      const distRaw = String(formData.get("districtIdsJson") || "[]");
      districtIds = JSON.parse(distRaw);
    } catch {
      districtIds = [];
    }

    if (!zoneName) {
      return json({
        success: false,
        actionType: "saveZone",
        message:
          "Please specify a Zone Name (e.g. Inside Dhaka Metro, Outside Dhaka).",
      });
    }

    if (districtIds.length === 0) {
      return json({
        success: false,
        actionType: "saveZone",
        message:
          "Please select at least 1 district from Bangladesh for this shipping zone.",
      });
    }

    const existingZonesCount = await ShippingZone.countDocuments({
      merchantId: shopDomain,
    });
    const isFirstTimeSetup = existingZonesCount === 0;

    let targetZoneId = zoneId;

    if (targetZoneId) {
      await ShippingZone.findOneAndUpdate(
        { _id: targetZoneId, merchantId: shopDomain },
        {
          $set: {
            zoneName,
            baseRate,
            codSurchargeEnabled,
            codSurchargePercentage,
            weightTiers,
            updatedAt: new Date(),
          },
        }
      );
    } else {
      const created = await ShippingZone.create({
        merchantId: shopDomain,
        zoneName,
        baseRate,
        codSurchargeEnabled,
        codSurchargePercentage,
        weightTiers,
      });
      targetZoneId = String(created._id);
    }

    await ZoneDistricts.findOneAndUpdate(
      { zoneId: targetZoneId, merchantId: shopDomain },
      {
        $set: {
          zoneId: targetZoneId,
          merchantId: shopDomain,
          districtIds,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // If this is the merchant's very first shipping zone, auto-trigger App-Owned Delivery Profile registration!
    if (isFirstTimeSetup) {
      const syncResult = await syncAppDeliveryProfileWithShopify(
        admin,
        request,
        shopDomain
      );

      if (syncResult.success) {
        return json({
          success: true,
          actionType: "saveZone",
          isSynced: true,
          autoSynced: true,
          message: `Shipping Zone "${zoneName}" saved and automatically activated in Shopify Checkout via App-Owned Delivery Profile!`,
        });
      } else {
        await CourierConfig.findOneAndUpdate(
          { shopDomain },
          { $set: { shippingRatesSynced: false } },
          { upsert: true }
        );

        return json({
          success: true,
          actionType: "saveZone",
          isSynced: false,
          message: `Shipping Zone "${zoneName}" saved! Note: Auto-sync encountered an issue: ${syncResult.message}. Please click "কাস্টমারদের জন্য লাইভ করুন" to connect checkout.`,
        });
      }
    }

    // Existing setup: update requires manual sync to checkout
    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      { $set: { shippingRatesSynced: false } },
      { upsert: true }
    );

    return json({
      success: true,
      actionType: "saveZone",
      isSynced: false,
      message: `Shipping Zone "${zoneName}" saved with ${districtIds.length} districts and ${weightTiers.length} weight tiers! Click "কাস্টমারদের জন্য লাইভ করুন" to update your live checkout rates.`,
    });
  }

  return json({
    success: false,
    actionType: "",
    message: "Unknown action submitted.",
  });
};

export default function ShippingRatesPage() {
  const {
    shopDomain,
    savedZones,
    currentPlan,
    isSynced: serverIsSynced,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const searchStr = searchParams.toString() ? `?${searchParams.toString()}` : "";

  const [isSynced, setIsSynced] = useState<boolean>(serverIsSynced);

  useEffect(() => {
    setIsSynced(serverIsSynced);
  }, [serverIsSynced]);

  useEffect(() => {
    if (actionData && typeof (actionData as any).isSynced === "boolean") {
      setIsSynced((actionData as any).isSynced);
    }
  }, [actionData]);

  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState<string>("");
  const [baseRate, setBaseRate] = useState<string>("70");
  const [codSurchargeEnabled, setCodSurchargeEnabled] = useState<boolean>(false);
  const [codSurchargePercentage, setCodSurchargePercentage] = useState<string>("1");
  const [weightTiers, setWeightTiers] = useState<WeightTierInput[]>([
    { maxWeight: 1, extraRate: 0 },
    { maxWeight: 2, extraRate: 20 },
  ]);
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [openDivisions, setOpenDivisions] = useState<Record<string, boolean>>({
    dhaka: true,
  });
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (actionData?.message) {
      setShowBanner(true);
      if (actionData.success && actionData.actionType === "saveZone") {
        handleResetBuilder();
      }
    }
  }, [actionData]);

  const handleToggleDivision = (divId: string) => {
    setOpenDivisions((prev) => ({
      ...prev,
      [divId]: !prev[divId],
    }));
  };

  const handleToggleDistrict = (distId: string) => {
    setSelectedDistricts((prev) =>
      prev.includes(distId)
        ? prev.filter((id) => id !== distId)
        : [...prev, distId]
    );
  };

  const handleSelectAllInDivision = (divGroup: DivisionGroup) => {
    const divDistIds = divGroup.districts.map((d) => d.id);
    const allSelected = divDistIds.every((id) => selectedDistricts.includes(id));

    if (allSelected) {
      setSelectedDistricts((prev) =>
        prev.filter((id) => !divDistIds.includes(id))
      );
    } else {
      setSelectedDistricts((prev) =>
        Array.from(new Set([...prev, ...divDistIds]))
      );
    }
  };

  const handleAddWeightTier = () => {
    const nextMax =
      weightTiers.length > 0
        ? Number(weightTiers[weightTiers.length - 1].maxWeight) + 1
        : 1;
    setWeightTiers((prev) => [...prev, { maxWeight: nextMax, extraRate: 20 }]);
  };

  const handleUpdateWeightTier = (
    index: number,
    field: "maxWeight" | "extraRate",
    value: string
  ) => {
    setWeightTiers((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        [field]: Number(value) || 0,
      };
      return copy;
    });
  };

  const handleRemoveWeightTier = (index: number) => {
    setWeightTiers((prev) => prev.filter((_, i) => i !== index));
  };

  const handleResetBuilder = () => {
    setEditingZoneId(null);
    setZoneName("");
    setBaseRate("70");
    setCodSurchargeEnabled(false);
    setCodSurchargePercentage("1");
    setWeightTiers([
      { maxWeight: 1, extraRate: 0 },
      { maxWeight: 2, extraRate: 20 },
    ]);
    setSelectedDistricts([]);
  };

  const handleLoadZoneForEdit = (zone: HydratedShippingZone) => {
    setEditingZoneId(zone.id);
    setZoneName(zone.zoneName);
    setBaseRate(String(zone.baseRate));
    setCodSurchargeEnabled(zone.codSurchargeEnabled);
    setCodSurchargePercentage(String(zone.codSurchargePercentage));
    setWeightTiers(
      zone.weightTiers.length > 0
        ? zone.weightTiers
        : [{ maxWeight: 1, extraRate: 0 }]
    );
    setSelectedDistricts(zone.districtIds);

    const newOpenState: Record<string, boolean> = {};
    for (const div of BANGLADESH_DIVISIONS) {
      const hasMatch = div.districts.some((d) => zone.districtIds.includes(d.id));
      if (hasMatch) newOpenState[div.divisionId] = true;
    }
    setOpenDivisions(newOpenState);

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleDeleteZone = (zoneId: string) => {
    if (confirm("Are you sure you want to permanently delete this shipping zone?")) {
      const formData = new FormData();
      formData.append("actionType", "deleteZone");
      formData.append("zoneId", zoneId);
      submit(formData, { method: "post" });
    }
  };

  const handleSaveZone = () => {
    const formData = new FormData();
    formData.append("actionType", "saveZone");
    if (editingZoneId) formData.append("zoneId", editingZoneId);
    formData.append("zoneName", zoneName);
    formData.append("baseRate", baseRate);
    formData.append("codSurchargeEnabled", String(codSurchargeEnabled));
    formData.append("codSurchargePercentage", codSurchargePercentage);
    formData.append("weightTiersJson", JSON.stringify(weightTiers));
    formData.append("districtIdsJson", JSON.stringify(selectedDistricts));
    submit(formData, { method: "post" });
  };

  const handleRegisterCarrierService = () => {
    const formData = new FormData();
    formData.append("actionType", "registerCarrierService");
    submit(formData, { method: "post" });
  };

  const isSavingZone =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveZone";
  const isRegisteringCarrier =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "registerCarrierService";

  const districtNameMap: Record<string, string> = {};
  for (const div of BANGLADESH_DIVISIONS) {
    for (const d of div.districts) {
      districtNameMap[d.id] = d.name;
    }
  }

  return (
    <Page>
      <TitleBar title="Shipping Rates" />

      <div className="shipping-rates-wrapper">
        <style>{`
          /* Sharpen all outer container card outlines */
          .shipping-rates-wrapper .Polaris-Card {
            border: 1px solid #E2E8F0 !important;
            border-radius: 12px !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
            transition: border-color 0.15s ease-in-out;
          }
          .shipping-rates-wrapper .division-card .Polaris-Card {
            border: 1px solid #E2E8F0 !important;
            border-radius: 8px !important;
            box-shadow: none !important;
            background-color: #FAFAFA !important;
          }
          .shipping-rates-wrapper .division-card .division-header-toggle,
          .shipping-rates-wrapper .division-card .division-header-toggle * {
            color: #202223 !important;
            text-decoration: none !important;
          }
          .shipping-rates-wrapper .division-card .division-header-toggle:hover * {
            color: #000000 !important;
          }

          /* Primary Action Button ("Sync Checkout CarrierService" in page header & variants) */
          .Polaris-Page-Header .Polaris-Button--variantPrimary,
          .shipping-rates-wrapper .Polaris-Button--variantPrimary {
            background-color: #000000 !important;
            color: #FFFFFF !important;
            font-weight: 600 !important;
            border-radius: 8px !important;
            border: 1px solid #000000 !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12) !important;
            transition: background-color 0.15s ease-in-out, border-color 0.15s ease-in-out !important;
          }
          .Polaris-Page-Header .Polaris-Button--variantPrimary:hover,
          .shipping-rates-wrapper .Polaris-Button--variantPrimary:hover {
            background-color: #1F2937 !important;
            border-color: #1F2937 !important;
          }

          /* Form Input Blocks: clean, thin, defined outlines */
          .shipping-rates-wrapper .Polaris-TextField {
            border: 1px solid #D1D5DB !important;
            border-radius: 6px !important;
            background-color: #FFFFFF !important;
            transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out !important;
          }
          .shipping-rates-wrapper .Polaris-TextField:focus-within,
          .shipping-rates-wrapper .Polaris-TextField--focus {
            border-color: #000000 !important;
            box-shadow: 0 0 0 1px #000000 !important;
            outline: none !important;
          }
          .shipping-rates-wrapper .Polaris-TextField__Backdrop {
            border: none !important;
          }
          .shipping-rates-wrapper .Polaris-TextField__Input {
            outline: none !important;
          }

          /* Interactive Toggles & Checkboxes: Black accent & dark focus indicators */
          .shipping-rates-wrapper input[type="checkbox"] {
            accent-color: #000000 !important;
          }
          .shipping-rates-wrapper .Polaris-Checkbox__Input:checked + .Polaris-Checkbox__Backdrop {
            background-color: #000000 !important;
            border-color: #000000 !important;
          }
          .shipping-rates-wrapper .Polaris-Checkbox__Input:focus + .Polaris-Checkbox__Backdrop {
            border-color: #000000 !important;
            box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.2) !important;
          }
          .shipping-rates-wrapper .Polaris-Checkbox:hover .Polaris-Checkbox__Backdrop {
            border-color: #000000 !important;
          }
        `}</style>

        <BlockStack gap="600">
          {showBanner && actionData?.message && (
            <Banner
              title={actionData.success ? "Success" : "Validation Error"}
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => setShowBanner(false)}
            >
              <p>{actionData.message}</p>
            </Banner>
          )}

          {!isSynced && savedZones.length > 0 && (
            <Banner tone="warning">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={{ flex: 1, minWidth: "260px" }}>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    ⚠️ আপনি আপনার ডেলিভারি চার্জ পরিবর্তন করেছেন, কিন্তু এটি এখনও কাস্টমারদের জন্য লাইভ করা হয়নি। নতুন রেট চালু করতে পাশের &quot;কাস্টমারদের জন্য লাইভ করুন&quot; বাটনে ক্লিক করুন।
                  </Text>
                </div>
                <button
                  type="button"
                  disabled={isRegisteringCarrier}
                  onClick={handleRegisterCarrierService}
                  className="bg-black text-white font-semibold px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm cursor-pointer shrink-0"
                  style={{
                    backgroundColor: "#000000",
                    color: "#FFFFFF",
                    fontWeight: 600,
                    borderRadius: "8px",
                    padding: "8px 16px",
                    border: "none",
                    cursor: isRegisteringCarrier ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
                    transition: "background-color 0.15s ease-in-out",
                    fontSize: "14px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    if (!isRegisteringCarrier) e.currentTarget.style.backgroundColor = "#1F2937";
                  }}
                  onMouseLeave={(e) => {
                    if (!isRegisteringCarrier) e.currentTarget.style.backgroundColor = "#000000";
                  }}
                >
                  {isRegisteringCarrier && (
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  কাস্টমারদের জন্য লাইভ করুন
                </button>
              </div>
            </Banner>
          )}

          <BlockStack gap="100">
            <Text as="h2" variant="headingLg">
              Delivery Charge Rules
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Define customized delivery rates, weight rules, and Cash-on-Delivery (COD) fees across all 64 districts in Bangladesh.
            </Text>
          </BlockStack>

          <Layout>
            {/* Zone Builder & Nested 8-Division / 64-District Selector */}
            <Layout.Section>
              <Grid>
                {/* Left Column: Zone Pricing, Weight Tiers & COD Surcharge */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                  <Card padding="500">
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingMd">
                          {editingZoneId
                            ? "Edit Shipping Zone"
                            : "Shipping Zone Details"}
                        </Text>
                        {editingZoneId && (
                          <button
                            type="button"
                            onClick={handleResetBuilder}
                            className="bg-black text-white px-3 py-1 text-sm rounded transition-all hover:bg-gray-800 font-medium cursor-pointer"
                            style={{
                              backgroundColor: "#000000",
                              color: "#FFFFFF",
                              padding: "4px 12px",
                              fontSize: "13px",
                              borderRadius: "6px",
                              fontWeight: 500,
                              border: "none",
                              cursor: "pointer",
                              transition: "all 0.15s ease-in-out",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = "#1F2937";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "#000000";
                            }}
                          >
                            + Create New Zone Instead
                          </button>
                        )}
                      </InlineStack>

                    <TextField
                      label="Zone Name"
                      value={zoneName}
                      onChange={(val) => setZoneName(val)}
                      placeholder="e.g. Inside Dhaka Metro, Sub-Dhaka, Outside Dhaka"
                      autoComplete="off"
                    />

                    <TextField
                      label="Base Shipping Rate (BDT)"
                      type="number"
                      prefix="৳"
                      value={baseRate}
                      onChange={(val) => setBaseRate(val)}
                      helpText="Base fee applied to all standard deliveries in this zone."
                      autoComplete="off"
                    />

                    <Divider />

                    {/* Dynamic Weight Tiers Builder */}
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text as="h4" variant="headingSm">
                            Weight Tiers (kg → Extra BDT)
                          </Text>
                          <Box paddingBlockStart="200" paddingBlockEnd="200">
                            <Text as="p" variant="bodySm" tone="subdued">
                              অতিরিক্ত ওজনের পার্সেলের জন্য বাড়তি ডেলিভারি চার্জ নির্ধারণ করুন।
                            </Text>
                          </Box>
                        </BlockStack>
                        <button
                          type="button"
                          onClick={handleAddWeightTier}
                          className="bg-black text-white px-3 py-1 text-sm rounded transition-all hover:bg-gray-800 font-medium cursor-pointer"
                          style={{
                            backgroundColor: "#000000",
                            color: "#FFFFFF",
                            padding: "4px 12px",
                            fontSize: "13px",
                            borderRadius: "6px",
                            fontWeight: 500,
                            border: "none",
                            cursor: "pointer",
                            transition: "all 0.15s ease-in-out",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = "#1F2937";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "#000000";
                          }}
                        >
                          + Add Weight Tier
                        </button>
                      </InlineStack>

                      {weightTiers.map((tier, idx) => (
                        <Grid key={idx}>
                          <Grid.Cell
                            columnSpan={{ xs: 6, sm: 6, md: 3, lg: 5, xl: 5 }}
                          >
                            <TextField
                              label="Max Weight (kg)"
                              type="number"
                              value={String(tier.maxWeight)}
                              onChange={(val) =>
                                handleUpdateWeightTier(idx, "maxWeight", val)
                              }
                              autoComplete="off"
                            />
                          </Grid.Cell>
                          <Grid.Cell
                            columnSpan={{ xs: 6, sm: 6, md: 3, lg: 5, xl: 5 }}
                          >
                            <TextField
                              label="Extra Rate (BDT)"
                              type="number"
                              prefix="+৳"
                              value={String(tier.extraRate)}
                              onChange={(val) =>
                                handleUpdateWeightTier(idx, "extraRate", val)
                              }
                              autoComplete="off"
                            />
                          </Grid.Cell>
                          <Grid.Cell
                            columnSpan={{ xs: 6, sm: 6, md: 6, lg: 2, xl: 2 }}
                          >
                            <Box paddingBlockStart="500">
                              <button
                                type="button"
                                onClick={() => handleRemoveWeightTier(idx)}
                                className="text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-500 bg-transparent px-3 py-1 text-sm rounded transition-colors font-medium cursor-pointer"
                                style={{
                                  backgroundColor: "transparent",
                                  color: "#475569",
                                  border: "1px solid #CBD5E1",
                                  borderRadius: "6px",
                                  padding: "4px 12px",
                                  fontSize: "13px",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                  transition: "all 0.15s ease-in-out",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = "#0F172A";
                                  e.currentTarget.style.borderColor = "#64748B";
                                  e.currentTarget.style.backgroundColor = "#F8FAFC";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color = "#475569";
                                  e.currentTarget.style.borderColor = "#CBD5E1";
                                  e.currentTarget.style.backgroundColor = "transparent";
                                }}
                              >
                                Remove
                              </button>
                            </Box>
                          </Grid.Cell>
                        </Grid>
                      ))}
                    </BlockStack>

                    <Divider />

                    {/* COD Surcharge Controls */}
                    <BlockStack gap="300">
                      <Checkbox
                        label="Enable Cash-on-Delivery (COD) Surcharge"
                        checked={codSurchargeEnabled}
                        onChange={(val) => setCodSurchargeEnabled(val)}
                        helpText="Applies an extra percentage on COD checkout orders (e.g. 1% Pathao/Steadfast handling fee)."
                      />

                      {codSurchargeEnabled && (
                        <TextField
                          label="COD Surcharge Percentage (%)"
                          type="number"
                          suffix="%"
                          value={codSurchargePercentage}
                          onChange={(val) => setCodSurchargePercentage(val)}
                          helpText="Commonly 1% for standard Bangladeshi logistics providers."
                          autoComplete="off"
                        />
                      )}
                    </BlockStack>

                    <Divider />

                    <InlineStack align="end" gap="200">
                      {editingZoneId && (
                        <button
                          type="button"
                          onClick={handleResetBuilder}
                          className="border border-slate-300 hover:border-slate-400 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer bg-white"
                          style={{
                            border: "1px solid #CBD5E1",
                            color: "#334155",
                            backgroundColor: "#FFFFFF",
                            borderRadius: "8px",
                            padding: "8px 16px",
                            fontSize: "14px",
                            fontWeight: 500,
                            cursor: "pointer",
                            transition: "all 0.15s ease-in-out",
                          }}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isSavingZone}
                        onClick={handleSaveZone}
                        className="bg-black text-white font-semibold px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm cursor-pointer"
                        style={{
                          backgroundColor: "#000000",
                          color: "#FFFFFF",
                          fontWeight: 600,
                          borderRadius: "8px",
                          padding: "8px 16px",
                          border: "none",
                          cursor: isSavingZone ? "not-allowed" : "pointer",
                          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
                          transition: "background-color 0.15s ease-in-out",
                          fontSize: "14px",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSavingZone) e.currentTarget.style.backgroundColor = "#1F2937";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSavingZone) e.currentTarget.style.backgroundColor = "#000000";
                        }}
                      >
                        {isSavingZone && (
                          <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                        )}
                        {editingZoneId ? "Update Zone" : "Save Shipping Zone"}
                      </button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              {/* Right Column: 8 Divisions & 64 Districts Selector */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <Card padding="500">
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        Map Districts to this Zone
                      </Text>
                      <Badge tone={selectedDistricts.length > 0 ? "success" : undefined}>
                        {`${selectedDistricts.length} / 64 Districts Selected`}
                      </Badge>
                    </InlineStack>

                    <Text as="p" variant="bodySm" tone="subdued">
                      Select which Bangladeshi districts belong to this zone. Each district can be mapped to your custom shipping rates.
                    </Text>

                    <Divider />

                    <BlockStack gap="250">
                      {BANGLADESH_DIVISIONS.map((divGroup) => {
                        const isOpen = Boolean(openDivisions[divGroup.divisionId]);
                        const divDistIds = divGroup.districts.map((d) => d.id);
                        const selectedInDiv = divDistIds.filter((id) =>
                          selectedDistricts.includes(id)
                        ).length;
                        const cleanBengaliName = divGroup.bengaliName.replace(
                          /\s*\(\d+\s*Districts\)/i,
                          ""
                        );

                        return (
                          <div key={divGroup.divisionId} className="division-card">
                            <Card padding="300">
                              <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                                  {/* Left side: Division Name + Bengali Name + District Counter */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleToggleDivision(divGroup.divisionId)
                                    }
                                    className="division-header-toggle"
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      padding: 0,
                                      cursor: "pointer",
                                      textAlign: "left",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      color: "#202223",
                                      flex: "1 1 auto",
                                      minWidth: 0,
                                    }}
                                  >
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                      style={{
                                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                                        transition: "transform 0.15s ease",
                                        color: "#5C5F62",
                                        flexShrink: 0,
                                      }}
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                      <span style={{ fontSize: "14px", fontWeight: 700, color: "#202223" }}>
                                        {divGroup.divisionName}
                                      </span>
                                      <span style={{ fontSize: "13px", color: "#6D7175" }}>
                                        ({cleanBengaliName})
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "12px",
                                          fontWeight: 600,
                                          padding: "2px 8px",
                                          borderRadius: "10px",
                                          backgroundColor:
                                            selectedInDiv === divDistIds.length
                                              ? "#DEF7EC"
                                              : selectedInDiv > 0
                                              ? "#E1EFFE"
                                              : "#F3F4F6",
                                          color:
                                            selectedInDiv === divDistIds.length
                                              ? "#03543F"
                                              : selectedInDiv > 0
                                              ? "#1E429F"
                                              : "#4B5563",
                                          border: `1px solid ${
                                            selectedInDiv === divDistIds.length
                                              ? "#BCF0DA"
                                              : selectedInDiv > 0
                                              ? "#B4C6FC"
                                              : "#E5E7EB"
                                          }`,
                                          marginLeft: "4px",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {`(${selectedInDiv}/${divDistIds.length} Districts)`}
                                      </span>
                                    </span>
                                  </button>

                                  {/* Right side: Sleek, Polished "Select All" Button */}
                                  <div style={{ flexShrink: 0, marginLeft: "12px" }}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSelectAllInDivision(divGroup)
                                      }
                                      className="select-all-btn"
                                      style={{
                                        backgroundColor:
                                          selectedInDiv === divDistIds.length
                                            ? "#1F2937"
                                            : "#FFFFFF",
                                        color:
                                          selectedInDiv === divDistIds.length
                                            ? "#FFFFFF"
                                            : "#374151",
                                        border:
                                          selectedInDiv === divDistIds.length
                                            ? "1px solid #1F2937"
                                            : "1px solid #D1D5DB",
                                        padding: "4px 12px",
                                        fontSize: "12px",
                                        borderRadius: "6px",
                                        fontWeight: 500,
                                        cursor: "pointer",
                                        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                                        transition: "all 0.15s ease-in-out",
                                        whiteSpace: "nowrap",
                                      }}
                                      onMouseEnter={(e) => {
                                        if (selectedInDiv === divDistIds.length) {
                                          e.currentTarget.style.backgroundColor = "#111827";
                                        } else {
                                          e.currentTarget.style.backgroundColor = "#F9FAFB";
                                          e.currentTarget.style.borderColor = "#9CA3AF";
                                          e.currentTarget.style.color = "#111827";
                                        }
                                      }}
                                      onMouseLeave={(e) => {
                                        if (selectedInDiv === divDistIds.length) {
                                          e.currentTarget.style.backgroundColor = "#1F2937";
                                        } else {
                                          e.currentTarget.style.backgroundColor = "#FFFFFF";
                                          e.currentTarget.style.borderColor = "#D1D5DB";
                                          e.currentTarget.style.color = "#374151";
                                        }
                                      }}
                                    >
                                      {selectedInDiv === divDistIds.length
                                        ? "Deselect All"
                                        : "Select All"}
                                    </button>
                                  </div>
                                </InlineStack>

                                <Collapsible open={isOpen} id={divGroup.divisionId}>
                                  <Box paddingBlockStart="200">
                                    <Grid>
                                      {divGroup.districts.map((district) => {
                                        const isChecked = selectedDistricts.includes(
                                          district.id
                                        );
                                        return (
                                          <Grid.Cell
                                            key={district.id}
                                            columnSpan={{
                                              xs: 6,
                                              sm: 6,
                                              md: 4,
                                              lg: 4,
                                              xl: 4,
                                            }}
                                          >
                                            <Checkbox
                                              label={district.name}
                                              checked={isChecked}
                                              onChange={() =>
                                                handleToggleDistrict(district.id)
                                              }
                                            />
                                          </Grid.Cell>
                                        );
                                      })}
                                    </Grid>
                                  </Box>
                                </Collapsible>
                              </BlockStack>
                            </Card>
                          </div>
                        );
                      })}
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* Configured Shipping Zones Matrix (IndexTable) */}
          <Layout.Section>
            <Card padding="500">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">
                      Active Delivery Charge Rules
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      আপনার সেভ করা ডেলিভারি জোন এবং শিপিং রুলসের তালিকা। কাস্টমার যখন শপিফাইতে অর্ডার সাবমিট করবেন, তখন তার ঠিকানার সাথে মিলিয়ে এখান থেকে লাইভ ডেলিভারি চার্জ হিসাব করা হবে।
                    </Text>
                  </BlockStack>
                  <span
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300"
                    style={{
                      backgroundColor: "#F1F5F9",
                      color: "#334155",
                      border: "1px solid #CBD5E1",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: "12px",
                      lineHeight: "1.2",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {`${savedZones.length} Zone${savedZones.length === 1 ? "" : "s"} Active`}
                  </span>
                </InlineStack>

                {savedZones.length === 0 ? (
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack align="center" inlineAlign="center" gap="200">
                      <Text as="p" variant="bodyMd" tone="subdued">
                        No custom shipping zones created yet.
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Use the builder above to configure your first zone (e.g. &quot;Inside Dhaka Metro&quot; at ৳70) and map Bangladeshi districts.
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
                            <button
                              type="button"
                              onClick={() => handleLoadZoneForEdit(zone)}
                              className="border border-slate-300 hover:border-slate-500 text-slate-700 px-2.5 py-1 text-xs rounded font-medium transition-colors cursor-pointer bg-white"
                              style={{
                                border: "1px solid #CBD5E1",
                                color: "#334155",
                                backgroundColor: "#FFFFFF",
                                borderRadius: "6px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "all 0.15s ease-in-out",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = "#94A3B8";
                                e.currentTarget.style.backgroundColor = "#F8FAFC";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = "#CBD5E1";
                                e.currentTarget.style.backgroundColor = "#FFFFFF";
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteZone(zone.id)}
                              className="border border-slate-300 hover:border-slate-500 text-slate-600 hover:text-slate-900 px-2.5 py-1 text-xs rounded font-medium transition-colors cursor-pointer bg-white"
                              style={{
                                border: "1px solid #CBD5E1",
                                color: "#475569",
                                backgroundColor: "#FFFFFF",
                                borderRadius: "6px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "all 0.15s ease-in-out",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = "#94A3B8";
                                e.currentTarget.style.color = "#0F172A";
                                e.currentTarget.style.backgroundColor = "#F8FAFC";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = "#CBD5E1";
                                e.currentTarget.style.color = "#475569";
                                e.currentTarget.style.backgroundColor = "#FFFFFF";
                              }}
                            >
                              Delete
                            </button>
                          </InlineStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </div>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
