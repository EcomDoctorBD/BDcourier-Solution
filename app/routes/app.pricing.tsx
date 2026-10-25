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
import CourierConfig, { connectDB, ensureBillingCycleCurrent } from "../db.server";
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
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();
  await ensureBillingCycleCurrent(shopDomain);

  const url = new URL(request.url);
  const upgradedPlanParam = url.searchParams.get("upgradedPlan");

  // Step 1: Query Shopify Admin GraphQL for live active subscriptions (Authoritative Source of Truth)
  let activeSubs: any[] = [];
  let shopifyBillingStatus = "ACTIVE";

  try {
    const billingQuery = `#graphql
      query GetActiveSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            test
            currentPeriodEnd
          }
        }
      }
    `;
    const response = await admin.graphql(billingQuery);
    const result: any = await response.json();
    activeSubs =
      result?.data?.currentAppInstallation?.activeSubscriptions || [];
  } catch (err) {
    console.warn(
      "[Billing] Failed to query active subscriptions from Shopify GraphQL:",
      err
    );
  }

  // Find confirmed active recurring subscription
  const activePaidSub = activeSubs.find((sub: any) => sub.status === "ACTIVE");

  let verifiedTier: PricingTierConfig | undefined;
  if (activePaidSub) {
    const subName = String(activePaidSub.name || "").toLowerCase();
    verifiedTier = SIX_TIER_PRICING_PLANS.find(
      (t) =>
        t.price > 0 &&
        (subName.includes(t.name.toLowerCase()) ||
          subName.includes(t.id.toLowerCase()))
    );
    shopifyBillingStatus = `${activePaidSub.status}${
      activePaidSub.test ? " (Test Charge)" : ""
    }`;
  }

  // Step 2: Fetch or initialize store configuration in MongoDB
  let storeConfig: any = await CourierConfig.findOne({ shopDomain }).lean();

  if (!storeConfig) {
    const created = await CourierConfig.create({
      shopDomain,
      currentPlan: "Free",
      monthlyOrderCount: 0,
      billingCycleStart: new Date(),
      billingStatus: "FREE PLAN ($0.00/mo)",
    });
    storeConfig = created.toObject();
  }

  // Step 3: Synchronize MongoDB with Authoritative Shopify Billing
  if (verifiedTier) {
    const isPlanChanged =
      String(storeConfig.currentPlan || "").toLowerCase() !==
      verifiedTier.id.toLowerCase();

    if (isPlanChanged) {
      // Newly activated plan tier: update tier, status, and reset billingCycleStart
      await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            shopDomain,
            currentPlan: verifiedTier.id,
            billingStatus: `ACTIVE (Shopify Billing Confirmed${
              activePaidSub.test ? " - Test Charge" : ""
            })`,
            shopifySubscriptionId: activePaidSub.id,
            billingCycleStart: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      storeConfig.currentPlan = verifiedTier.id;
      storeConfig.billingStatus = `ACTIVE (Shopify Billing Confirmed${
        activePaidSub.test ? " - Test Charge" : ""
      })`;
      storeConfig.shopifySubscriptionId = activePaidSub.id;
      storeConfig.billingCycleStart = new Date();
    } else {
      // Retain existing billingCycleStart, sync status and subscription ID
      await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            billingStatus: `ACTIVE (Shopify Billing Confirmed${
              activePaidSub.test ? " - Test Charge" : ""
            })`,
            shopifySubscriptionId: activePaidSub.id,
          },
        }
      );
      storeConfig.billingStatus = `ACTIVE (Shopify Billing Confirmed${
        activePaidSub.test ? " - Test Charge" : ""
      })`;
    }
  } else {
    // If Shopify has NO active paid subscription, ensure store is safely on Free plan
    if (String(storeConfig.currentPlan || "Free").toLowerCase() !== "free") {
      await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            currentPlan: "Free",
            billingStatus: "FREE PLAN ($0.00/mo)",
            shopifySubscriptionId: "",
          },
        }
      );
      storeConfig.currentPlan = "Free";
      storeConfig.billingStatus = "FREE PLAN ($0.00/mo)";
    }
    shopifyBillingStatus = "FREE PLAN ($0.00/mo)";
  }

  // Step 4: Validate URL parameter against verified GraphQL tier (Stop URL Exploit)
  let justUpgraded = false;
  let upgradeWarning = "";

  if (upgradedPlanParam) {
    const requestedTier = SIX_TIER_PRICING_PLANS.find(
      (t) => t.id.toLowerCase() === upgradedPlanParam.toLowerCase()
    );

    if (verifiedTier && requestedTier && verifiedTier.id === requestedTier.id) {
      justUpgraded = true;
    } else {
      upgradeWarning = `The requested upgrade to "${upgradedPlanParam}" could not be confirmed by Shopify Billing. Active plan is ${
        verifiedTier?.name || "Free Plan"
      }.`;
    }
  }

  const activePlanKey = String(storeConfig.currentPlan || "Free");
  const monthlyOrderCount = Number(storeConfig.monthlyOrderCount ?? 0);
  const billingCycleStart = storeConfig.billingCycleStart
    ? new Date(storeConfig.billingCycleStart).toISOString()
    : new Date().toISOString();

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
    justUpgraded,
    upgradeWarning,
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

  // ==================== 1. DOWNGRADE TO FREE PLAN ($0.00/mo) ====================
  if (selectedTier.price === 0) {
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
        "[Billing] Error cancelling active Shopify subscriptions on Free downgrade:",
        cancelErr
      );
    }

    // Update CourierConfig to Free tier (preserving monthlyOrderCount to prevent quota resets)
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

    return {
      success: true,
      confirmationUrl: null,
      message:
        "Successfully switched to the Free Plan ($0.00/mo). Any active recurring Shopify billing charges have been cancelled.",
    };
  }

  // ==================== 2. UPGRADE TO PAID TIER (SHOPIFY BILLING) ====================
  // Check shop plan type dynamically to determine test mode (Dev stores vs Real paid stores)
  let isTestCharge = process.env.NODE_ENV !== "production";
  try {
    const shopPlanQuery = `#graphql
      query GetShopPlanType {
        shop {
          plan {
            partnerDevelopment
            displayName
          }
        }
      }
    `;
    const shopRes = await admin.graphql(shopPlanQuery);
    const shopData: any = await shopRes.json();
    const plan = shopData?.data?.shop?.plan;
    const isDevStore =
      Boolean(plan?.partnerDevelopment) ||
      plan?.displayName === "affiliate" ||
      plan?.displayName === "partner_test";

    isTestCharge = isDevStore || process.env.NODE_ENV !== "production";
  } catch (err) {
    console.warn(
      "[Billing] Could not determine shop plan type, defaulting test mode:",
      err
    );
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
        test: isTestCharge,
        amount: selectedTier.price,
      },
    });

    const result: any = await response.json();
    const payload = result?.data?.appSubscriptionCreate;
    const userErrors = payload?.userErrors || [];
    const confirmationUrl = payload?.confirmationUrl;

    if (userErrors.length > 0) {
      return {
        success: false,
        confirmationUrl: null,
        message: `Shopify Billing Error: ${userErrors[0].message}`,
      };
    }

    if (!confirmationUrl) {
      return {
        success: false,
        confirmationUrl: null,
        message:
          "Unable to generate subscription confirmation URL with Shopify Billing.",
      };
    }

    // DO NOT upgrade currentPlan in MongoDB before merchant approves charge on Shopify!
    // Return confirmationUrl so the browser redirects to Shopify's confirmation page.
    return {
      success: true,
      confirmationUrl,
      message: `Redirecting to Shopify Billing to approve ${selectedTier.name} (${selectedTier.priceDisplay} / mo)...`,
    };
  } catch (err: any) {
    console.error("[Billing] Failed to create app subscription:", err);
    return {
      success: false,
      confirmationUrl: null,
      message: `Failed to initiate subscription: ${
        err?.message || "Unknown error"
      }`,
    };
  }
};

