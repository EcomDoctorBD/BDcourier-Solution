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
  Icon,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import { authenticate } from "../shopify.server";
import CourierConfig, { connectDB, ensureBillingCycleCurrent } from "../db.server";
import {
  type PlanTierId,
  type BillingInterval,
  type PricingTierConfig,
  SIX_TIER_PRICING_PLANS,
  getPricingTier,
} from "../pricing-plans";

export type { PlanTierId, BillingInterval, PricingTierConfig };
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
  const upgradedIntervalParam = url.searchParams.get("interval");

  // Step 1: Query Shopify Admin GraphQL for shop plan (dev store detection), live active recurring subscriptions,
  // and active one-time prepaid purchases (oneTimePurchases)
  let activeSubs: any[] = [];
  let oneTimePurchases: any[] = [];
  let isDevStore = false;
  let shopifyBillingStatus = "ACTIVE";

  try {
    const billingAndShopQuery = `#graphql
      query GetBillingAndShop {
        shop {
          plan {
            partnerDevelopment
            displayName
          }
        }
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            test
            currentPeriodEnd
            lineItems {
              plan {
                pricingDetails {
                  __typename
                  ... on AppRecurringPricing {
                    price {
                      amount
                      currencyCode
                    }
                    interval
                  }
                }
              }
            }
          }
          oneTimePurchases(first: 20, reverse: true) {
            edges {
              node {
                id
                name
                status
                test
                createdAt
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `;
    const response = await admin.graphql(billingAndShopQuery);
    const result: any = await response.json();
    const shopPlan = result?.data?.shop?.plan;
    isDevStore =
      Boolean(shopPlan?.partnerDevelopment) ||
      shopPlan?.displayName === "affiliate" ||
      shopPlan?.displayName === "partner_test" ||
      process.env.NODE_ENV !== "production";

    activeSubs =
      result?.data?.currentAppInstallation?.activeSubscriptions || [];
    oneTimePurchases =
      (result?.data?.currentAppInstallation?.oneTimePurchases?.edges || []).map(
        (edge: any) => edge?.node
      ).filter(Boolean);
  } catch (err) {
    console.warn(
      "[Billing] Failed to query active subscriptions and shop info from Shopify GraphQL:",
      err
    );
  }

  // Find confirmed active recurring subscription
  const activePaidSub = activeSubs.find((sub: any) => sub.status === "ACTIVE");

  // Find active 6-months upfront one-time purchase within last 183 days
  const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
  const validActiveOneTime = oneTimePurchases.find((purchase: any) => {
    if (purchase.status !== "ACTIVE") return false;
    const ageMs = Date.now() - new Date(purchase.createdAt).getTime();
    return ageMs >= 0 && ageMs < SIX_MONTHS_MS;
  });

  let verifiedTier: PricingTierConfig | undefined;
  let activeInterval: BillingInterval = "monthly";
  let activeSubId = "";
  let isTestChargeActive = false;

  if (activePaidSub) {
    const subName = String(activePaidSub.name || "").toLowerCase();
    verifiedTier = SIX_TIER_PRICING_PLANS.find(
      (t) =>
        t.id.toLowerCase() !== "free" &&
        (subName.includes(t.name.toLowerCase()) ||
          subName.includes(t.id.toLowerCase()))
    );

    const hasAnnualLineItem = activePaidSub.lineItems?.some(
      (item: any) => item?.plan?.pricingDetails?.interval === "ANNUAL"
    );
    const isYearly =
      hasAnnualLineItem ||
      subName.includes("yearly") ||
      subName.includes("annual");

    activeInterval = isYearly ? "yearly" : "monthly";
    activeSubId = activePaidSub.id;
    isTestChargeActive = Boolean(activePaidSub.test);
    shopifyBillingStatus = `${activePaidSub.status} (${activeInterval.toUpperCase()}${
      isTestChargeActive ? " - Test Charge" : ""
    })`;
  } else if (validActiveOneTime) {
    const purchaseName = String(validActiveOneTime.name || "").toLowerCase();
    verifiedTier = SIX_TIER_PRICING_PLANS.find(
      (t) =>
        t.id.toLowerCase() !== "free" &&
        (purchaseName.includes(t.name.toLowerCase()) ||
          purchaseName.includes(t.id.toLowerCase()))
    );
    activeInterval = "6months";
    activeSubId = validActiveOneTime.id;
    isTestChargeActive = Boolean(validActiveOneTime.test);
    shopifyBillingStatus = `ACTIVE (6-MO PREPAID${
      isTestChargeActive ? " - Test Charge" : ""
    })`;
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

  // Bypass active subscription locks automatically on local development / partner dev stores
  if (!verifiedTier && isDevStore) {
    const existingPlan = String(storeConfig?.currentPlan || "Free");
    if (existingPlan.toLowerCase() !== "free") {
      const devMatchedTier = SIX_TIER_PRICING_PLANS.find(
        (t) => t.id.toLowerCase() === existingPlan.toLowerCase()
      );
      if (devMatchedTier) {
        verifiedTier = devMatchedTier;
        isTestChargeActive = true;
        shopifyBillingStatus = `ACTIVE (Dev Store Bypass - Test Charge)`;
      }
    }
  }

  // Step 3: Synchronize MongoDB with Authoritative Shopify Billing
  if (verifiedTier) {
    const isPlanChanged =
      String(storeConfig.currentPlan || "").toLowerCase() !==
      verifiedTier.id.toLowerCase();

    const expiresAt =
      activeInterval === "6months"
        ? validActiveOneTime?.createdAt
          ? new Date(new Date(validActiveOneTime.createdAt).getTime() + SIX_MONTHS_MS)
          : new Date(Date.now() + SIX_MONTHS_MS)
        : null;

    if (isPlanChanged) {
      // Newly activated plan tier: update tier, status, and reset billingCycleStart
      await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            shopDomain,
            currentPlan: verifiedTier.id,
            billingStatus: shopifyBillingStatus,
            shopifySubscriptionId: activeSubId,
            prepaidPlanExpiresAt: expiresAt,
            billingCycleStart: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      storeConfig.currentPlan = verifiedTier.id;
      storeConfig.billingStatus = shopifyBillingStatus;
      storeConfig.shopifySubscriptionId = activeSubId;
      storeConfig.prepaidPlanExpiresAt = expiresAt;
      storeConfig.billingCycleStart = new Date();
    } else {
      // Retain existing billingCycleStart, sync status and subscription ID
      await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            billingStatus: shopifyBillingStatus,
            shopifySubscriptionId: activeSubId,
            prepaidPlanExpiresAt: expiresAt,
          },
        }
      );
      storeConfig.billingStatus = shopifyBillingStatus;
      storeConfig.prepaidPlanExpiresAt = expiresAt;
    }
  } else {
    // If Shopify has NO active paid subscription and not in dev store bypass, ensure store is safely on Free plan
    if (String(storeConfig.currentPlan || "Free").toLowerCase() !== "free") {
      await CourierConfig.findOneAndUpdate(
        { shopDomain },
        {
          $set: {
            currentPlan: "Free",
            billingStatus: "FREE PLAN ($0.00/mo)",
            shopifySubscriptionId: "",
            prepaidPlanExpiresAt: null,
          },
        }
      );
      storeConfig.currentPlan = "Free";
      storeConfig.billingStatus = "FREE PLAN ($0.00/mo)";
      storeConfig.prepaidPlanExpiresAt = null;
    }
    shopifyBillingStatus = "FREE PLAN ($0.00/mo)";
  }

  // Step 4: Validate URL parameter against verified tier (or dev store test bypass)
  let justUpgraded = false;
  let upgradeWarning = "";

  if (upgradedPlanParam) {
    const requestedTier = SIX_TIER_PRICING_PLANS.find(
      (t) => t.id.toLowerCase() === upgradedPlanParam.toLowerCase()
    );

    if (
      (verifiedTier && requestedTier && verifiedTier.id === requestedTier.id) ||
      (isDevStore && requestedTier)
    ) {
      justUpgraded = true;
      if (isDevStore && (!verifiedTier || verifiedTier.id !== requestedTier?.id)) {
        const devExpiresAt =
          upgradedIntervalParam === "6months"
            ? new Date(Date.now() + SIX_MONTHS_MS)
            : null;

        await CourierConfig.findOneAndUpdate(
          { shopDomain },
          {
            $set: {
              currentPlan: requestedTier.id,
              billingStatus: "ACTIVE (Dev Store Bypass - Test Charge)",
              shopifySubscriptionId: "dev_test_sub",
              prepaidPlanExpiresAt: devExpiresAt,
              billingCycleStart: new Date(),
            },
          }
        );
        storeConfig.currentPlan = requestedTier.id;
        storeConfig.prepaidPlanExpiresAt = devExpiresAt;
        verifiedTier = requestedTier;
      }
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
      priceDisplay: currentTier.pricing[activeInterval].monthlyRate > 0
        ? `$${currentTier.pricing[activeInterval].monthlyRate.toFixed(2)}`
        : "$0.00",
      activeInterval,
      monthlyOrderCount,
      maxLimit,
      usagePercentage,
      remainingBookings,
      isLimitReached,
      billingCycleStart,
      billingStatus: shopifyBillingStatus,
      prepaidPlanExpiresAt: storeConfig.prepaidPlanExpiresAt
        ? new Date(storeConfig.prepaidPlanExpiresAt).toISOString()
        : null,
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
  const intervalParam = String(formData.get("interval") || "monthly").toLowerCase();
  const interval: BillingInterval =
    intervalParam === "6months"
      ? "6months"
      : intervalParam === "yearly"
      ? "yearly"
      : "monthly";

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
  if (selectedTier.id === "Free" || selectedTier.pricing[interval].monthlyRate === 0) {
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
          prepaidPlanExpiresAt: null,
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
  let isTestCharge = process.env.NODE_ENV !== "production";
  let isDevStore = false;
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
    isDevStore =
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
  const returnUrl = `${appBaseUrl}${currentPathname}?upgradedPlan=${selectedTier.id}&interval=${interval}`;

  try {
    let confirmationUrl: string | null = null;
    let userErrors: any[] = [];

    // ==================== INTERVAL SPLIT LOGIC ====================
    if (interval === "6months") {
      // • For 6months: Use appPurchaseOneTimeCreate mutation, calculating the upfront amount (totalBilled)
      const upfrontAmount = selectedTier.pricing["6months"].totalBilled;
      const CREATE_ONE_TIME_MUTATION = `#graphql
        mutation AppPurchaseOneTimeCreate(
          $name: String!
          $price: MoneyInput!
          $returnUrl: URL!
          $test: Boolean
        ) {
          appPurchaseOneTimeCreate(
            name: $name
            price: $price
            returnUrl: $returnUrl
            test: $test
          ) {
            userErrors {
              field
              message
            }
            confirmationUrl
            appPurchaseOneTime {
              id
              status
            }
          }
        }
      `;

      const response = await admin.graphql(CREATE_ONE_TIME_MUTATION, {
        variables: {
          name: `Delivery1 Courier Hub - ${selectedTier.name} (6 Months Upfront)`,
          price: {
            amount: upfrontAmount,
            currencyCode: "USD",
          },
          returnUrl,
          test: isTestCharge,
        },
      });

      const result: any = await response.json();
      const payload = result?.data?.appPurchaseOneTimeCreate;
      userErrors = payload?.userErrors || [];
      confirmationUrl = payload?.confirmationUrl || null;
    } else if (interval === "yearly") {
      // • For yearly: Use appSubscriptionCreate with interval: ANNUAL
      const annualAmount = selectedTier.pricing.yearly.totalBilled;
      const CREATE_ANNUAL_SUB_MUTATION = `#graphql
        mutation CreateAppAnnualSubscription(
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
                    interval: ANNUAL
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

      const response = await admin.graphql(CREATE_ANNUAL_SUB_MUTATION, {
        variables: {
          name: `Delivery1 Courier Hub - ${selectedTier.name} (Annual Plan)`,
          returnUrl,
          test: isTestCharge,
          amount: annualAmount,
        },
      });

      const result: any = await response.json();
      const payload = result?.data?.appSubscriptionCreate;
      userErrors = payload?.userErrors || [];
      confirmationUrl = payload?.confirmationUrl || null;
    } else {
      // • For monthly: Use appSubscriptionCreate with interval: EVERY_30_DAYS
      const monthlyAmount = selectedTier.pricing.monthly.totalBilled;
      const CREATE_MONTHLY_SUB_MUTATION = `#graphql
        mutation CreateAppMonthlySubscription(
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

      const response = await admin.graphql(CREATE_MONTHLY_SUB_MUTATION, {
        variables: {
          name: `Delivery1 Courier Hub - ${selectedTier.name} (Monthly)`,
          returnUrl,
          test: isTestCharge,
          amount: monthlyAmount,
        },
      });

      const result: any = await response.json();
      const payload = result?.data?.appSubscriptionCreate;
      userErrors = payload?.userErrors || [];
      confirmationUrl = payload?.confirmationUrl || null;
    }

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

    return {
      success: true,
      confirmationUrl,
      message: `Redirecting to Shopify Billing to approve ${selectedTier.name} (${interval})...`,
    };
  } catch (err: any) {
    console.error("[Billing] Failed to create charge/subscription:", err);
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

  const [interval, setInterval] = useState<"monthly" | "6months" | "yearly">("monthly");
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
    formData.append("interval", interval);
    submit(formData, { method: "post" });
  };

  const comparisonHeadings = [
    "Feature / Capability",
    ...tiers.map((t) => t.id),
  ];

  const comparisonMatrixRows = [
    [
      "Monthly Price",
      ...tiers.map(
        (t) => `$${t.pricing[interval].monthlyRate.toFixed(2)} / mo`
      ),
    ],
    [
      "Billing Terms",
      ...tiers.map((t) => t.pricing[interval].text),
    ],
    [
      "Order Limit",
      ...tiers.map((t) => `${t.orderLimit.toLocaleString()} orders/month`),
    ],
    [
      "Core Routing & Automation",
      ...tiers.map((t) => t.coreRouting),
    ],
    [
      "Bulk Order Limit",
      ...tiers.map((t) => t.bulkLimit),
    ],
    [
      "Fraud Protection Level",
      ...tiers.map((t) => t.fraudProtection),
    ],
    [
      "Fulfillment, Print & Invoice",
      ...tiers.map((t) => t.fulfillmentPrint),
    ],
    [
      "Support",
      ...tiers.map((t) => t.supportFinancials),
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
    <Page>
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
                order bookings for this billing period. Single and bulk courier
                fulfillment will remain paused until you upgrade your plan or
                until your next 30-day billing cycle resets.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {justUpgraded && (
          <Layout.Section>
            <Banner
              title="Plan Activated Successfully"
              tone="success"
              onDismiss={() => {}}
            >
              <p>
                Your store has been updated to the{" "}
                <strong>{subscription.planDisplayName}</strong>. Your upgraded
                monthly quota is now available.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {upgradeWarning && (
          <Layout.Section>
            <Banner
              title="Subscription Verification Notice"
              tone="warning"
              onDismiss={() => {}}
            >
              <p>{upgradeWarning}</p>
            </Banner>
          </Layout.Section>
        )}

        {showBanner && actionData && (
          <Layout.Section>
            <Banner
              title={
                actionData.success
                  ? "Redirecting to Shopify Billing"
                  : "Subscription Notice"
              }
              tone={actionData.success ? "info" : "critical"}
              onDismiss={() => setShowBanner(false)}
            >
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* SECTION 0: CURRENT ACTIVE SUBSCRIPTION & USAGE STATUS */}
        <Layout.Section>
          <Card padding="500">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="p" variant="bodySm" tone="subdued">
                      CURRENT SUBSCRIPTION TIER
                    </Text>
                    <Badge
                      tone={
                        subscription.currentPlan === "Free"
                          ? "info"
                          : "success"
                      }
                    >
                      {subscription.currentPlan === "Free"
                        ? "Free Tier Active"
                        : `${subscription.planDisplayName} Active`}
                    </Badge>
                  </InlineStack>

                  <Text as="h1" variant="headingLg" fontWeight="bold">
                    {subscription.planDisplayName}
                  </Text>
                </BlockStack>

                <InlineStack gap="300" blockAlign="center">
                  <BlockStack gap="050" align="end">
                    <Text as="p" variant="bodyXs" tone="subdued">
                      PRICE PER MONTH
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      {subscription.priceDisplay} / mo
                    </Text>
                  </BlockStack>

                  {subscription.currentPlan !== "Free" &&
                    !subscription.billingStatus.includes("FREE PLAN") && (
                      <Badge
                        tone={
                          subscription.billingStatus.includes("ACTIVE")
                            ? "success"
                            : "info"
                        }
                      >
                        {subscription.billingStatus}
                      </Badge>
                    )}
                </InlineStack>
              </InlineStack>

              <Divider />

              {/* Quota Progress Meter */}
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Monthly Order Usage (30-Day Auto Rollover)
                  </Text>
                  <Text
                    as="span"
                    variant="bodyMd"
                    fontWeight="bold"
                    tone={subscription.isLimitReached ? "critical" : undefined}
                  >
                    {subscription.monthlyOrderCount.toLocaleString()} /{" "}
                    {subscription.maxLimit.toLocaleString()} Orders (
                    {subscription.usagePercentage}%)
                  </Text>
                </InlineStack>

                <ProgressBar
                  progress={subscription.usagePercentage}
                  tone={
                    subscription.usagePercentage >= 100
                      ? "critical"
                      : subscription.usagePercentage >= 80
                      ? "highlight"
                      : "primary"
                  }
                  size="small"
                />

                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyXs" tone="subdued">
                    Cycle Reset: Automatic after 30 days (Active Since:{" "}
                    {cycleStartFormatted})
                  </Text>
                  <Text as="span" variant="bodyXs" tone="subdued">
                    Remaining Quota:{" "}
                    <strong>
                      {subscription.remainingBookings.toLocaleString()} orders
                    </strong>
                  </Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* SECTION 1: 3-INTERVAL TIER SELECTOR & 6-TIER PRICING CARDS */}
        <Layout.Section>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg" fontWeight="bold">
                Choose the Right Plan for Your Store
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Select your preferred billing cycle. All paid plans are billed securely through Shopify.
              </Text>
            </BlockStack>

            {/* Centralized Floating Capsule Segmented Controller */}
            <div
              className="flex justify-center mb-6"
              style={{
                display: "flex",
                justifyContent: "center",
                margin: "16px 0 28px 0",
              }}
            >
              <div
                className="inline-flex p-1.5 bg-slate-100 rounded-full border border-slate-200 shadow-sm gap-1"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  backgroundColor: "#F1F5F9",
                  padding: "5px",
                  borderRadius: "9999px",
                  border: "1px solid #E2E8F0",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                  gap: "4px",
                }}
              >
                {[
                  { id: "monthly", label: "Monthly" },
                  { id: "6months", label: "6 Months (Save 10%)" },
                  { id: "yearly", label: "Annually (Save 18%)" },
                ].map((tab) => {
                  const isSelected = interval === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() =>
                        setInterval(tab.id as "monthly" | "6months" | "yearly")
                      }
                      className={`flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold transition-all duration-150 ${
                        isSelected
                          ? "bg-white text-slate-900 shadow-sm font-bold"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 20px",
                        borderRadius: "9999px",
                        fontSize: "13px",
                        fontWeight: isSelected ? 700 : 500,
                        border: "none",
                        backgroundColor: isSelected ? "#FFFFFF" : "transparent",
                        color: isSelected ? "#0F172A" : "#64748B",
                        boxShadow: isSelected
                          ? "0 2px 4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)"
                          : "none",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        outline: "none",
                      }}
                    >
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <style>{`
              .pricing-plan-card-wrapper,
              .pricing-plan-card-wrapper > .Polaris-ShadowBevel,
              .pricing-plan-card-wrapper [class*="ShadowBevel"],
              .pricing-plan-card-wrapper [class*="Polaris-Box"] {
                height: 100% !important;
                display: flex !important;
                flex-direction: column !important;
                flex: 1 1 auto !important;
              }
              .pricing-plan-card-wrapper .pricing-ribbon {
                height: 24px !important;
                max-height: 24px !important;
                width: 130px !important;
                flex: none !important;
                display: block !important;
              }
            `}</style>

            <Grid columns={{ xs: 1, sm: 2, md: 3, lg: 3, xl: 3 }}>
              {tiers.map((tier) => {
                const isActive =
                  tier.id === subscription.currentPlan ||
                  tier.id.toLowerCase() ===
                    (subscription.currentPlan || "Free").toLowerCase();
                const isGrowthOrPopular = tier.id === "Growth";
                const isProOrBestValue = tier.id === "Pro";
                const isSubmittingThisTier =
                  navigation.state === "submitting" &&
                  submittingPlanId === tier.id;

                const currentIntervalPricing =
                  tier.pricing[interval] || tier.pricing.monthly;

                return (
                  <Grid.Cell key={tier.id}>
                    <div
                      className="pricing-plan-card-wrapper"
                      style={{
                        position: "relative",
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                        borderRadius: "12px",
                      }}
                    >
                      {/* Top-Right Ribbon: for non-free plans when active toggle is not monthly */}
                      {tier.id !== "Free" && interval !== "monthly" && (
                        <div
                          className="pricing-ribbon"
                          style={{
                            position: "absolute",
                            top: "16px",
                            right: "-34px",
                            width: "130px",
                            height: "24px",
                            lineHeight: "24px",
                            backgroundColor: "#16a34a",
                            color: "#ffffff",
                            fontSize: "11px",
                            fontWeight: 700,
                            textAlign: "center",
                            transform: "rotate(45deg)",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                            zIndex: 2,
                            pointerEvents: "none",
                            flexShrink: 0,
                          }}
                        >
                          {interval === "6months" ? "10% SAVE" : "18% SAVE"}
                        </div>
                      )}

                      <Card
                        padding="500"
                        background={
                          isActive
                            ? "bg-surface-secondary"
                            : undefined
                        }
                      >
                        <div
                          style={{
                            height: "100%",
                            display: "flex",
                            flexDirection: "column",
                            flex: "1 1 auto",
                          }}
                        >
                          {/* Tier Header & Clean Badges */}
                          <BlockStack gap="200">
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "8px",
                                flexWrap: "wrap",
                              }}
                            >
                              <Text as="h3" variant="headingMd" fontWeight="bold">
                                {tier.name}
                              </Text>
                              {isActive ? (
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
                              ) : isProOrBestValue ? (
                                <span
                                  style={{
                                    backgroundColor: "#e0e7ff",
                                    color: "#3730a3",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    padding: "2px 10px",
                                    borderRadius: "9999px",
                                    lineHeight: "1.2",
                                    display: "inline-block",
                                  }}
                                >
                                  Best Value
                                </span>
                              ) : null}
                            </div>

                            {/* Large Target Font: prominent rate formatted as $X.XX /month */}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "baseline",
                                gap: "6px",
                                marginTop: "2px",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "30px",
                                  fontWeight: 800,
                                  letterSpacing: "-0.02em",
                                  color: "#0F172A",
                                  lineHeight: "1.1",
                                }}
                              >
                                {currentIntervalPricing.monthlyRate > 0
                                  ? `$${currentIntervalPricing.monthlyRate.toFixed(2)}`
                                  : "$0.00"}
                              </span>
                              <span
                                style={{
                                  fontSize: "14px",
                                  fontWeight: 500,
                                  color: "#64748B",
                                }}
                              >
                                /month
                              </span>
                            </div>

                            {/* Grey Sub-Label: dynamically declared billed sums */}
                            <p
                              style={{
                                fontSize: "12px",
                                color: "#64748B",
                                margin: "2px 0 0 0",
                                fontWeight: 500,
                                lineHeight: "1.3",
                              }}
                            >
                              {currentIntervalPricing.text}
                            </p>

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
                                marginTop: "6px",
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

                          <div style={{ margin: "16px 0" }}>
                            <Divider />
                          </div>

                          {/* Structured Tier Features List in flex: 1 container */}
                          <div
                            style={{
                              flex: "1 1 auto",
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px",
                            }}
                          >
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
                          </div>

                          {/* Bottom Divider & Action Button aligned to bottom */}
                          <div
                            style={{
                              marginTop: "auto",
                              paddingTop: "16px",
                            }}
                          >
                            <Divider />
                            <div style={{ paddingTop: "16px" }}>
                              {isActive ? (
                                <button
                                  type="button"
                                  disabled
                                  className="w-full py-2.5 px-4 rounded-lg text-sm font-medium bg-gray-100 text-gray-500 border border-gray-200 cursor-default flex items-center justify-center transition-none"
                                  style={{
                                    width: "100%",
                                    padding: "10px 16px",
                                    borderRadius: "8px",
                                    fontSize: "14px",
                                    fontWeight: 600,
                                    border: "1px solid #E2E8F0",
                                    backgroundColor: "#F3F4F6",
                                    color: "#6B7280",
                                    cursor: "default",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    boxShadow: "none",
                                    transition: "none",
                                  }}
                                >
                                  Current Active Plan
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isSubmittingThisTier}
                                  onClick={() => handleSelectPlan(tier.id)}
                                  className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold bg-black text-white hover:bg-neutral-800 transition-all duration-150 cursor-pointer shadow-sm flex items-center justify-center gap-2"
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
                                    border: "none",
                                    backgroundColor: "#000000",
                                    color: "#FFFFFF",
                                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isSubmittingThisTier) {
                                      e.currentTarget.style.backgroundColor = "#1F2937";
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isSubmittingThisTier) {
                                      e.currentTarget.style.backgroundColor = "#000000";
                                    }
                                  }}
                                >
                                  {isSubmittingThisTier ? (
                                    <span>Processing...</span>
                                  ) : tier.id === "Free" ? (
                                    "Downgrade to Free"
                                  ) : (
                                    `Upgrade to ${tier.name} →`
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>
                    </div>
                  </Grid.Cell>
                );
              })}
            </Grid>
          </BlockStack>
        </Layout.Section>

        {/* SECTION 2: DETAILED 6-TIER PLAN COMPARISON MATRIX */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="500">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Detailed Plan Comparison
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  আমাদের প্রতিটি প্ল্যানের অর্ডার লিমিট, বাল্ক বুকিং, অটো কুরিয়ার সিলেকশন, ফ্রড চেক এবং প্রিন্ট টেমপ্লেটের তুলনামূলক তালিকা।
                </Text>
              </BlockStack>
            </Box>

            <Divider />

            <div style={{ overflowX: "auto", width: "100%" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                  fontSize: "13px",
                  lineHeight: "1.5",
                }}
              >
                <thead>
                  <tr
                    style={{
                      backgroundColor: "#F8FAFC",
                      borderBottom: "1px solid #E2E8F0",
                    }}
                  >
                    {comparisonHeadings.map((heading, colIdx) => {
                      const isFirst = colIdx === 0;
                      return (
                        <th
                          key={heading}
                          style={{
                            padding: "14px 18px",
                            fontWeight: 700,
                            fontSize: "13px",
                            color: "#1E293B",
                            borderBottom: "1px solid #E2E8F0",
                            whiteSpace: "nowrap",
                            width: isFirst ? "22%" : "13%",
                            minWidth: isFirst ? "180px" : "115px",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            {heading}
                            {(heading === "Growth" || colIdx === 3) && (
                              <span
                                style={{
                                  backgroundColor: "#E0F2FE",
                                  color: "#0369A1",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  padding: "2px 7px",
                                  borderRadius: "10px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                }}
                              >
                                Popular
                              </span>
                            )}
                            {(heading === "Pro" || colIdx === 4) && (
                              <span
                                style={{
                                  backgroundColor: "#e0e7ff",
                                  color: "#3730a3",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  padding: "2px 7px",
                                  borderRadius: "10px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                }}
                              >
                                Best Value
                              </span>
                            )}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {comparisonMatrixRows.map((row, rowIdx) => {
                    const isEven = rowIdx % 2 === 0;
                    return (
                      <tr
                        key={row[0]}
                        style={{
                          backgroundColor: isEven ? "#FFFFFF" : "#F8FAFC",
                          transition: "background-color 0.15s ease",
                        }}
                      >
                        {row.map((cellText, colIdx) => {
                          const isFirstCol = colIdx === 0;
                          return (
                            <td
                              key={`${row[0]}-${colIdx}`}
                              style={{
                                padding: "14px 18px",
                                fontWeight: isFirstCol ? 600 : 400,
                                color: isFirstCol ? "#0F172A" : "#475569",
                                verticalAlign: "middle",
                                borderBottom: "1px solid #E2E8F0",
                              }}
                            >
                              {cellText}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
