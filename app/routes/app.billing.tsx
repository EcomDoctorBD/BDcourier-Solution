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
  Grid,
  Button,
  ProgressBar,
  Divider,
  Box,
  Banner,
  IndexTable,
  Icon,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import CourierConfig, { connectDB, getPlanLimit } from "../db.server";

export interface PricingTier {
  id: "Free" | "Growth" | "Pro" | "Enterprise";
  name: string;
  bengaliTag: string;
  price: number;
  priceDisplay: string;
  orderLimit: number; // -1 represents Unlimited
  orderLimitDisplay: string;
  badgeText?: string;
  description: string;
  features: string[];
}

const PRICING_TIERS: PricingTier[] = [
  {
    id: "Free",
    name: "Free (Moti)",
    bengaliTag: "মটি • Starter Tier",
    price: 0.0,
    priceDisplay: "$0.00",
    orderLimit: 120,
    orderLimitDisplay: "120 orders/month",
    description:
      "Zero-cost entry plan for new Bangladeshi merchants starting with single parcel dispatches.",
    features: [
      "120 orders/month limit",
      "Basic single parcel booking",
      "Pathao, Steadfast & RedX connectivity",
      "Standard consignment tracking ID sync",
      "Standard community support",
    ],
  },
  {
    id: "Growth",
    name: "Growth (Bikash)",
    bengaliTag: "বিকাশ • Best Value",
    price: 0.99,
    priceDisplay: "$0.99",
    orderLimit: 500,
    orderLimitDisplay: "500 orders/month",
    badgeText: "Most Popular",
    description:
      "Built for growing stores needing high-speed bulk booking and fake-order fraud checking filters.",
    features: [
      "500 orders/month limit",
      "One-click bulk parcel booking",
      "Customer phone fraud checking filters",
      "Automated Cash-on-Delivery (COD) sync",
      "Email & merchant chat support",
    ],
  },
  {
    id: "Pro",
    name: "Pro (Agragoti)",
    bengaliTag: "অগ্রগতি • Scaling Brands",
    price: 2.49,
    priceDisplay: "$2.49",
    orderLimit: 2500,
    orderLimitDisplay: "2,500 orders/month",
    description:
      "Designed for multi-warehouse merchants requiring multi-location shipping and priority WhatsApp support.",
    features: [
      "2,500 orders/month limit",
      "Multi-location shipping & pickup hubs",
      "Priority WhatsApp support",
      "Bulk booking & fraud checking filters",
      "Real-time courier status sync",
    ],
  },
  {
    id: "Enterprise",
    name: "Enterprise",
    bengaliTag: "এন্টারপ্রাইজ • Unlimited Scale",
    price: 4.99,
    priceDisplay: "$4.99",
    orderLimit: -1,
    orderLimitDisplay: "Unlimited orders",
    badgeText: "Unlimited",
    description:
      "Full-scale logistics automation with a multi-courier dynamic rule engine and custom invoice templates.",
    features: [
      "Unlimited orders per month",
      "Multi-courier dynamic rule engine",
      "Custom invoice & shipping label templates",
      "Multi-location shipping & fraud filters",
      "Priority WhatsApp & dedicated SLA support",
    ],
  },
];