export default function PricingAndBillingPage() {
  const { shopDomain, justUpgraded, upgradeWarning, subscription, tiers } =
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
      "Automatic Courier Selection + Shipping Rates",
      "Automatic Courier Selection + Shipping Rates",
      "Full Automation + Shipping Rates",
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

          {upgradeWarning && !showBanner && (
            <Layout.Section>
              <Banner
                title="Subscription Not Confirmed"
                tone="critical"
              >
                <p>{upgradeWarning}</p>
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
                  const isGrowthOrPopular =
                    tier.id.toLowerCase() === "growth" || Boolean(tier.isMostPopular);

                  return (
                    <Grid.Cell
                      key={tier.id}
                      columnSpan={{ xs: 6, sm: 6, md: 3, lg: 4, xl: 4 }}
                    >
                      <Card
                        background={
                          isCurrentPlan
                            ? "bg-surface-secondary"
                            : isGrowthOrPopular
                            ? "bg-surface-active"
                            : undefined
                        }
                      >
                        <BlockStack gap="400">
                          {/* Tier Header & Clean Badges */}
                          <BlockStack gap="200">
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              wrap
                            >
                              <Text as="h3" variant="headingMd" fontWeight="bold">
                                {tier.name}
                              </Text>
                              {isCurrentPlan ? (
                                <span
                                  style={{
                                    backgroundColor: "#BDF5D6",
                                    color: "#065F46",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    padding: "3px 10px",
                                    borderRadius: "12px",
                                    lineHeight: "1.2",
                                    display: "inline-block",
                                  }}
                                >
                                  Active
                                </span>
                              ) : isGrowthOrPopular ? (
                                <span
                                  style={{
                                    backgroundColor: "#FEF08A",
                                    color: "#713F12",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    padding: "3px 10px",
                                    borderRadius: "12px",
                                    lineHeight: "1.2",
                                    display: "inline-block",
                                  }}
                                >
                                  Popular
                                </span>
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
                                /month
                              </Text>
                            </InlineStack>

                            {/* Uniform Sky-Blue Order Limit Bar */}
                            <div
                              style={{
                                width: "100%",
                                backgroundColor: "#E0F2FE",
                                borderRadius: "6px",
                                padding: "6px 12px",
                                boxSizing: "border-box",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <span
                                style={{
                                  color: "#0369A1",
                                  fontWeight: 700,
                                  fontSize: "13px",
                                  lineHeight: "1.2",
                                }}
                              >
                                {tier.orderLimit
                                  ? `${tier.orderLimit.toLocaleString()} orders/month`
                                  : tier.orderLimitDisplay}
                              </span>
                            </div>
                          </BlockStack>

                          <Divider />

                          {/* Structured Tier Features List with Dark Charcoal Circular Checkmarks */}
                          <BlockStack gap="200">
                            {tier.features.map((featureText) => (
                              <InlineStack
                                key={`${tier.id}-${featureText}`}
                                gap="200"
                                blockAlign="start"
                                wrap={false}
                              >
                                <div
                                  style={{
                                    width: "18px",
                                    height: "18px",
                                    minWidth: "18px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    marginTop: "2px",
                                    flexShrink: 0,
                                  }}
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    fill="#202223"
                                    width="18"
                                    height="18"
                                    aria-hidden="true"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </div>
                                <Text as="span" variant="bodySm">
                                  {featureText}
                                </Text>
                              </InlineStack>
                            ))}
                          </BlockStack>

                          <Divider />

                          {/* Upgrade / Subscribe / Active Action Button (Matching Popup Styling) */}
                          <Box>
                            {isCurrentPlan ? (
                              <button
                                type="button"
                                disabled
                                style={{
                                  width: "100%",
                                  padding: "10px 16px",
                                  borderRadius: "8px",
                                  fontSize: "14px",
                                  fontWeight: 600,
                                  border: "none",
                                  backgroundColor: "#E5E7EB",
                                  color: "#9CA3AF",
                                  cursor: "default",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                Current Active Plan
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isSubmittingThisTier}
                                onClick={() => handleSelectPlan(tier.id)}
                                style={{
                                  width: "100%",
                                  padding: "10px 16px",
                                  borderRadius: "8px",
                                  fontSize: "14px",
                                  fontWeight: 600,
                                  cursor: isSubmittingThisTier ? "wait" : "pointer",
                                  transition: "all 0.15s ease-in-out",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: "8px",
                                  border: isGrowthOrPopular
                                    ? "none"
                                    : "1px solid #D1D5DB",
                                  backgroundColor: isGrowthOrPopular
                                    ? "#202223"
                                    : "#FFFFFF",
                                  color: isGrowthOrPopular
                                    ? "#FFFFFF"
                                    : "#1F2937",
                                  boxShadow: isGrowthOrPopular
                                    ? "0 1px 3px rgba(0,0,0,0.12)"
                                    : "0 1px 2px rgba(0,0,0,0.05)",
                                }}
                              >
                                {isSubmittingThisTier ? (
                                  <span>Processing...</span>
                                ) : tier.price === 0 ? (
                                  "Downgrade to Free"
                                ) : (
                                  `Upgrade to ${tier.name} →`
                                )}
                              </button>
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
                    Detailed Plan Comparison
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Side-by-side comparison of order capacity, automatic courier selection,
                    bulk processing limits, fraud protection, packing slips,
                    and financial sync across all 6 plans.
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
