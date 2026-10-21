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
  DataTable,
  Icon,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import { authenticate } from "../shopify.server";
import CourierConfig, { connectDB } from "../db.server";
import {
  type PlanTierId,
  type PricingTierConfig,
  SIX_TIER_PRICING_PLANS,
  getPricingTier,
} from "../pricing-plans";

export type { PlanTierId, PricingTierConfig };
export { SIX_TIER_PRICING_PLANS, getPricingTier };

function CheckFeatureIcon(props: SVGProps<SVGSVGElement>) {
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
    const matchedTier = SIX_TIER_PRICING_PLANS.find(
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

  let storeConfig: any = await CourierConfig.findOne({
    shopDomain,
  }).lean();

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

  const activePlanKey = String(storeConfig.currentPlan || "Free");
  const monthlyOrderCount = Number(storeConfig.monthlyOrderCount ?? 0);
  const billingCycleStart = storeConfig.billingCycleStart
    ? new Date(storeConfig.billingCycleStart).toISOString()
    : new Date().toISOString();

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
        activePlanKey.toLowerCase() === "free"
          ? "FREE PLAN ($0.00/mo)"
          : `${storeConfig.billingStatus || "ACTIVE"}`;
    }
  } catch {
    // Fallback to stored MongoDB billing status
  }

  const currentTier =
    SIX_TIER_PRICING_PLANS.find(
      (t) => t.id.toLowerCase() === activePlanKey.toLowerCase()
    ) || SIX_TIER_PRICING_PLANS[0];

  const maxLimit = currentTier.orderLimit;
  const usagePercentage = Math.min(
    100,
    Math.round((monthlyOrderCount / maxLimit) * 100)
  );
  const remainingBookings = Math.max(0, maxLimit - monthlyOrderCount);
  const isLimitReached = monthlyOrderCount >= maxLimit;

  return {
    shopDomain,
    justUpgraded: Boolean(upgradedPlanParam),
    subscription: {
      currentPlan: currentTier.id,
      planDisplayName: currentTier.name,
      priceDisplay: currentTier.priceDisplay,
      monthlyOrderCount,
      maxLimit,
      usagePercentage,
      remainingBookings,
      isLimitReached,
      billingCycleStart,
      billingStatus: shopifyBillingStatus,
    },
    tiers: SIX_TIER_PRICING_PLANS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const formData = await request.formData();
  const targetPlanId = String(formData.get("planId") || "");

  const selectedTier = SIX_TIER_PRICING_PLANS.find(
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
          billingStatus: "FREE PLAN ($0.00/mo)",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      success: true,
      confirmationUrl: null,
      message: `Switched your store subscription to ${selectedTier.name} (${selectedTier.priceDisplay} / mo — ${selectedTier.orderLimitDisplay}).`,
    };
  }

  const appBaseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const currentPathname = new URL(request.url).pathname;
  const returnUrl = `${appBaseUrl}${currentPathname}?upgradedPlan=${selectedTier.id}`;

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
        name: `Delivery1 Courier Hub - ${selectedTier.name}`,
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
        message: `Redirecting to Shopify Billing Portal to approve ${selectedTier.name} (${selectedTier.priceDisplay} / mo)...`,
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
        ? `Plan updated to ${selectedTier.name} (${selectedTier.priceDisplay} / mo — ${selectedTier.orderLimitDisplay}) in MongoDB! (Shopify Sandbox Note: ${userErrorMsg})`
        : `Successfully subscribed to ${selectedTier.name} (${selectedTier.priceDisplay} / mo — ${selectedTier.orderLimitDisplay})!`,
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
      message: `Subscribed to ${selectedTier.name} (${selectedTier.priceDisplay} / mo — ${selectedTier.orderLimitDisplay}) in Sandbox Mode.`,
    };
  }
};

