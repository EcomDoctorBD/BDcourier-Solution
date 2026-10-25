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
  Link,
  useSearchParams,
  useNavigate,
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
  Grid,
  Icon,
  Button,
  Form,
  FormLayout,
  TextField,
  InlineStack,
  Divider,
  Box,
  Banner,
  ProgressBar,
  Modal,
  Select,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { CourierLogo } from "../components/CourierLogo";
import CourierConfig, {
  connectDB,
  decryptCourierConfig,
  encryptSecret,
  ensureWebhookSecret,
} from "../db.server";
import {
  SIX_TIER_PRICING_PLANS,
  getPricingTier,
  type PricingTierConfig,
} from "../pricing-plans";

/**
 * Custom Polaris-compatible SVG Icon source so <Icon /> works
 * without requiring extra icon packages.
 */
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

function CheckFeatureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="16"
      height="16"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * 1. SERVER LOADER: Fetches CourierConfig and Subscription Status from MongoDB
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const rawStoreConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
  const storeConfig = decryptCourierConfig(rawStoreConfig);
  const webhookSecret = await ensureWebhookSecret(
    shopDomain,
    storeConfig?.webhookSecret
  );

  const currentPlan = String(storeConfig?.currentPlan || "Free");
  const monthlyOrderCount = Number(storeConfig?.monthlyOrderCount ?? 0);
  const billingStatus = String(storeConfig?.billingStatus || "ACTIVE");

  const tier = getPricingTier(currentPlan);
  const orderLimit = tier.orderLimit;
  const usagePercentage = Math.min(
    100,
    Math.round((monthlyOrderCount / orderLimit) * 100)
  );
  const remainingOrders = Math.max(0, orderLimit - monthlyOrderCount);
  const isAiNormalizerEnabled = Boolean(
    storeConfig?.aiAddressCleaningEnabled ?? true
  );

  return json({
    shopDomain,
    subscription: {
      currentPlan,
      planName: tier.name,
      priceDisplay: tier.priceDisplay,
      orderLimit,
      monthlyOrderCount,
      usagePercentage,
      remainingOrders,
      billingStatus,
      badgeLabel: tier.badgeLabel,
    },
    aiConfig: {
      isAiNormalizerEnabled,
    },
    allPlans: SIX_TIER_PRICING_PLANS,
    courierConfig: {
      shopDomain,
      // Pathao fields
      pathaoEnvironment: storeConfig?.pathaoEnvironment || "production",
      pathaoClientId: storeConfig?.pathaoClientId || "",
      pathaoSecret: storeConfig?.pathaoSecret || "",
      pathaoUsername: storeConfig?.pathaoUsername || "",
      pathaoPassword: storeConfig?.pathaoPassword || "",
      pathaoStoreId: storeConfig?.pathaoStoreId || "",
      pathaoStoreName: storeConfig?.pathaoStoreName || "",
      // Steadfast fields
      steadfastApiKey: storeConfig?.steadfastApiKey || "",
      steadfastSecretKey: storeConfig?.steadfastSecretKey || "",
      // RedX fields
      redxEnvironment: storeConfig?.redxEnvironment || "production",
      redxAccessToken: storeConfig?.redxAccessToken || "",
      redxPickupStoreId: storeConfig?.redxPickupStoreId || storeConfig?.redxLocationId || "",
      redxPickupStoreName: storeConfig?.redxPickupStoreName || "",
      redxProfileId: storeConfig?.redxProfileId || "",
      redxLocationId: storeConfig?.redxLocationId || storeConfig?.redxPickupStoreId || "",
      webhookSecret,
    },
  });
};