function CheckCircleIcon(props: SVGProps<SVGSVGElement>) {
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
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const url = new URL(request.url);
  const upgradedPlanParam = url.searchParams.get("upgradedPlan");
  const chargeIdParam = url.searchParams.get("charge_id");

  if (upgradedPlanParam) {
    const matchedTier = PRICING_TIERS.find(
      (t) => t.id.toLowerCase() === upgradedPlanParam.toLowerCase()
    );
    if (matchedTier) {
      await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            shopDomain,
            currentPlan: matchedTier.id,
            billingStatus: "ACTIVE (Shopify Billing Confirmed)",
            billingCycleStart: new Date(),
            ...(chargeIdParam ? { shopifySubscriptionId: chargeIdParam } : {}),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  }

  let storeConfig: any = await CourierConfig.findOne({ shopDomain }).lean();

  if (!storeConfig) {
    const created = await CourierConfig.create({
      shopDomain,
      currentPlan: "Free",
      monthlyOrderCount: 0,
      billingCycleStart: new Date(),
      billingStatus: "ACTIVE",
    });
    storeConfig = created.toObject();
  }

  // Ensure default fields exist on legacy documents
  const activePlanKey = storeConfig.currentPlan || "Free";
  const monthlyOrderCount = Number(storeConfig.monthlyOrderCount ?? 0);
  const billingCycleStart = storeConfig.billingCycleStart
    ? new Date(storeConfig.billingCycleStart).toISOString()
    : new Date().toISOString();

  const connectedCouriersCount = [
    Boolean(
      storeConfig?.pathaoClientId?.trim() &&
        storeConfig?.pathaoSecret?.trim() &&
        storeConfig?.pathaoStoreId?.trim()
    ),
    Boolean(
      storeConfig?.steadfastApiKey?.trim() &&
        storeConfig?.steadfastSecretKey?.trim()
    ),
    Boolean(
      storeConfig?.redxProfileId?.trim() && storeConfig?.redxLocationId?.trim()
    ),
  ].filter(Boolean).length;

  let shopifyBillingStatus = storeConfig.billingStatus || "ACTIVE";

  try {
    const hasBillingObject = Boolean(billing);
    const billingQuery = `#graphql
      query GetActiveSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            test
          }
        }
      }
    `;
    const response = await admin.graphql(billingQuery);
    const result: any = await response.json();
    const activeSubs =
      result?.data?.currentAppInstallation?.activeSubscriptions || [];

    if (activeSubs.length > 0) {
      const latestSub = activeSubs[0];
      shopifyBillingStatus = `${latestSub.status}${
        latestSub.test ? " (Sandbox Test)" : ""
      }`;
    } else if (hasBillingObject) {
      shopifyBillingStatus =
        activePlanKey === "Free"
          ? "FREE TIER ($0.00/mo)"
          : `${storeConfig.billingStatus || "ACTIVE"}`;
    }
  } catch {
    // Fallback to MongoDB billingStatus
  }

  const currentTier =
    PRICING_TIERS.find(
      (t) => t.id.toLowerCase() === String(activePlanKey).toLowerCase()
    ) || PRICING_TIERS[0];

  const rawMaxLimit = getPlanLimit(currentTier.id);
  const isUnlimited = !Number.isFinite(rawMaxLimit);
  const maxLimit = isUnlimited ? -1 : rawMaxLimit;

  const usagePercentage = isUnlimited
    ? 10
    : Math.min(100, Math.round((monthlyOrderCount / maxLimit) * 100));

  const remainingBookings = isUnlimited
    ? -1
    : Math.max(0, maxLimit - monthlyOrderCount);

  const isLimitReached = !isUnlimited && monthlyOrderCount >= maxLimit;

  return {
    shopDomain,
    connectedCouriersCount,
    justUpgraded: Boolean(upgradedPlanParam),
    subscription: {
      currentPlan: currentTier.id,
      planDisplayName: currentTier.name,
      priceDisplay: currentTier.priceDisplay,
      monthlyOrderCount,
      maxLimit,
      isUnlimited,
      usagePercentage,
      remainingBookings,
      isLimitReached,
      billingCycleStart,
      billingStatus: shopifyBillingStatus,
    },
    tiers: PRICING_TIERS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const formData = await request.formData();
  const targetPlanId = String(formData.get("planId") || "");

  const selectedTier = PRICING_TIERS.find(
    (t) => t.id.toLowerCase() === targetPlanId.toLowerCase()
  );

  if (!selectedTier) {
    return {
      success: false,
      confirmationUrl: null,
      message: "Invalid subscription tier selected.",
    };
  }

  if (selectedTier.price === 0) {
    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          shopDomain,
          currentPlan: selectedTier.id,
          billingCycleStart: new Date(),
          billingStatus: "FREE TIER ($0.00/mo)",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      success: true,
      confirmationUrl: null,
      message: `Switched your store subscription to ${selectedTier.name} (${selectedTier.priceDisplay}/mo — ${selectedTier.orderLimitDisplay} limit).`,
    };
  }

  const appBaseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const returnUrl = `${appBaseUrl}/app/billing?upgradedPlan=${selectedTier.id}`;

  const CREATE_SUBSCRIPTION_MUTATION = `#graphql
    mutation CreateAppSubscription(
      $name: String!
      $returnUrl: URL!
      $test: Boolean!
      $amount: Decimal!
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        test: $test
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: $amount, currencyCode: USD }
                interval: EVERY_30_DAYS
              }
            }
          }
        ]
      ) {
        userErrors {
          field
          message
        }
        confirmationUrl
        appSubscription {
          id
          name
          status
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
      variables: {
        name: `BD Courier Automation - ${selectedTier.name}`,
        returnUrl,
        test: true,
        amount: selectedTier.price,
      },
    });

    const result: any = await response.json();
    const payload = result?.data?.appSubscriptionCreate;
    const confirmationUrl = payload?.confirmationUrl;
    const subscriptionId = payload?.appSubscription?.id || "";

    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          shopDomain,
          currentPlan: selectedTier.id,
          billingCycleStart: new Date(),
          billingStatus: confirmationUrl
            ? "PENDING_CONFIRMATION"
            : "ACTIVE (Sandbox Mode)",
          shopifySubscriptionId: subscriptionId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (confirmationUrl) {
      return {
        success: true,
        confirmationUrl,
        message: `Redirecting to Shopify Billing Portal to approve ${selectedTier.name} (${selectedTier.priceDisplay}/mo)...`,
      };
    }

    const userErrorMsg =
      payload?.userErrors?.[0]?.message ||
      result?.errors?.[0]?.message ||
      null;

    return {
      success: true,
      confirmationUrl: null,
      message: userErrorMsg
        ? `Plan updated to ${selectedTier.name} (${selectedTier.priceDisplay}/mo — ${selectedTier.orderLimitDisplay}) in MongoDB! (Shopify Sandbox Note: ${userErrorMsg})`
        : `Successfully upgraded to ${selectedTier.name} (${selectedTier.priceDisplay}/mo — ${selectedTier.orderLimitDisplay})!`,
    };
  } catch {
    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          shopDomain,
          currentPlan: selectedTier.id,
          billingCycleStart: new Date(),
          billingStatus: "ACTIVE (Sandbox Mode)",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      success: true,
      confirmationUrl: null,
      message: `Plan updated to ${selectedTier.name} (${selectedTier.priceDisplay}/mo — ${selectedTier.orderLimitDisplay}) in Sandbox Mode.`,
    };
  }
};

export default function SubscriptionBillingPage() {
  const {
    shopDomain,
    connectedCouriersCount,
    justUpgraded,
    subscription,
    tiers,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [showBanner, setShowBanner] = useState(false);
  const [limitAlertDismissed, setLimitAlertDismissed] = useState(false);

  useEffect(() => {
    if (actionData) {
      setShowBanner(true);
      if (actionData.confirmationUrl) {
        window.open(actionData.confirmationUrl, "_top");
      }
    }
  }, [actionData]);

  useEffect(() => {
    if (subscription.isLimitReached) {
      setLimitAlertDismissed(false);
    }
  }, [subscription.isLimitReached, subscription.monthlyOrderCount]);

  const submittingPlanId = navigation.formData?.get("planId");

  const handleSelectPlan = (planId: string) => {
    const formData = new FormData();
    formData.append("planId", planId);
    submit(formData, { method: "post" });
  };

  const comparisonRows = [
    {
      feature: "Monthly Order Booking Limit",
      free: "120 orders/month",
      growth: "500 orders/month",
      pro: "2,500 orders/month",
      enterprise: "Unlimited orders",
    },
    {
      feature: "Parcel Booking Mode",
      free: "Basic single parcel booking",
      growth: "Bulk booking",
      pro: "Bulk booking + Automation",
      enterprise: "Unlimited bulk booking",
    },
    {
      feature: "Fraud Checking Filters",
      free: "—",
      growth: "Included",
      pro: "Included",
      enterprise: "Advanced Fraud Guard",
    },
    {
      feature: "Multi-Location Shipping",
      free: "Single location",
      growth: "Single location",
      pro: "Multi-location shipping",
      enterprise: "Multi-location shipping",
    },
    {
      feature: "Courier Routing Engine",
      free: "Manual courier select",
      growth: "Manual courier select",
      pro: "Standard zone presets",
      enterprise: "Multi-courier dynamic rule engine",
    },
    {
      feature: "Invoice & Label Customization",
      free: "Standard courier label",
      growth: "Standard courier label",
      pro: "Standard courier label",
      enterprise: "Custom invoice templates",
    },
    {
      feature: "Merchant Support",
      free: "Community support",
      growth: "Email & chat support",
      pro: "Priority WhatsApp support",
      enterprise: "Priority WhatsApp + Dedicated SLA",
    },
  ];

  const cycleStartFormatted = new Date(
    subscription.billingCycleStart
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Page
      title="Subscription Plans & Usage Quota"
      subtitle={`Store: ${shopDomain} • ${connectedCouriersCount} of 3 Couriers Connected`}
      backAction={{ content: "Courier Dashboard", url: "/app" }}
    >
      <TitleBar title="Pricing & Billing" />

      <Layout>
        {/* CRITICAL BANNER WHEN MONTHLY ORDER LIMIT IS REACHED */}
        {subscription.isLimitReached && !limitAlertDismissed && (
          <Layout.Section>
            <Banner
              title="Monthly Order Booking Limit Reached!"
              tone="critical"
              onDismiss={() => setLimitAlertDismissed(true)}
            >
              <p>
                You have used{" "}
                <strong>
                  {subscription.monthlyOrderCount} / {subscription.maxLimit}
                </strong>{" "}
                order bookings allowed on your{" "}
                <strong>{subscription.planDisplayName}</strong> plan this
                month. New courier dispatches are currently paused. Please
                upgrade to a higher tier below to immediately unlock more
                order capacity.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Action Feedback Banner */}
        {showBanner && actionData?.message && (
          <Layout.Section>
            <Banner
              title="Subscription Update"
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => setShowBanner(false)}
            >
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Return Confirmation Banner from Shopify Billing Portal */}
        {justUpgraded && !showBanner && (
          <Layout.Section>
            <Banner
              title={`Your store is now subscribed to ${subscription.planDisplayName}!`}
              tone="success"
            >
              <p>
                Your monthly order booking quota and billing status have been
                synced with MongoDB and Shopify Billing.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* 1. HIGH-VISIBILITY CURRENT PLAN & USAGE PROGRESS BAR CARD */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingLg">
                      {`Active Plan: ${subscription.planDisplayName}`}
                    </Text>
                    <Badge
                      tone={
                        subscription.isLimitReached ? "critical" : "success"
                      }
                    >
                      {subscription.isLimitReached
                        ? "LIMIT REACHED"
                        : subscription.billingStatus}
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Billing Rate:{" "}
                    <strong>{`${subscription.priceDisplay} / mo`}</strong> •
                    Cycle Started: <strong>{cycleStartFormatted}</strong>
                  </Text>
                </BlockStack>

                <Box>
                  <Badge
                    tone={
                      subscription.isUnlimited
                        ? "success"
                        : subscription.isLimitReached
                        ? "critical"
                        : subscription.usagePercentage >= 80
                        ? "warning"
                        : "info"
                    }
                  >
                    {subscription.isUnlimited
                      ? "Unlimited Monthly Capacity"
                      : `${subscription.remainingBookings.toLocaleString()} Bookings Remaining`}
                  </Badge>
                </Box>
              </InlineStack>

              <Divider />

              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="headingMd" fontWeight="bold">
                    {subscription.isUnlimited
                      ? `${subscription.monthlyOrderCount.toLocaleString()} / Unlimited orders used this month`
                      : `${subscription.monthlyOrderCount.toLocaleString()} / ${subscription.maxLimit.toLocaleString()} orders used this month`}
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="bold">
                    {subscription.isUnlimited
                      ? "Unlimited"
                      : `${subscription.usagePercentage}% Used`}
                  </Text>
                </InlineStack>

                <ProgressBar
                  progress={subscription.usagePercentage}
                  tone={
                    subscription.isLimitReached ||
                    subscription.usagePercentage >= 90
                      ? "critical"
                      : subscription.usagePercentage >= 75
                      ? "highlight"
                      : "primary"
                  }
                  size="medium"
                />

                <Text as="p" variant="bodySm" tone="subdued">
                  {subscription.isUnlimited
                    ? "Your Enterprise tier includes unlimited monthly parcel dispatches across Pathao, Steadfast, and RedX."
                    : subscription.isLimitReached
                    ? "You have reached 100% of your monthly booking capacity. Upgrade your plan below to continue sending orders to couriers."
                    : `You have ${subscription.remainingBookings.toLocaleString()} parcel bookings remaining before reaching your ${subscription.maxLimit.toLocaleString()}-order monthly limit.`}
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 2. PRICING TIERS GRID */}
        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingLg">
              Ultra-Competitive Pricing for Bangladeshi Merchants
            </Text>

            <Grid>
              {tiers.map((tier) => {
                const isCurrentPlan =
                  subscription.currentPlan.toLowerCase() ===
                  tier.id.toLowerCase();
                const isSubmittingThisTier =
                  navigation.state === "submitting" &&
                  submittingPlanId === tier.id;

                return (
                  <Grid.Cell
                    key={tier.id}
                    columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}
                  >
                    <Card>
                      <BlockStack gap="400">
                        <BlockStack gap="150">
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                          >
                            <Text as="h3" variant="headingMd">
                              {tier.name}
                            </Text>
                            {isCurrentPlan ? (
                              <Badge tone="success">Your Active Plan</Badge>
                            ) : tier.badgeText ? (
                              <Badge tone="info">{tier.badgeText}</Badge>
                            ) : null}
                          </InlineStack>

                          <Text as="p" variant="bodySm" tone="subdued">
                            {tier.bengaliTag}
                          </Text>
                        </BlockStack>

                        <BlockStack gap="100">
                          <InlineStack gap="100" blockAlign="baseline">
                            <Text
                              as="span"
                              variant="headingXl"
                              fontWeight="bold"
                            >
                              {tier.priceDisplay}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              / mo
                            </Text>
                          </InlineStack>

                          <Badge
                            tone={isCurrentPlan ? "success" : "attention"}
                          >
                            {`Limit: ${tier.orderLimitDisplay}`}
                          </Badge>
                        </BlockStack>

                        <Divider />

                        <Text as="p" variant="bodySm" tone="subdued">
                          {tier.description}
                        </Text>

                        <BlockStack gap="200">
                          {tier.features.map((featureText) => (
                            <InlineStack
                              key={featureText}
                              gap="200"
                              blockAlign="start"
                              wrap={false}
                            >
                              <Box>
                                <Icon
                                  source={CheckCircleIcon}
                                  tone="success"
                                />
                              </Box>
                              <Text as="span" variant="bodySm">
                                {featureText}
                              </Text>
                            </InlineStack>
                          ))}
                        </BlockStack>

                        <Divider />

                        <Box>
                          {isCurrentPlan ? (
                            <Button fullWidth disabled>
                              Your Active Plan
                            </Button>
                          ) : (
                            <Button
                              fullWidth
                              variant={
                                tier.id === "Growth" || tier.id === "Pro"
                                  ? "primary"
                                  : "secondary"
                              }
                              loading={isSubmittingThisTier}
                              onClick={() => handleSelectPlan(tier.id)}
                            >
                              {tier.price === 0
                                ? "Switch to Free (Moti)"
                                : `Upgrade to ${tier.name}`}
                            </Button>
                          )}
                        </Box>
                      </BlockStack>
                    </Card>
                  </Grid.Cell>
                );
              })}
            </Grid>
          </BlockStack>
        </Layout.Section>

        {/* 3. FEATURE COMPARISON MATRIX TABLE */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">
                  Detailed Plan Comparison Matrix
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Compare monthly order allowances, fraud checking filters,
                  multi-location shipping, and dynamic routing across all
                  four tiers.
                </Text>
              </BlockStack>
            </Box>

            <IndexTable
              resourceName={{ singular: "feature", plural: "features" }}
              itemCount={comparisonRows.length}
              selectable={false}
              headings={[
                { title: "Capability / Feature" },
                { title: "Free (Moti) — $0.00/mo" },
                { title: "Growth (Bikash) — $0.99/mo" },
                { title: "Pro (Agragoti) — $2.49/mo" },
                { title: "Enterprise — $4.99/mo" },
              ]}
            >
              {comparisonRows.map((row, idx) => (
                <IndexTable.Row
                  id={row.feature}
                  key={row.feature}
                  position={idx}
                >
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {row.feature}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm">
                      {row.free}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" fontWeight="medium">
                      {row.growth}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" fontWeight="medium">
                      {row.pro}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone="success">{row.enterprise}</Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