export default function PricingAndBillingPage() {
  const { shopDomain, justUpgraded, subscription, tiers } =
    useLoaderData<typeof loader>();
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

  const handleSelectPlan = (planId: PlanTierId) => {
    const formData = new FormData();
    formData.append("planId", planId);
    submit(formData, { method: "post" });
  };

  const comparisonMatrixRows = [
    [
      "Monthly Price",
      "$0.00 / mo",
      "$1.99 / mo",
      "$3.49 / mo",
      "$5.99 / mo",
      "$11.99 / mo",
      "$24.99 / mo",
    ],
    [
      "Order Limit",
      "120 orders/month",
      "250 orders/month",
      "500 orders/month",
      "1,000 orders/month",
      "2,500 orders/month",
      "10,000 orders/month",
    ],
    [
      "Core Routing & Automation",
      "Shipping Zone & Rate, Manual Select",
      "Shipping Zone & Rate, Manual Select",
      "Shipping Zone & Rate, Manual Select",
      "Dynamic Rule Engine + Shipping Zone",
      "Auto-Routing Engine + Shipping Zone",
      "Full Automation + Shipping Zone",
    ],
    [
      "Bulk Order Limit",
      "No Bulk (Single process only)",
      "Max 10 orders/batch",
      "Max 15 orders/batch",
      "Max 50 orders (Auto-routed)",
      "Max 50 orders (Auto-routed)",
      "Max 50 orders (Auto-routed)",
    ],
    [
      "Fraud Protection Level",
      "Basic Fraud Indicator",
      "Auto-Lock (Fixed success rate)",
      "Custom Risk Threshold (Set X%)",
      "Custom Threshold + Bulk Safe-Approve",
      "AI-Enhanced Flagging",
      "Global Fraud Network API Access",
    ],
    [
      "Fulfillment, Print & Invoice",
      "Standard tracking sheet",
      "3-Tiered Printable Packing Slips",
      "Custom Branded layout invoices",
      "Custom Branded invoices + COD Surcharge Toggles",
      "Custom Branded invoices",
      "Industrial barcode printer sync & Tailored warehouse layouts",
    ],
    [
      "Support & Financials",
      "Community Support",
      "Standard Email",
      "Priority Email",
      "Priority WhatsApp Support",
      "Zero-Risk Financial Payment Sync",
      "Live Onboarding Manager",
    ],
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
      title="Subscription Plans & Billing"
      subtitle={`Store: ${shopDomain} • 6-Tier Courier Automation SaaS Plans`}
      backAction={{ content: "Courier Dashboard", url: "/app" }}
    >
        <TitleBar title="Pricing & Billing" />

        <Layout>
          {subscription.isLimitReached && !limitAlertDismissed && (
            <Layout.Section>
              <Banner
                title="Monthly Order Booking Limit Reached"
                tone="critical"
                onDismiss={() => setLimitAlertDismissed(true)}
              >
                <p>
                  You have used{" "}
                  <strong>
                    {subscription.monthlyOrderCount.toLocaleString()} /{" "}
                    {subscription.maxLimit.toLocaleString()}
                  </strong>{" "}
                  orders on your <strong>{subscription.planDisplayName}</strong>
                  . Upgrade to a higher tier below to immediately unlock
                  additional monthly order capacity.
                </p>
              </Banner>
            </Layout.Section>
          )}

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

          {justUpgraded && !showBanner && (
            <Layout.Section>
              <Banner
                title={`Your store is now subscribed to ${subscription.planDisplayName}!`}
                tone="success"
              >
                <p>
                  Your monthly order allowance and tier features have been
                  activated and synced with MongoDB.
                </p>
              </Banner>
            </Layout.Section>
          )}

          {/* Active Plan & Monthly Quota Meter Card */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap>
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
                      Current Rate:{" "}
                      <strong>{`${subscription.priceDisplay} / mo`}</strong> •
                      Billing Cycle Started:{" "}
                      <strong>{cycleStartFormatted}</strong>
                    </Text>
                  </BlockStack>

                  <Badge
                    tone={
                      subscription.isLimitReached
                        ? "critical"
                        : subscription.usagePercentage >= 80
                        ? "warning"
                        : "info"
                    }
                  >
                    {`${subscription.remainingBookings.toLocaleString()} Orders Remaining This Month`}
                  </Badge>
                </InlineStack>

                <Divider />

                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="headingMd" fontWeight="bold">
                      {`${subscription.monthlyOrderCount.toLocaleString()} / ${subscription.maxLimit.toLocaleString()} orders used this month`}
                    </Text>
                    <Text as="span" variant="bodyMd" fontWeight="bold">
                      {`${subscription.usagePercentage}% Used`}
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
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* SECTION 1: 6-TIER PRICING CARDS GRID */}
          <Layout.Section>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingLg">
                  Choose the Right Plan for Your Bangladeshi Store
                </Text>
                <Badge tone="info">Billed Every 30 Days via Shopify</Badge>
              </InlineStack>

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
                      columnSpan={{ xs: 6, sm: 6, md: 3, lg: 4, xl: 4 }}
                    >
                      <Card>
                        <BlockStack gap="400">
                          {/* Tier Header & Most Popular / Active Badges */}
                          <BlockStack gap="150">
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              wrap
                            >
                              <Text as="h3" variant="headingMd">
                                {tier.name}
                              </Text>
                              {isCurrentPlan ? (
                                <Badge tone="success">Your Active Plan</Badge>
                              ) : tier.isMostPopular ? (
                                <Badge tone="magic">Most Popular</Badge>
                              ) : tier.badgeLabel ? (
                                <Badge tone="info">{tier.badgeLabel}</Badge>
                              ) : null}
                            </InlineStack>

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

                            <Box>
                              <Badge
                                tone={
                                  isCurrentPlan
                                    ? "success"
                                    : tier.isMostPopular
                                    ? "warning"
                                    : "attention"
                                }
                              >
                                {`Order Limit: ${tier.orderLimitDisplay}`}
                              </Badge>
                            </Box>
                          </BlockStack>

                          <Divider />

                          {/* Structured Tier Features List */}
                          <BlockStack gap="200">
                            {tier.features.map((featureText) => (
                              <InlineStack
                                key={`${tier.id}-${featureText}`}
                                gap="200"
                                blockAlign="start"
                                wrap={false}
                              >
                                <Box>
                                  <Icon
                                    source={CheckFeatureIcon}
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

                          {/* Upgrade / Subscribe / Active Action Button */}
                          <Box>
                            {isCurrentPlan ||
                            (tier.id === "Free" &&
                              subscription.currentPlan === "Free") ? (
                              <Button fullWidth disabled>
                                Your Active Plan
                              </Button>
                            ) : (
                              <Button
                                fullWidth
                                variant={
                                  tier.isMostPopular ||
                                  tier.id === "Pro" ||
                                  tier.id === "Advanced"
                                    ? "primary"
                                    : "secondary"
                                }
                                loading={isSubmittingThisTier}
                                onClick={() => handleSelectPlan(tier.id)}
                              >
                                {tier.price === 0
                                  ? "Downgrade to Free"
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

          {/* SECTION 2: DETAILED 6-TIER PLAN COMPARISON MATRIX */}
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Detailed Plan Comparison Matrix
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Side-by-side comparison of order capacity, automated routing
                    engines, bulk processing limits, fraud protection, packing
                    slips, and financial sync across all 6 plans.
                  </Text>
                </BlockStack>
              </Box>

              <Divider />

              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Feature / Capability",
                  "Free ($0.00/mo)",
                  "Starter ($1.99/mo)",
                  "Growth ($3.49/mo) ★",
                  "Pro ($5.99/mo)",
                  "Advanced ($11.99/mo)",
                  "Enterprise ($24.99/mo)",
                ]}
                rows={comparisonMatrixRows}
                hoverable
              />
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