/**
 * 2. SERVER ACTION: Handles Courier Credentials & Quick Plan Switching
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "");

  if (actionType === "switchPlan") {
    const targetPlan = String(formData.get("targetPlan") || "Free");
    const matchedTier = getPricingTier(targetPlan);

    // Paid tiers CANNOT be directly activated from the Dashboard without Shopify Billing
    if (matchedTier.price > 0) {
      return json({
        success: false,
        actionType: "switchPlan",
        redirectToBilling: true,
        message: `Upgrades to ${matchedTier.name} must be approved via Shopify Billing on the Pricing page.`,
      });
    }

    // Free plan ($0.00/mo): Cancel any active recurring subscriptions via Shopify GraphQL
    try {
      const activeSubsQuery = `#graphql
        query GetActiveSubscriptions {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
            }
          }
        }
      `;
      const subsRes = await admin.graphql(activeSubsQuery);
      const subsData: any = await subsRes.json();
      const activeSubs =
        subsData?.data?.currentAppInstallation?.activeSubscriptions || [];

      for (const sub of activeSubs) {
        if (sub.status === "ACTIVE" && sub.id) {
          const cancelMutation = `#graphql
            mutation CancelAppSubscription($id: ID!) {
              appSubscriptionCancel(id: $id) {
                appSubscription {
                  id
                  status
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          await admin.graphql(cancelMutation, { variables: { id: sub.id } });
        }
      }
    } catch (cancelErr) {
      console.warn(
        "[Dashboard Billing] Error cancelling subscription on Free downgrade:",
        cancelErr
      );
    }

    // Set plan to Free in MongoDB (preserving monthlyOrderCount to prevent quota reset abuse)
    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          shopDomain,
          currentPlan: "Free",
          billingStatus: "FREE PLAN ($0.00/mo)",
          shopifySubscriptionId: "",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return json({
      success: true,
      actionType: "switchPlan",
      message:
        "Switched to Free Plan (120 orders/month). Active recurring Shopify billing charges have been cancelled.",
    });
  }

  let updateFields: Record<string, any> = {};
  let courierLabel = "";
  let isFullyConfigured = false;

  if (actionType === "savePathao") {
    const pathaoEnvironment = String(formData.get("pathaoEnvironment") || "production").trim();
    const pathaoClientId = String(formData.get("pathaoClientId") || "").trim();
    const pathaoSecret = String(formData.get("pathaoSecret") || "").trim();
    const pathaoUsername = String(formData.get("pathaoUsername") || "").trim();
    const pathaoPassword = String(formData.get("pathaoPassword") || "").trim();
    const pathaoStoreId = String(formData.get("pathaoStoreId") || "").trim();

    updateFields = {
      pathaoEnvironment: pathaoEnvironment === "sandbox" ? "sandbox" : "production",
      pathaoClientId,
      pathaoUsername,
      pathaoStoreId,
    };
    if (pathaoSecret) updateFields.pathaoSecret = encryptSecret(pathaoSecret);
    if (pathaoPassword) updateFields.pathaoPassword = encryptSecret(pathaoPassword);

    courierLabel = "Pathao Courier";
    isFullyConfigured = Boolean(
      pathaoClientId && pathaoSecret && pathaoStoreId
    );
  } else if (actionType === "saveSteadfast") {
    const steadfastApiKey = String(
      formData.get("steadfastApiKey") || ""
    ).trim();
    const steadfastSecretKey = String(
      formData.get("steadfastSecretKey") || ""
    ).trim();

    updateFields = {
      steadfastApiKey,
    };
    if (steadfastSecretKey) updateFields.steadfastSecretKey = encryptSecret(steadfastSecretKey);

    courierLabel = "Steadfast Courier";
    isFullyConfigured = Boolean(steadfastApiKey && steadfastSecretKey);
  } else if (actionType === "saveRedX") {
    const redxEnvironment = String(formData.get("redxEnvironment") || "production").trim();
    const redxAccessToken = String(formData.get("redxAccessToken") || "").trim();
    const redxPickupStoreId = String(formData.get("redxPickupStoreId") || "").trim();
    const redxProfileId = String(formData.get("redxProfileId") || "").trim();
    const redxLocationId = String(formData.get("redxLocationId") || "").trim();

    const pickupId = redxPickupStoreId || redxLocationId;
    const profileId = redxProfileId || pickupId;

    updateFields = {
      redxEnvironment: redxEnvironment === "sandbox" ? "sandbox" : "production",
      redxPickupStoreId: pickupId,
      redxProfileId: profileId,
      redxLocationId: pickupId,
    };
    if (redxAccessToken) updateFields.redxAccessToken = encryptSecret(redxAccessToken);

    courierLabel = "RedX Delivery";
    isFullyConfigured = Boolean(
      (redxAccessToken && pickupId) || (redxProfileId && redxLocationId)
    );
  } else {
    return json({
      success: false,
      actionType,
      message: "Invalid action submitted.",
    });
  }

  // Upsert all submitted fields into MongoDB
  await CourierConfig.findOneAndUpdate(
    { shopDomain },
    {
      $set: {
        shopDomain,
        ...updateFields,
      },
    },
    {
      returnDocument: "after",
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return json({
    success: true,
    actionType,
    message: isFullyConfigured
      ? `${courierLabel} credentials saved and connected successfully.`
      : `${courierLabel} configuration updated (some fields were left blank).`,
  });
};

export default function CourierDashboard() {
  const { shopDomain, subscription, aiConfig, allPlans, courierConfig } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Search string to preserve shop and host across in-app links
  const searchStr = searchParams.toString() ? `?${searchParams.toString()}` : "";

  // Modal State for Subscription Plans
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

  // Courier Forms Visibility States
  const [showPathaoForm, setShowPathaoForm] = useState(false);
  const [showSteadfastForm, setShowSteadfastForm] = useState(false);
  const [showRedxForm, setShowRedxForm] = useState(false);

  // Pathao Input States
  const [pathaoEnvironment, setPathaoEnvironment] = useState(
    courierConfig.pathaoEnvironment || "production"
  );
  const [pathaoClientId, setPathaoClientId] = useState(
    courierConfig.pathaoClientId
  );
  const [pathaoSecret, setPathaoSecret] = useState(courierConfig.pathaoSecret);
  const [pathaoUsername, setPathaoUsername] = useState(
    courierConfig.pathaoUsername || ""
  );
  const [pathaoPassword, setPathaoPassword] = useState(
    courierConfig.pathaoPassword || ""
  );
  const [pathaoStoreId, setPathaoStoreId] = useState(
    courierConfig.pathaoStoreId
  );
  const [showPathaoSecret, setShowPathaoSecret] = useState(false);
  const [showPathaoPassword, setShowPathaoPassword] = useState(false);

  // Steadfast Input States
  const [steadfastApiKey, setSteadfastApiKey] = useState(
    courierConfig.steadfastApiKey
  );
  const [steadfastSecretKey, setSteadfastSecretKey] = useState(
    courierConfig.steadfastSecretKey
  );
  const [showSteadfastSecret, setShowSteadfastSecret] = useState(false);

  // RedX Input States
  const [redxEnvironment, setRedxEnvironment] = useState(
    courierConfig.redxEnvironment || "production"
  );
  const [redxAccessToken, setRedxAccessToken] = useState(
    courierConfig.redxAccessToken || ""
  );
  const [redxPickupStoreId, setRedxPickupStoreId] = useState(
    courierConfig.redxPickupStoreId || courierConfig.redxLocationId || ""
  );
  const [redxProfileId, setRedxProfileId] = useState(
    courierConfig.redxProfileId
  );
  const [redxLocationId, setRedxLocationId] = useState(
    courierConfig.redxLocationId || courierConfig.redxPickupStoreId || ""
  );
  const [showRedxToken, setShowRedxToken] = useState(false);

  // Feedback Banner
  const [showBanner, setShowBanner] = useState(false);

  // Sync inputs when loader data changes
  useEffect(() => {
    setPathaoEnvironment(courierConfig.pathaoEnvironment || "production");
    setPathaoClientId(courierConfig.pathaoClientId);
    setPathaoSecret(courierConfig.pathaoSecret);
    setPathaoUsername(courierConfig.pathaoUsername || "");
    setPathaoPassword(courierConfig.pathaoPassword || "");
    setPathaoStoreId(courierConfig.pathaoStoreId);

    setSteadfastApiKey(courierConfig.steadfastApiKey);
    setSteadfastSecretKey(courierConfig.steadfastSecretKey);

    setRedxEnvironment(courierConfig.redxEnvironment || "production");
    setRedxAccessToken(courierConfig.redxAccessToken || "");
    setRedxPickupStoreId(courierConfig.redxPickupStoreId || courierConfig.redxLocationId || "");
    setRedxProfileId(courierConfig.redxProfileId);
    setRedxLocationId(courierConfig.redxLocationId || courierConfig.redxPickupStoreId || "");
  }, [
    courierConfig.pathaoEnvironment,
    courierConfig.pathaoClientId,
    courierConfig.pathaoSecret,
    courierConfig.pathaoUsername,
    courierConfig.pathaoPassword,
    courierConfig.pathaoStoreId,
    courierConfig.steadfastApiKey,
    courierConfig.steadfastSecretKey,
    courierConfig.redxEnvironment,
    courierConfig.redxAccessToken,
    courierConfig.redxPickupStoreId,
    courierConfig.redxProfileId,
    courierConfig.redxLocationId,
  ]);

  useEffect(() => {
    if (actionData?.message) {
      setShowBanner(true);
      if (actionData.success) {
        if (actionData.actionType === "savePathao") setShowPathaoForm(false);
        if (actionData.actionType === "saveSteadfast") setShowSteadfastForm(false);
        if (actionData.actionType === "saveRedX") setShowRedxForm(false);
        if (actionData.actionType === "switchPlan") setIsPlanModalOpen(false);
      } else if ((actionData as any)?.redirectToBilling) {
        setIsPlanModalOpen(false);
        navigate(`/app/pricing${searchStr}`);
      }
    }
  }, [actionData, navigate, searchStr]);

  const isPathaoConnected = Boolean(
    courierConfig.pathaoClientId?.trim() &&
      courierConfig.pathaoSecret?.trim() &&
      courierConfig.pathaoStoreId?.trim()
  );

  const isSteadfastConnected = Boolean(
    courierConfig.steadfastApiKey?.trim() &&
      courierConfig.steadfastSecretKey?.trim()
  );

  const isRedxConnected = Boolean(
    (courierConfig.redxAccessToken?.trim() && courierConfig.redxPickupStoreId?.trim()) ||
    (courierConfig.redxProfileId?.trim() && courierConfig.redxLocationId?.trim())
  );

  const activeCount = [
    isPathaoConnected,
    isSteadfastConnected,
    isRedxConnected,
  ].filter(Boolean).length;

  const pendingActionType = navigation.formData?.get("actionType");
  const pendingTargetPlan = navigation.formData?.get("targetPlan");

  const isSubmittingPathao =
    navigation.state === "submitting" && pendingActionType === "savePathao";
  const isSubmittingSteadfast =
    navigation.state === "submitting" && pendingActionType === "saveSteadfast";
  const isSubmittingRedx =
    navigation.state === "submitting" && pendingActionType === "saveRedX";
  const isSwitchingPlan =
    navigation.state === "submitting" && pendingActionType === "switchPlan";

  const handleSavePathao = () => {
    const formData = new FormData();
    formData.append("actionType", "savePathao");
    formData.append("pathaoEnvironment", pathaoEnvironment);
    formData.append("pathaoClientId", pathaoClientId);
    formData.append("pathaoSecret", pathaoSecret);
    formData.append("pathaoUsername", pathaoUsername);
    formData.append("pathaoPassword", pathaoPassword);
    formData.append("pathaoStoreId", pathaoStoreId);
    submit(formData, { method: "post" });
  };

  const handleSaveSteadfast = () => {
    const formData = new FormData();
    formData.append("actionType", "saveSteadfast");
    formData.append("steadfastApiKey", steadfastApiKey);
    formData.append("steadfastSecretKey", steadfastSecretKey);
    submit(formData, { method: "post" });
  };

  const handleSaveRedX = () => {
    const formData = new FormData();
    formData.append("actionType", "saveRedX");
    formData.append("redxEnvironment", redxEnvironment);
    formData.append("redxAccessToken", redxAccessToken);
    formData.append("redxPickupStoreId", redxPickupStoreId);
    formData.append("redxProfileId", redxProfileId || redxPickupStoreId);
    formData.append("redxLocationId", redxPickupStoreId);
    submit(formData, { method: "post" });
  };

  const handleSwitchPlan = (tierId: string, price = 0) => {
    if (price > 0) {
      setIsPlanModalOpen(false);
      navigate(`/app/pricing${searchStr}`);
      return;
    }
    const formData = new FormData();
    formData.append("actionType", "switchPlan");
    formData.append("targetPlan", tierId);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Dashboard"
      subtitle={`Analytics & Overview • Connected Store: ${shopDomain}`}
    >
      <TitleBar title="Dashboard" />

      <BlockStack gap="500">
        {/* Feedback Banner */}
        {showBanner && actionData?.message && (
          <Banner
            title={actionData.message}
            tone={actionData.success ? "success" : "critical"}
            onDismiss={() => setShowBanner(false)}
          />
        )}

        {/* ==================== 1. PREMIUM HERO BANNER & COLORED METRIC CARDS ==================== */}
        <Layout>
          <Layout.Section>
            <Card padding="500">
              <BlockStack gap="500">
                {/* Top Row: Plan Tier Typography + Quick Action Button */}
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        ACTIVE SUBSCRIPTION
                      </Text>
                      <Badge tone="success">
                        {subscription.billingStatus || "ACTIVE"}
                      </Badge>
                      {subscription.badgeLabel && (
                        <Badge tone="info">{subscription.badgeLabel}</Badge>
                      )}
                    </InlineStack>

                    <Text as="h1" variant="headingXl" fontWeight="bold">
                      {subscription.planName}
                    </Text>
                  </BlockStack>

                  <Button
                    variant="primary"
                    size="large"
                    onClick={() => setIsPlanModalOpen(true)}
                  >
                    View Subscription Plans
                  </Button>
                </InlineStack>

                <Divider />

                {/* VISUAL ANCHORS: Colored Summary & Balance Cards */}
                <Grid>
                  {/* Card 1: Monthly Usage & Quota */}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                    <Box
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="300"
                      borderWidth="025"
                      borderColor="border-subdued"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            PLAN USAGE
                          </Text>
                          <Badge
                            tone={
                              subscription.usagePercentage >= 90
                                ? "critical"
                                : subscription.usagePercentage >= 75
                                ? "attention"
                                : "success"
                            }
                          >
                            {`${subscription.usagePercentage}%`}
                          </Badge>
                        </InlineStack>

                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {`${subscription.monthlyOrderCount} / ${subscription.orderLimit}`}
                        </Text>

                        <ProgressBar
                          progress={subscription.usagePercentage}
                          size="small"
                          tone={
                            subscription.usagePercentage >= 90
                              ? "critical"
                              : subscription.usagePercentage >= 75
                              ? "highlight"
                              : "primary"
                          }
                        />

                        <Text as="span" variant="bodySm" tone="subdued">
                          Orders used this billing cycle
                        </Text>
                      </BlockStack>
                    </Box>
                  </Grid.Cell>

                  {/* Card 2: Remaining Order Credits */}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                    <Box
                      padding="400"
                      background="bg-surface-success-subdued"
                      borderRadius="300"
                      borderWidth="025"
                      borderColor="border-subdued"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            ORDER BALANCE
                          </Text>
                          <Badge tone="success">Available</Badge>
                        </InlineStack>

                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {`${subscription.remainingOrders}`}
                        </Text>

                        <Text as="span" variant="bodySm" tone="subdued">
                          Bookings remaining before renewal
                        </Text>
                      </BlockStack>
                    </Box>
                  </Grid.Cell>

                  {/* Card 3: AI Address Correction Status */}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                    <Box
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="300"
                      borderWidth="025"
                      borderColor="border-subdued"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            AI ADDRESS NORMALIZER
                          </Text>
                          <Badge
                            tone={aiConfig.isAiNormalizerEnabled ? "success" : "critical"}
                            progress={aiConfig.isAiNormalizerEnabled ? "complete" : "incomplete"}
                          >
                            {aiConfig.isAiNormalizerEnabled ? "Active" : "Inactive"}
                          </Badge>
                        </InlineStack>

                        <Text as="p" variant="headingMd" fontWeight="semibold">
                          Smart Address Clean
                        </Text>

                        <Text as="span" variant="bodySm" tone="subdued">
                          Auto-cleans addresses upon booking
                        </Text>
                      </BlockStack>
                    </Box>
                  </Grid.Cell>

                  {/* Card 4: Courier Connections Fleet */}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                    <Box
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="300"
                      borderWidth="025"
                      borderColor="border-subdued"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            COURIER FLEET
                          </Text>
                          <Badge tone={activeCount > 0 ? "success" : "attention"}>
                            {`${activeCount} / 3 Connected`}
                          </Badge>
                        </InlineStack>

                        <Text as="p" variant="headingMd" fontWeight="semibold">
                          Pathao • Steadfast • REDX
                        </Text>

                        <Text as="span" variant="bodySm" tone="subdued">
                          Instant one-click dispatch &amp; tracking
                        </Text>
                      </BlockStack>
                    </Box>
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* ==================== 2. QUICK NAVIGATION TILES ==================== */}
        <Layout>
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      📦 Orders
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Bulk order booking, customer fraud scoring, and courier dispatch with smart address cleaning.
                    </Text>
                    <Link to={`/app/orders${searchStr}`}>
                      <Button variant="plain">Open Orders →</Button>
                    </Link>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      ⚙️ Courier Settings
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Configure Pathao, Steadfast, and REDX API credentials and automatic courier selection.
                    </Text>
                    <Link to={`/app/courier-settings${searchStr}`}>
                      <Button variant="plain">Configure Routing →</Button>
                    </Link>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      🚚 Shipping Rates
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Delivery charge rules, custom weight tiers, and checkout rates for all 64 districts.
                    </Text>
                    <Link to={`/app/shipping-rates${searchStr}`}>
                      <Button variant="plain">Manage Rates →</Button>
                    </Link>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      🔌 Integrations
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Stream captured orders to Google Sheets in real-time on dispatch.
                    </Text>
                    <Link to={`/app/integrations${searchStr}`}>
                      <Button variant="plain">Manage Sheets →</Button>
                    </Link>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>
        </Layout>

        {/* ==================== 3. COURIER PARTNER CONNECTION OVERVIEW ==================== */}
        <Layout>
          <Layout.Section>
            <Card padding="500">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Box>
                      <Icon
                        source={CourierTruckIcon}
                        tone={activeCount > 0 ? "success" : "subdued"}
                      />
                    </Box>
                    <Text as="h2" variant="headingMd">
                      Delivery Partner Connections
                    </Text>
                  </InlineStack>

                  <Badge
                    tone={activeCount > 0 ? "success" : undefined}
                    progress={activeCount > 0 ? "complete" : "incomplete"}
                  >
                    {`${activeCount} of 3 Couriers Connected`}
                  </Badge>
                </InlineStack>

                <Text as="p" variant="bodyMd" tone="subdued">
                  Connect your official Bangladeshi courier merchant credentials
                  below to automate parcel bookings, tracking label generation,
                  and cash-on-delivery synchronization.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* 3-Column Courier Integration Cards */}
          <Layout.Section>
            <Grid>
              {/* 1. Pathao Courier Card */}
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
                        tone={isPathaoConnected ? "success" : undefined}
                        progress={
                          isPathaoConnected ? "complete" : "incomplete"
                        }
                      >
                        {isPathaoConnected ? "Connected" : "Not Configured"}
                      </Badge>
                    </InlineStack>

                    <Divider />

                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Automated parcel booking, express delivery, and live
                        consignment tracking with Pathao Merchant API.
                      </Text>

                      <Text as="p" variant="bodySm" tone="subdued">
                        Required: <strong>Client ID, Client Secret, Username, Password, Store ID</strong>
                      </Text>
                    </BlockStack>

                    <InlineStack align="end">
                      <Button
                        variant={
                          showPathaoForm
                            ? "tertiary"
                            : isPathaoConnected
                            ? "secondary"
                            : "primary"
                        }
                        onClick={() => setShowPathaoForm((prev) => !prev)}
                      >
                        {showPathaoForm
                          ? "Cancel"
                          : isPathaoConnected
                          ? "Update Pathao"
                          : "Configure Pathao"}
                      </Button>
                    </InlineStack>

                    {showPathaoForm && (
                      <>
                        <Divider />
                        <Form onSubmit={handleSavePathao}>
                          <FormLayout>
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
                              placeholder="Enter Pathao Client ID..."
                              autoComplete="off"
                            />
                            <TextField
                              label="Client Secret"
                              type={showPathaoSecret ? "text" : "password"}
                              value={pathaoSecret}
                              onChange={(val) => setPathaoSecret(val)}
                              placeholder="Enter Pathao Client Secret..."
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
                            <TextField
                              label="Store ID"
                              value={pathaoStoreId}
                              onChange={(val) => setPathaoStoreId(val)}
                              placeholder="Enter Pathao Store ID..."
                              autoComplete="off"
                              helpText="For store lookup dropdown, visit Courier Settings page."
                            />
                            <InlineStack align="end">
                              <Button
                                submit
                                variant="primary"
                                loading={isSubmittingPathao}
                              >
                                Save Credentials
                              </Button>
                            </InlineStack>
                          </FormLayout>
                        </Form>
                      </>
                    )}
                  </BlockStack>
                </Card>
              </Grid.Cell>

              {/* 2. Steadfast Courier Card */}
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
                        tone={isSteadfastConnected ? "success" : undefined}
                        progress={
                          isSteadfastConnected ? "complete" : "incomplete"
                        }
                      >
                        {isSteadfastConnected ? "Connected" : "Not Configured"}
                      </Badge>
                    </InlineStack>

                    <Divider />

                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Fast Cash-on-Delivery (COD) fulfillment and nationwide
                        parcel booking across Bangladesh.
                      </Text>

                      <Text as="p" variant="bodySm" tone="subdued">
                        Required: <strong>API Key, Secret Key</strong>
                      </Text>
                    </BlockStack>

                    <InlineStack align="end">
                      <Button
                        variant={
                          showSteadfastForm
                            ? "tertiary"
                            : isSteadfastConnected
                            ? "secondary"
                            : "primary"
                        }
                        onClick={() => setShowSteadfastForm((prev) => !prev)}
                      >
                        {showSteadfastForm
                          ? "Cancel"
                          : isSteadfastConnected
                          ? "Update Steadfast"
                          : "Configure Steadfast"}
                      </Button>
                    </InlineStack>

                    {showSteadfastForm && (
                      <>
                        <Divider />
                        <Form onSubmit={handleSaveSteadfast}>
                          <FormLayout>
                            <TextField
                              label="API Key"
                              value={steadfastApiKey}
                              onChange={(val) => setSteadfastApiKey(val)}
                              placeholder="Enter Steadfast API Key..."
                              autoComplete="off"
                            />
                            <TextField
                              label="Secret Key"
                              type={showSteadfastSecret ? "text" : "password"}
                              value={steadfastSecretKey}
                              onChange={(val) => setSteadfastSecretKey(val)}
                              placeholder="Enter Steadfast Secret Key..."
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
                            <InlineStack align="end">
                              <Button
                                submit
                                variant="primary"
                                loading={isSubmittingSteadfast}
                              >
                                Save Credentials
                              </Button>
                            </InlineStack>
                          </FormLayout>
                        </Form>
                      </>
                    )}
                  </BlockStack>
                </Card>
              </Grid.Cell>

              {/* 3. RedX Delivery Card */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                <Card padding="500">
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <CourierLogo courier="redx" size={44} />
                        <Text as="h3" variant="headingMd">
                          RedX Delivery
                        </Text>
                      </InlineStack>

                      <Badge
                        tone={isRedxConnected ? "success" : undefined}
                        progress={isRedxConnected ? "complete" : "incomplete"}
                      >
                        {isRedxConnected ? "Connected" : "Not Configured"}
                      </Badge>
                    </InlineStack>

                    <Divider />

                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd" tone="subdued">
                        64-district doorstep delivery network with automated
                        pickup scheduling and label generation.
                      </Text>

                      <Text as="p" variant="bodySm" tone="subdued">
                        Required: <strong>API Access Token, Pickup Store ID</strong>
                      </Text>
                    </BlockStack>

                    <InlineStack align="end">
                      <Button
                        variant={
                          showRedxForm
                            ? "tertiary"
                            : isRedxConnected
                            ? "secondary"
                            : "primary"
                        }
                        onClick={() => setShowRedxForm((prev) => !prev)}
                      >
                        {showRedxForm
                          ? "Cancel"
                          : isRedxConnected
                          ? "Update RedX"
                          : "Configure RedX"}
                      </Button>
                    </InlineStack>

                    {showRedxForm && (
                      <>
                        <Divider />
                        <Form onSubmit={handleSaveRedX}>
                          <FormLayout>
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
                              label="API Access Token"
                              type={showRedxToken ? "text" : "password"}
                              value={redxAccessToken}
                              onChange={(val) => setRedxAccessToken(val)}
                              placeholder="Enter REDX API Access Token..."
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
                            <TextField
                              label="Pickup Store ID"
                              value={redxPickupStoreId}
                              onChange={(val) => setRedxPickupStoreId(val)}
                              placeholder="Enter RedX Pickup Store ID..."
                              autoComplete="off"
                              helpText="For pickup store auto-fetch, visit Courier Settings page."
                            />
                            <InlineStack align="end">
                              <Button
                                submit
                                variant="primary"
                                loading={isSubmittingRedx}
                              >
                                Save Credentials
                              </Button>
                            </InlineStack>
                          </FormLayout>
                        </Form>
                      </>
                    )}
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* ==================== 4. SUBSCRIPTION PLANS MODAL ==================== */}
      <Modal
        open={isPlanModalOpen}
        onClose={() => setIsPlanModalOpen(false)}
        title="Subscription & Pricing Plans"
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Text as="p" variant="bodyMd" tone="subdued">
                Select the ideal plan for your monthly shipping volume. All plans include automated dispatch to Pathao, Steadfast, and RedX.
              </Text>
              <Link to={`/app/pricing${searchStr}`}>
                <Button variant="plain">View Detailed Billing Page →</Button>
              </Link>
            </InlineStack>

            <Grid>
              {allPlans.map((tier: PricingTierConfig) => {
                const isCurrent =
                  tier.id.toLowerCase() ===
                  subscription.currentPlan.toLowerCase();

                return (
                  <Grid.Cell
                    key={tier.id}
                    columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}
                  >
                    <Card
                      background={
                        isCurrent
                          ? "bg-surface-secondary"
                          : tier.isMostPopular
                          ? "bg-surface-active"
                          : undefined
                      }
                      padding="400"
                    >
                      <BlockStack gap="300">
                        {/* Header */}
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingMd" fontWeight="bold">
                            {tier.name}
                          </Text>
                          {isCurrent ? (
                            <Badge tone="success">Active</Badge>
                          ) : tier.isMostPopular ? (
                            <Badge tone="attention">Popular</Badge>
                          ) : null}
                        </InlineStack>

                        {/* Price & Quota */}
                        <BlockStack gap="050">
                          <Text as="p" variant="headingLg" fontWeight="bold">
                            {tier.priceDisplay}
                            <Text as="span" variant="bodySm" tone="subdued">
                              /month
                            </Text>
                          </Text>
                          <Badge tone="info">{tier.orderLimitDisplay}</Badge>
                        </BlockStack>

                        <Divider />

                        {/* Key Features */}
                        <BlockStack gap="150">
                          <InlineStack gap="150" blockAlign="center">
                            <Box tone="subdued">
                              <CheckFeatureIcon />
                            </Box>
                            <Text as="span" variant="bodySm">
                              {tier.orderLimitDisplay}
                            </Text>
                          </InlineStack>

                          <InlineStack gap="150" blockAlign="center">
                            <Box tone="subdued">
                              <CheckFeatureIcon />
                            </Box>
                            <Text as="span" variant="bodySm">
                              {tier.coreRouting}
                            </Text>
                          </InlineStack>

                          <InlineStack gap="150" blockAlign="center">
                            <Box tone="subdued">
                              <CheckFeatureIcon />
                            </Box>
                            <Text as="span" variant="bodySm">
                              {tier.bulkLimit}
                            </Text>
                          </InlineStack>

                          <InlineStack gap="150" blockAlign="center">
                            <Box tone="subdued">
                              <CheckFeatureIcon />
                            </Box>
                            <Text as="span" variant="bodySm">
                              {tier.fraudProtection}
                            </Text>
                          </InlineStack>
                        </BlockStack>

                        <Divider />

                        {/* Action Button */}
                        {isCurrent ? (
                          <Button disabled fullWidth>
                            Current Active Plan
                          </Button>
                        ) : (
                          <Button
                            variant={tier.isMostPopular ? "primary" : "secondary"}
                            fullWidth
                            loading={
                              isSwitchingPlan &&
                              pendingTargetPlan === tier.id
                            }
                            onClick={() => handleSwitchPlan(tier.id, tier.price)}
                          >
                            {tier.price > 0
                              ? `Upgrade to ${tier.name} →`
                              : `Switch to ${tier.name}`}
                          </Button>
                        )}
                      </BlockStack>
                    </Card>
                  </Grid.Cell>
                );
              })}
            </Grid>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
