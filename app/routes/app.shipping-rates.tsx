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

  return json({
    shopDomain,
    savedZones,
    currentPlan: storeConfig?.currentPlan || "Free",
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

    return json({
      success: true,
      actionType: "deleteZone",
      message: "Shipping zone and its district mappings deleted from MongoDB.",
    });
  }

  // ==================== 2. REGISTER CARRIER SERVICE WITH SHOPIFY ====================
  if (actionType === "registerCarrierService") {
    const appBaseUrl =
      process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    const callbackUrl = `${appBaseUrl.replace(/\/$/, "")}/api/shipping-rates?shop=${encodeURIComponent(shopDomain)}`;

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
      let carrierServiceId =
        result?.data?.carrierServiceCreate?.carrierService?.id;

      // Step 1: Fallback to existing carrier service if already created or userErrors indicate duplicate
      if (!carrierServiceId || userErrors.length > 0) {
        const GET_CARRIER_SERVICES = `#graphql
          query GetCarrierServices {
            carrierServices(first: 10) {
              edges {
                node {
                  id
                  name
                  callbackUrl
                }
              }
            }
          }
        `;
        const existingRes = await admin.graphql(GET_CARRIER_SERVICES);
        const existingJson: any = await existingRes.json();
        const edges = existingJson?.data?.carrierServices?.edges || [];
        const found = edges.find(
          ({ node }: any) =>
            node.name === "BD Dynamic Courier Shipping Rates" ||
            node.callbackUrl === callbackUrl ||
            (node.callbackUrl && node.callbackUrl.includes("/api/shipping-rates"))
        );

        if (found?.node?.id) {
          carrierServiceId = found.node.id;

          // If the registered carrier service has an outdated callbackUrl, sync it now
          if (found.node.callbackUrl !== callbackUrl) {
            const UPDATE_CARRIER_MUTATION = `#graphql
              mutation UpdateBDCarrierService($id: ID!, $input: DeliveryCarrierServiceUpdateInput!) {
                carrierServiceUpdate(id: $id, input: $input) {
                  carrierService {
                    id
                    callbackUrl
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `;
            await admin.graphql(UPDATE_CARRIER_MUTATION, {
              variables: {
                id: carrierServiceId,
                input: {
                  callbackUrl,
                  active: true,
                },
              },
            });
          }
        } else if (userErrors.length > 0) {
          return json({
            success: false,
            actionType: "registerCarrierService",
            message: `CarrierService Error: ${userErrors[0].message} (Webhook endpoint active at ${callbackUrl})`,
          });
        }
      }

      if (!carrierServiceId) {
        return json({
          success: false,
          actionType: "registerCarrierService",
          message: "Unable to create or locate CarrierService ID.",
        });
      }

      // Step 2: Query the General Delivery Profile & Zones
      const GET_GENERAL_PROFILE = `#graphql
        query GetGeneralDeliveryProfile {
          deliveryProfiles(first: 1) {
            edges {
              node {
                id
                profileLocationGroups {
                  locationGroup {
                    id
                  }
                  locationGroupZones(first: 50) {
                    edges {
                      node {
                        zone {
                          id
                          name
                        }
                        methodDefinitions(first: 50) {
                          edges {
                            node {
                              id
                              rateProvider {
                                ... on DeliveryParticipant {
                                  carrierService {
                                    id
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const profileRes = await admin.graphql(GET_GENERAL_PROFILE);
      const profileJson: any = await profileRes.json();
      const profileNode = profileJson?.data?.deliveryProfiles?.edges?.[0]?.node;
      const profileId = profileNode?.id;

      if (!profileId) {
        return json({
          success: true,
          actionType: "registerCarrierService",
          message: `Shopify CarrierService active (${carrierServiceId}), but no general shipping profile was found.`,
        });
      }

      // Step 3: Build the DeliveryProfileInput Payload (Preventing Duplicates)
      const locationGroupsToUpdate: any[] = [];
      let totalZonesAttached = 0;
      let alreadyAttachedZonesCount = 0;

      for (const group of profileNode.profileLocationGroups || []) {
        const locationGroupId = group.locationGroup?.id;
        const zonesToUpdate: any[] = [];

        for (const zoneEdge of group.locationGroupZones?.edges || []) {
          const zoneNode = zoneEdge.node;
          const zoneId = zoneNode?.zone?.id;
          if (!zoneId) continue;

          // Check if methodDefinitions already has this carrierServiceId
          const hasCarrier = (zoneNode.methodDefinitions?.edges || []).some(
            ({ node: mNode }: any) =>
              mNode?.rateProvider?.carrierService?.id === carrierServiceId
          );

          if (hasCarrier) {
            alreadyAttachedZonesCount++;
          } else {
            zonesToUpdate.push({
              id: zoneId,
              methodDefinitionsToCreate: [
                {
                  name: "BD Dynamic Courier Shipping Rates",
                  active: true,
                  participant: {
                    carrierServiceId,
                    adaptToNewServicesFlag: true,
                  },
                },
              ],
            });
            totalZonesAttached++;
          }
        }

        if (zonesToUpdate.length > 0) {
          locationGroupsToUpdate.push({
            id: locationGroupId,
            zonesToUpdate,
          });
        }
      }

      // Step 4: Execute deliveryProfileUpdate Mutation
      if (locationGroupsToUpdate.length > 0) {
        const ATTACH_CARRIER_MUTATION = `#graphql
          mutation AttachCarrierToDeliveryProfile($id: ID!, $profile: DeliveryProfileInput!) {
            deliveryProfileUpdate(id: $id, profile: $profile) {
              profile {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const updateRes = await admin.graphql(ATTACH_CARRIER_MUTATION, {
          variables: {
            id: profileId,
            profile: {
              locationGroupsToUpdate,
            },
          },
        });

        const updateJson: any = await updateRes.json();
        const profileErrors =
          updateJson?.data?.deliveryProfileUpdate?.userErrors || [];

        if (profileErrors.length > 0) {
          return json({
            success: false,
            actionType: "registerCarrierService",
            message: `CarrierService registered, but failed to link to Shipping Profile: ${profileErrors[0].message}`,
          });
        }
      }

      return json({
        success: true,
        actionType: "registerCarrierService",
        message: `Shopify CarrierService registered and automatically linked to General Shipping Profile zones! Checkout rates will now query ${callbackUrl} (<500ms).`,
      });
    } catch (err: any) {
      return json({
        success: false,
        actionType: "registerCarrierService",
        message: `Failed to register CarrierService: ${err?.message || "Unknown error"}`,
      });
    }
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
        message: "Please specify a Zone Name (e.g. Inside Dhaka Metro, Outside Dhaka).",
      });
    }

    if (districtIds.length === 0) {
      return json({
        success: false,
        actionType: "saveZone",
        message: "Please select at least 1 district from Bangladesh for this shipping zone.",
      });
    }

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

    return json({
      success: true,
      actionType: "saveZone",
      message: `Shipping Zone "${zoneName}" saved with ${districtIds.length} districts and ${weightTiers.length} weight tiers!`,
    });
  }

  return json({
    success: false,
    actionType: "",
    message: "Unknown action submitted.",
  });
};

