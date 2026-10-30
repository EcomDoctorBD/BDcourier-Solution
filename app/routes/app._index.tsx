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
  InlineStack,
  Divider,
  Box,
  Banner,
  ProgressBar,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { CourierLogo } from "../components/CourierLogo";
import CourierConfig, {
  connectDB,
  decryptCourierConfig,
  encryptSecret,
  ensureWebhookSecret,
  ensureBillingCycleCurrent,
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

  let storeConfig: any = null;
  try {
    await connectDB();
    await ensureBillingCycleCurrent(shopDomain);
    const rawStoreConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
    storeConfig = decryptCourierConfig(rawStoreConfig);
  } catch (err: any) {
    console.warn("⚠️ app._index loader database warning:", err?.message || err);
    storeConfig = decryptCourierConfig(null);
  }

  const currentPlan = String(storeConfig?.currentPlan || "Free");
  const monthlyOrderCount = Number(storeConfig?.monthlyOrderCount ?? 0);
  const rawBillingStatus = String(storeConfig?.billingStatus || "ACTIVE");
  const billingStatus =
    currentPlan.toLowerCase() === "free" &&
    (!rawBillingStatus || rawBillingStatus === "UNINSTALLED")
      ? "ACTIVE"
      : rawBillingStatus;

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

  const MASKED_SECRET = "••••••••";

  const isPathaoConnected = Boolean(
    storeConfig?.pathaoClientId?.trim() &&
      storeConfig?.pathaoSecret?.trim() &&
      storeConfig?.pathaoStoreId?.trim()
  );

  const isSteadfastConnected = Boolean(
    storeConfig?.steadfastApiKey?.trim() &&
      storeConfig?.steadfastSecretKey?.trim()
  );

  const isRedxConnected = Boolean(
    (storeConfig?.redxAccessToken?.trim() &&
      (storeConfig?.redxPickupStoreId?.trim() || storeConfig?.redxLocationId?.trim())) ||
    (storeConfig?.redxProfileId?.trim() &&
      (storeConfig?.redxLocationId?.trim() || storeConfig?.redxPickupStoreId?.trim()))
  );

  const isCarrybeeConnected = Boolean(
    storeConfig?.carrybeeClientId?.trim() &&
      storeConfig?.carrybeeClientSecret?.trim() &&
      storeConfig?.carrybeeClientContext?.trim()
  );

  const isBahokConnected = Boolean(
    storeConfig?.bahokApiKey?.trim() &&
      storeConfig?.bahokApiToken?.trim()
  );

  return json({
    shopDomain,
    subscription: {
      currentPlan,
      planName: tier.name,
      priceDisplay: tier.priceDisplay || (tier.pricing ? `$${tier.pricing.monthly.monthlyRate.toFixed(2)}` : "$0.00"),
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
      isPathaoConnected,
      isSteadfastConnected,
      isRedxConnected,
      isCarrybeeConnected,
      isBahokConnected,
      // Pathao public fields
      pathaoEnvironment: storeConfig?.pathaoEnvironment || "production",
      pathaoClientId: storeConfig?.pathaoClientId || "",
      pathaoSecret: storeConfig?.pathaoSecret ? MASKED_SECRET : "",
      pathaoUsername: storeConfig?.pathaoUsername || "",
      pathaoPassword: storeConfig?.pathaoPassword ? MASKED_SECRET : "",
      pathaoStoreId: storeConfig?.pathaoStoreId || "",
      pathaoStoreName: storeConfig?.pathaoStoreName || "",
      hasPathaoSecret: Boolean(storeConfig?.pathaoSecret),
      hasPathaoPassword: Boolean(storeConfig?.pathaoPassword),
      // Steadfast public fields
      steadfastApiKey: storeConfig?.steadfastApiKey || "",
      steadfastSecretKey: storeConfig?.steadfastSecretKey ? MASKED_SECRET : "",
      hasSteadfastSecretKey: Boolean(storeConfig?.steadfastSecretKey),
      // RedX public fields
      redxEnvironment: storeConfig?.redxEnvironment || "production",
      redxAccessToken: storeConfig?.redxAccessToken ? MASKED_SECRET : "",
      redxPickupStoreId: storeConfig?.redxPickupStoreId || storeConfig?.redxLocationId || "",
      redxPickupStoreName: storeConfig?.redxPickupStoreName || "",
      redxProfileId: storeConfig?.redxProfileId || "",
      redxLocationId: storeConfig?.redxLocationId || storeConfig?.redxPickupStoreId || "",
      hasRedxAccessToken: Boolean(storeConfig?.redxAccessToken),
      // CarryBee public fields
      carrybeeClientId: storeConfig?.carrybeeClientId || "",
      carrybeeStoreId: storeConfig?.carrybeeStoreId || "",
      carrybeeSandbox: Boolean(storeConfig?.carrybeeSandbox),
      hasCarrybeeSecret: Boolean(storeConfig?.carrybeeClientSecret),
      hasCarrybeeContext: Boolean(storeConfig?.carrybeeClientContext),
      // Bahok public fields
      bahokMerchantId: storeConfig?.bahokMerchantId || "",
      bahokApiKey: storeConfig?.bahokApiKey || "",
      hasBahokToken: Boolean(storeConfig?.bahokApiToken),
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
    const tierMonthly = matchedTier.price ?? matchedTier.pricing?.monthly?.monthlyRate ?? 0;
    if (tierMonthly > 0) {
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

  const isMaskedOrEmpty = (val: string) =>
    !val || val.trim() === "" || val.trim() === "••••••••" || /^•+$/.test(val.trim());

  if (actionType === "savePathao") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
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
    if (!isMaskedOrEmpty(pathaoSecret)) {
      updateFields.pathaoSecret = encryptSecret(pathaoSecret);
    } else if (rawExisting?.pathaoSecret) {
      updateFields.pathaoSecret = rawExisting.pathaoSecret;
    }

    if (!isMaskedOrEmpty(pathaoPassword)) {
      updateFields.pathaoPassword = encryptSecret(pathaoPassword);
    } else if (rawExisting?.pathaoPassword) {
      updateFields.pathaoPassword = rawExisting.pathaoPassword;
    }

    courierLabel = "Pathao Courier";
    const effectiveSecret = updateFields.pathaoSecret || rawExisting?.pathaoSecret;
    isFullyConfigured = Boolean(
      pathaoClientId && effectiveSecret && pathaoStoreId
    );
  } else if (actionType === "saveSteadfast") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
    const steadfastApiKey = String(
      formData.get("steadfastApiKey") || ""
    ).trim();
    const steadfastSecretKey = String(
      formData.get("steadfastSecretKey") || ""
    ).trim();

    updateFields = {
      steadfastApiKey,
    };
    if (!isMaskedOrEmpty(steadfastSecretKey)) {
      updateFields.steadfastSecretKey = encryptSecret(steadfastSecretKey);
    } else if (rawExisting?.steadfastSecretKey) {
      updateFields.steadfastSecretKey = rawExisting.steadfastSecretKey;
    }

    courierLabel = "Steadfast Courier";
    const effectiveSecret = updateFields.steadfastSecretKey || rawExisting?.steadfastSecretKey;
    isFullyConfigured = Boolean(steadfastApiKey && effectiveSecret);
  } else if (actionType === "saveRedX") {
    const rawExisting: any = await CourierConfig.findOne({ shopDomain }).lean();
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
    if (!isMaskedOrEmpty(redxAccessToken)) {
      updateFields.redxAccessToken = encryptSecret(redxAccessToken);
    } else if (rawExisting?.redxAccessToken) {
      updateFields.redxAccessToken = rawExisting.redxAccessToken;
    }

    courierLabel = "RedX Delivery";
    const effectiveToken = updateFields.redxAccessToken || rawExisting?.redxAccessToken;
    isFullyConfigured = Boolean(
      (effectiveToken && pickupId) || (profileId && pickupId)
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Search string to preserve shop and host across in-app links
  const searchStr = searchParams.toString() ? `?${searchParams.toString()}` : "";

  // Feedback Banner
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (actionData?.message) {
      setShowBanner(true);
      if (!actionData.success && (actionData as any)?.redirectToBilling) {
        navigate(`/app/pricing${searchStr}`);
      }
    }
  }, [actionData, navigate, searchStr]);

  const isPathaoConnected = Boolean(
    courierConfig.isPathaoConnected ??
      (courierConfig.pathaoClientId?.trim() &&
        (courierConfig.hasPathaoSecret || courierConfig.pathaoSecret?.trim()) &&
        courierConfig.pathaoStoreId?.trim())
  );

  const isSteadfastConnected = Boolean(
    courierConfig.isSteadfastConnected ??
      (courierConfig.steadfastApiKey?.trim() &&
        (courierConfig.hasSteadfastSecretKey || courierConfig.steadfastSecretKey?.trim()))
  );

  const isRedxConnected = Boolean(
    courierConfig.isRedxConnected ??
      (((courierConfig.hasRedxAccessToken || courierConfig.redxAccessToken?.trim()) &&
        courierConfig.redxPickupStoreId?.trim()) ||
        (courierConfig.redxProfileId?.trim() && courierConfig.redxLocationId?.trim()))
  );

  const isCarrybeeConnected = Boolean(
    courierConfig.isCarrybeeConnected ??
      (courierConfig.carrybeeClientId?.trim() &&
        courierConfig.hasCarrybeeSecret &&
        courierConfig.hasCarrybeeContext)
  );

  const isBahokConnected = Boolean(
    courierConfig.isBahokConnected ??
      (courierConfig.bahokApiKey?.trim() &&
        courierConfig.hasBahokToken)
  );

  const activeCount = [
    isPathaoConnected,
    isSteadfastConnected,
    isRedxConnected,
    isCarrybeeConnected,
    isBahokConnected,
  ].filter(Boolean).length;

  return (
    <Page>
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
                        {subscription.currentPlan?.toLowerCase() === "free" &&
                        (!subscription.billingStatus ||
                          subscription.billingStatus === "UNINSTALLED")
                          ? "ACTIVE"
                          : subscription.billingStatus || "ACTIVE"}
                      </Badge>
                    </InlineStack>

                    <Text as="h1" variant="headingXl" fontWeight="bold">
                      {subscription.planName}
                    </Text>
                  </BlockStack>

                  <Button
                    variant="primary"
                    size="large"
                    url={`/app/pricing${searchStr}`}
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
                            tone={aiConfig.isAiNormalizerEnabled ? "success" : "info"}
                            progress={aiConfig.isAiNormalizerEnabled ? "complete" : "incomplete"}
                          >
                            {aiConfig.isAiNormalizerEnabled ? "Active" : "Available in Settings"}
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
                            {`${activeCount} / 5 Connected`}
                          </Badge>
                        </InlineStack>

                        <Text as="p" variant="headingMd" fontWeight="semibold">
                          5 Hub Partners
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
            <div
              className="quick-nav-grid-container"
              style={{ width: "100%" }}
            >
              <style>{`
                .quick-nav-grid-container .Polaris-Grid {
                  align-items: stretch;
                }
                .quick-nav-grid-container .Polaris-Grid-Cell {
                  display: flex;
                  flex-direction: column;
                }
                .quick-nav-grid-container .Polaris-ShadowBevel {
                  height: 100%;
                  display: flex;
                  flex-direction: column;
                  flex: 1;
                }
                .quick-nav-grid-container .Polaris-Box {
                  height: 100%;
                  display: flex;
                  flex-direction: column;
                  flex: 1;
                }
                .quick-nav-grid-container .Polaris-BlockStack {
                  height: 100%;
                  display: flex;
                  flex-direction: column;
                  flex: 1;
                }
              `}</style>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                  <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <Card padding="500">
                      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">
                            📦 Orders
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Bulk order booking, customer fraud scoring, and courier dispatch with smart address cleaning.
                          </Text>
                          <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                            <Link to={`/app/orders${searchStr}`}>
                              <Button variant="plain">Open Orders →</Button>
                            </Link>
                          </div>
                        </BlockStack>
                      </div>
                    </Card>
                  </div>
                </Grid.Cell>

                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                  <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <Card padding="500">
                      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">
                            ⚙️ Courier Settings
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Configure API credentials and automatic courier selection for all 5 courier partners.
                          </Text>
                          <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                            <Link to={`/app/courier-settings${searchStr}`}>
                              <Button variant="plain">Configure Routing →</Button>
                            </Link>
                          </div>
                        </BlockStack>
                      </div>
                    </Card>
                  </div>
                </Grid.Cell>

                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                  <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <Card padding="500">
                      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">
                            🚚 Shipping Rates
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Delivery charge rules, custom weight tiers, and checkout rates for all 64 districts.
                          </Text>
                          <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                            <Link to={`/app/shipping-rates${searchStr}`}>
                              <Button variant="plain">Manage Rates →</Button>
                            </Link>
                          </div>
                        </BlockStack>
                      </div>
                    </Card>
                  </div>
                </Grid.Cell>

                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                  <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <Card padding="500">
                      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">
                            🔌 Integrations
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Stream captured orders to Google Sheets in real-time on dispatch.
                          </Text>
                          <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                            <Link to={`/app/integrations${searchStr}`}>
                              <Button variant="plain">Manage Sheets →</Button>
                            </Link>
                          </div>
                        </BlockStack>
                      </div>
                    </Card>
                  </div>
                </Grid.Cell>
              </Grid>
            </div>
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
                    {`${activeCount} of 5 Couriers Connected`}
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
            <div
              className="courier-grid-container"
              style={{
                alignItems: "stretch",
              }}
            >
              <style>{`
                .courier-grid-container .Polaris-Grid {
                  align-items: stretch;
                }
                .courier-grid-container .Polaris-Grid-Cell {
                  display: flex;
                  flex-direction: column;
                }
                .courier-grid-container .Polaris-ShadowBevel {
                  height: 100%;
                  display: flex;
                  flex-direction: column;
                  flex: 1;
                }
                .courier-grid-container .Polaris-Box {
                  height: 100%;
                  display: flex;
                  flex-direction: column;
                  flex: 1;
                }
                .courier-grid-container .Polaris-BlockStack {
                  height: 100%;
                  display: flex;
                  flex-direction: column;
                  flex: 1;
                }
              `}</style>
              <Grid>
                {/* 1. Pathao Courier Card */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
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

                        <div
                          style={{
                            flexGrow: 1,
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" tone="subdued">
                              Automated parcel booking, express delivery, and live
                              consignment tracking with Pathao Merchant API.
                            </Text>
                          </BlockStack>
                        </div>

                        <div style={{ marginTop: "auto" }}>
                          <InlineStack align="end">
                            <Button
                              url={`/app/courier-settings${searchStr}`}
                              variant={isPathaoConnected ? "secondary" : "primary"}
                            >
                              {isPathaoConnected ? "Update Pathao" : "Configure Pathao"}
                            </Button>
                          </InlineStack>
                        </div>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>

                {/* 2. Steadfast Courier Card */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
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

                        <div
                          style={{
                            flexGrow: 1,
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" tone="subdued">
                              Fast Cash-on-Delivery (COD) fulfillment and nationwide
                              parcel booking across Bangladesh.
                            </Text>
                          </BlockStack>
                        </div>

                        <div style={{ marginTop: "auto" }}>
                          <InlineStack align="end">
                            <Button
                              url={`/app/courier-settings${searchStr}`}
                              variant={isSteadfastConnected ? "secondary" : "primary"}
                            >
                              {isSteadfastConnected ? "Update Steadfast" : "Configure Steadfast"}
                            </Button>
                          </InlineStack>
                        </div>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>

                {/* 3. RedX Delivery Card */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
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

                        <div
                          style={{
                            flexGrow: 1,
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" tone="subdued">
                              64-district doorstep delivery network with automated
                              pickup scheduling and label generation.
                            </Text>
                          </BlockStack>
                        </div>

                        <div style={{ marginTop: "auto" }}>
                          <InlineStack align="end">
                            <Button
                              url={`/app/courier-settings${searchStr}`}
                              variant={isRedxConnected ? "secondary" : "primary"}
                            >
                              {isRedxConnected ? "Update RedX" : "Configure RedX"}
                            </Button>
                          </InlineStack>
                        </div>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>

                {/* 4. CarryBee Card */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <Card padding="500">
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="300" blockAlign="center">
                            <CourierLogo courier="carrybee" size={44} />
                            <Text as="h3" variant="headingMd">
                              CarryBee Logistics
                            </Text>
                          </InlineStack>

                          <Badge
                            tone={isCarrybeeConnected ? "success" : undefined}
                            progress={
                              isCarrybeeConnected ? "complete" : "incomplete"
                            }
                          >
                            {isCarrybeeConnected ? "Connected" : "Not Configured"}
                          </Badge>
                        </InlineStack>

                        <Divider />

                        <div
                          style={{
                            flexGrow: 1,
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" tone="subdued">
                              Tech-first automated logistics network with rapid parcel dispatch and API status sync.
                            </Text>
                          </BlockStack>
                        </div>

                        <div style={{ marginTop: "auto" }}>
                          <InlineStack align="end">
                            <Button
                              url={`/app/courier-settings${searchStr}`}
                              variant={isCarrybeeConnected ? "secondary" : "primary"}
                            >
                              {isCarrybeeConnected ? "Update CarryBee" : "Configure CarryBee"}
                            </Button>
                          </InlineStack>
                        </div>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>

                {/* 5. Bahok Courier Card */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <Card padding="500">
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="300" blockAlign="center">
                            <CourierLogo courier="bahok" size={44} />
                            <Text as="h3" variant="headingMd">
                              Bahok Courier
                            </Text>
                          </InlineStack>

                          <Badge
                            tone={isBahokConnected ? "success" : undefined}
                            progress={
                              isBahokConnected ? "complete" : "incomplete"
                            }
                          >
                            {isBahokConnected ? "Connected" : "Not Configured"}
                          </Badge>
                        </InlineStack>

                        <Divider />

                        <div
                          style={{
                            flexGrow: 1,
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" tone="subdued">
                              Reliable nationwide e-commerce courier service with doorstep delivery across Bangladesh.
                            </Text>
                          </BlockStack>
                        </div>

                        <div style={{ marginTop: "auto" }}>
                          <InlineStack align="end">
                            <Button
                              url={`/app/courier-settings${searchStr}`}
                              variant={isBahokConnected ? "secondary" : "primary"}
                            >
                              {isBahokConnected ? "Update Bahok" : "Configure Bahok"}
                            </Button>
                          </InlineStack>
                        </div>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>
              </Grid>
            </div>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
