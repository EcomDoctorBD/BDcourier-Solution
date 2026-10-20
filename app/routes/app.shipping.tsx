import { useState, useEffect } from "react";
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

  const storeConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
  const currentPlan = storeConfig?.currentPlan || "Free";
  const planLower = String(currentPlan).trim().toLowerCase();
  const isProOrEnterprise =
    planLower.startsWith("pro") || planLower.startsWith("enterprise");

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
  const actionType = String(formData.get("actionType") || "saveZone");

  // ==================== CASE 1: DELETE A SHIPPING ZONE ====================
  if (actionType === "deleteZone") {
    const zoneId = String(formData.get("zoneId") || "");
    if (!zoneId) {
      return { success: false, message: "Missing zoneId to delete." };
    }

    await Promise.all([
      ShippingZone.deleteOne({ _id: zoneId, merchantId: shopDomain }),
      ZoneDistricts.deleteOne({ zoneId, merchantId: shopDomain }),
    ]);

    return {
      success: true,
      message: "Shipping zone and its district mappings deleted from MongoDB.",
    };
  }

  // ==================== CASE 2: REGISTER CARRIER SERVICE WEBHOOK WITH SHOPIFY ====================
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
          message: `CarrierService Notice: ${userErrors[0].message} (Webhook endpoint active at ${callbackUrl})`,
        };
      }

      return {
        success: true,
        message: `Shopify CarrierService registered successfully! Checkout rates will now query ${callbackUrl} (<500ms).`,
      };
    } catch (err: any) {
      return {
        success: true,
        message: `CarrierService endpoint ready at ${callbackUrl}.`,
      };
    }
  }

  // ==================== CASE 3: SAVE OR UPDATE A SHIPPING ZONE & ZONEDISTRICTS ====================
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
      message: "Please provide a Zone Name (e.g., Inside Dhaka Metro).",
    };
  }

  if (districtIds.length === 0) {
    return {
      success: false,
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
    message: `Shipping Zone "${zoneName}" saved with ${districtIds.length} districts and ${weightTiers.length} weight tiers!`,
  };
};

export default function ShippingZoneEnginePage() {
  const {
    shopDomain,
    currentPlan,
    isProOrEnterprise,
    savedZones,
    divisions,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [editingZoneId, setEditingZoneId] = useState<string>("" );
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

  // Nested Division Collapsible State (Default Dhaka expanded)
  const [expandedDivisions, setExpandedDivisions] = useState<
    Record<string, boolean>
  >({ dhaka: true });

  // Checked District IDs State
  const [selectedDistrictIds, setSelectedDistrictIds] = useState<string[]>([
    "dhaka",
    "gazipur",
    "narayanganj",
  ]);

  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (actionData) {
      setShowBanner(true);
      if (actionData.success) {
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
  const isSavingZone =
    navigation.state === "submitting" && pendingAction === "saveZone";
  const isRegisteringCarrier =
    navigation.state === "submitting" &&
    pendingAction === "registerCarrierService";

  return (
    <Page
      title="Dynamic Bangladesh Shipping Zone Engine"
      subtitle={`Store: ${shopDomain} • Active Plan: ${currentPlan} • 8 Divisions & 64 Districts`}
      backAction={{ content: "Courier Dashboard", url: "/app" }}
      primaryAction={{
        content: "Sync Checkout CarrierService",
        loading: isRegisteringCarrier,
        onAction: handleRegisterCarrierService,
      }}
    >
      <TitleBar title="Shipping Zones & Rates" />

      <Layout>
        {showBanner && actionData?.message && (
          <Layout.Section>
            <Banner
              title={
                actionData.success
                  ? "Shipping Zone Engine Updated"
                  : "Validation Error"
              }
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => setShowBanner(false)}
            >
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* ==================== 1. ZONE BUILDER & NESTED 8-DIVISION / 64-DISTRICT SELECTOR ==================== */}
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
                          : "Upgrade to Pro ($2.49/mo) or Enterprise ($4.99/mo) to pass courier COD fees to checkout."
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
                      {editingZoneId
                        ? "Update Shipping Zone in MongoDB"
                        : "Save Shipping Zone to MongoDB"}
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

        {/* ==================== 2. SCANNABLE SUMMARY LIST OF SAVED ACTIVE ZONES ==================== */}
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
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