export default function ShippingRatesPage() {
  const { shopDomain, savedZones, currentPlan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const searchStr = searchParams.toString() ? `?${searchParams.toString()}` : "";

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
    <Page
      title="Shipping Rates"
      subtitle={`Store: ${shopDomain} • Plan: ${currentPlan}`}
      backAction={{ content: "Dashboard", url: `/app${searchStr}` }}
      primaryAction={{
        content: "Sync Checkout CarrierService",
        loading: isRegisteringCarrier,
        onAction: handleRegisterCarrierService,
      }}
    >
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
                            : "Configure Rates & Weight Tiers"}
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
                          <Text as="p" variant="bodySm" tone="subdued">
                            Add incremental weight surcharges for heavier consignments.
                          </Text>
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

                        return (
                          <div key={divGroup.divisionId} className="division-card">
                            <Card padding="300">
                              <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="center">
                                  <Button
                                    variant="plain"
                                    onClick={() =>
                                      handleToggleDivision(divGroup.divisionId)
                                    }
                                  >
                                    <InlineStack gap="200" blockAlign="center">
                                      <Text as="span" variant="bodyMd" fontWeight="bold">
                                        {divGroup.divisionName}
                                      </Text>
                                      <Text as="span" variant="bodySm" tone="subdued">
                                        ({divGroup.bengaliName})
                                      </Text>
                                    </InlineStack>
                                  </Button>

                                  <InlineStack gap="200" blockAlign="center">
                                    <Badge
                                      tone={
                                        selectedInDiv === divDistIds.length
                                          ? "success"
                                          : selectedInDiv > 0
                                          ? "info"
                                          : undefined
                                      }
                                    >
                                      {`${selectedInDiv} / ${divDistIds.length}`}
                                    </Badge>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSelectAllInDivision(divGroup)
                                      }
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
                                        whiteSpace: "nowrap",
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = "#1F2937";
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = "#000000";
                                      }}
                                    >
                                      {selectedInDiv === divDistIds.length
                                        ? "Deselect All"
                                        : "Select All"}
                                    </button>
                                  </InlineStack>
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
                      Configured delivery zones and shipping rules. During Shopify checkout, customer shipping addresses are matched against these zones to calculate real-time delivery charges.
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
