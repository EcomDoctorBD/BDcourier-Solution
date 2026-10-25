export type PlanTierId =
  | "Free"
  | "Starter"
  | "Growth"
  | "Pro"
  | "Advanced"
  | "Enterprise";

export type BillingInterval = "monthly" | "6months" | "yearly";

export interface PricingTierConfig {
  id: PlanTierId;
  name: string;
  orderLimit: number;
  orderLimitDisplay: string;
  isMostPopular?: boolean;
  badgeLabel?: string;
  coreRouting: string;
  bulkLimit: string;
  fraudProtection: string;
  fulfillmentPrint: string;
  supportFinancials: string;
  features: string[];
  pricing: {
    monthly: { monthlyRate: number; totalBilled: number; text: string };
    "6months": { monthlyRate: number; totalBilled: number; text: string };
    yearly: { monthlyRate: number; totalBilled: number; text: string };
  };
  price?: number;
  priceDisplay?: string;
}

export const SIX_TIER_PRICING_PLANS: PricingTierConfig[] = [
  {
    id: "Free",
    name: "Free Plan",
    orderLimit: 120,
    orderLimitDisplay: "120 orders/month",
    badgeLabel: "Starter Free",
    coreRouting: "Shipping Zone & Rate, Manual Select",
    bulkLimit: "No Bulk (Single process only)",
    fraudProtection: "Basic Fraud Indicator",
    fulfillmentPrint: "Standard tracking sheet",
    supportFinancials: "Community Support",
    features: [
      "120 orders/month limit",
      "Core: Shipping Zone & Rate, Manual Select",
      "Bulk: No Bulk (Single process only)",
      "Fraud: Basic Fraud Indicator",
      "Fulfillment: Standard tracking sheet",
      "Support: Community Support",
    ],
    pricing: {
      monthly: { monthlyRate: 0.0, totalBilled: 0.0, text: "Billed monthly" },
      "6months": { monthlyRate: 0.0, totalBilled: 0.0, text: "Free forever" },
      yearly: { monthlyRate: 0.0, totalBilled: 0.0, text: "Free forever" },
    },
    price: 0.0,
    priceDisplay: "$0.00",
  },
  {
    id: "Starter",
    name: "Starter Plan",
    orderLimit: 250,
    orderLimitDisplay: "250 orders/month",
    badgeLabel: "Starter Tier",
    coreRouting: "Shipping Zone & Rate, Manual Select",
    bulkLimit: "Max 10 orders/batch",
    fraudProtection: "Auto-Lock (Fixed success rate)",
    fulfillmentPrint: "3-Tiered Printable Packing Slips",
    supportFinancials: "Standard Email",
    features: [
      "250 orders/month limit",
      "Core: Shipping Zone & Rate, Manual Select",
      "Bulk: Max 10 orders/batch",
      "Fraud: Auto-Lock (Fixed success rate)",
      "Fulfillment: 3-Tiered Printable Packing Slips",
      "Support: Standard Email",
    ],
    pricing: {
      monthly: { monthlyRate: 1.99, totalBilled: 1.99, text: "Billed monthly" },
      "6months": {
        monthlyRate: 1.79,
        totalBilled: 10.74,
        text: "Billed every 6 months ($10.74 total)",
      },
      yearly: {
        monthlyRate: 1.63,
        totalBilled: 19.56,
        text: "Billed yearly ($19.56 total)",
      },
    },
    price: 1.99,
    priceDisplay: "$1.99",
  },
  {
    id: "Growth",
    name: "Growth Plan",
    orderLimit: 500,
    orderLimitDisplay: "500 orders/month",
    isMostPopular: true,
    badgeLabel: "Most Popular",
    coreRouting: "Shipping Zone & Rate, Manual Select",
    bulkLimit: "Max 15 orders/batch",
    fraudProtection: "Custom Risk Threshold (Set X%)",
    fulfillmentPrint: "Custom Branded layout invoices",
    supportFinancials: "Priority Email",
    features: [
      "500 orders/month limit",
      "Core: Shipping Zone & Rate, Manual Select",
      "Bulk: Max 15 orders/batch",
      "Fraud: Custom Risk Threshold (Set X%)",
      "Fulfillment: Custom Branded layout invoices",
      "Support: Priority Email",
    ],
    pricing: {
      monthly: { monthlyRate: 3.49, totalBilled: 3.49, text: "Billed monthly" },
      "6months": {
        monthlyRate: 3.14,
        totalBilled: 18.84,
        text: "Billed every 6 months ($18.84 total)",
      },
      yearly: {
        monthlyRate: 2.86,
        totalBilled: 34.32,
        text: "Billed yearly ($34.32 total)",
      },
    },
    price: 3.49,
    priceDisplay: "$3.49",
  },
  {
    id: "Pro",
    name: "Pro Plan",
    orderLimit: 1000,
    orderLimitDisplay: "1,000 orders/month",
    badgeLabel: "Dynamic Automation",
    coreRouting: "Automatic Courier Selection + Shipping Rates",
    bulkLimit: "Max 50 orders (Auto-routed)",
    fraudProtection: "Custom Threshold + Bulk Safe-Approve",
    fulfillmentPrint: "Custom Branded invoices + COD Surcharge Toggles",
    supportFinancials: "Priority WhatsApp Support",
    features: [
      "1,000 orders/month limit",
      "Core: Automatic Courier Selection + Shipping Rates",
      "Bulk: Max 50 orders (Auto-routed)",
      "Fraud: Custom Threshold + Bulk Safe-Approve",
      "Fulfillment: Custom Branded invoices + COD Surcharge Toggles",
      "Support: Priority WhatsApp Support",
    ],
    pricing: {
      monthly: { monthlyRate: 5.99, totalBilled: 5.99, text: "Billed monthly" },
      "6months": {
        monthlyRate: 5.39,
        totalBilled: 32.34,
        text: "Billed every 6 months ($32.34 total)",
      },
      yearly: {
        monthlyRate: 4.91,
        totalBilled: 58.92,
        text: "Billed yearly ($58.92 total)",
      },
    },
    price: 5.99,
    priceDisplay: "$5.99",
  },
  {
    id: "Advanced",
    name: "Advanced Plan",
    orderLimit: 2500,
    orderLimitDisplay: "2,500 orders/month",
    badgeLabel: "AI + Zero-Risk Sync",
    coreRouting: "Automatic Courier Selection + Shipping Rates",
    bulkLimit: "Max 50 orders (Auto-routed)",
    fraudProtection: "AI-Enhanced Flagging",
    fulfillmentPrint: "Custom Branded invoices",
    supportFinancials: "Zero-Risk Financial Payment Sync",
    features: [
      "2,500 orders/month limit",
      "Core: Automatic Courier Selection + Shipping Rates",
      "Bulk: Max 50 orders (Auto-routed)",
      "Fraud: AI-Enhanced Flagging",
      "Fulfillment: Custom Branded invoices",
      "Support: Zero-Risk Financial Payment Sync",
    ],
    pricing: {
      monthly: { monthlyRate: 11.99, totalBilled: 11.99, text: "Billed monthly" },
      "6months": {
        monthlyRate: 10.79,
        totalBilled: 64.74,
        text: "Billed every 6 months ($64.74 total)",
      },
      yearly: {
        monthlyRate: 9.83,
        totalBilled: 117.96,
        text: "Billed yearly ($117.96 total)",
      },
    },
    price: 11.99,
    priceDisplay: "$11.99",
  },
  {
    id: "Enterprise",
    name: "Enterprise Plan",
    orderLimit: 10000,
    orderLimitDisplay: "10,000 orders/month",
    badgeLabel: "Enterprise Scale",
    coreRouting: "Full Automation + Shipping Zone",
    bulkLimit: "Max 50 orders (Auto-routed)",
    fraudProtection: "Global Fraud Network API Access",
    fulfillmentPrint:
      "Industrial barcode printer sync & Tailored warehouse layouts",
    supportFinancials: "Live Onboarding Manager",
    features: [
      "10,000 orders/month limit",
      "Core: Full Automation + Shipping Zone",
      "Bulk: Max 50 orders (Auto-routed)",
      "Fraud: Global Fraud Network API Access",
      "Fulfillment: Industrial barcode printer sync & Tailored warehouse layouts",
      "Support: Live Onboarding Manager",
    ],
    pricing: {
      monthly: { monthlyRate: 24.99, totalBilled: 24.99, text: "Billed monthly" },
      "6months": {
        monthlyRate: 22.49,
        totalBilled: 134.94,
        text: "Billed every 6 months ($134.94 total)",
      },
      yearly: {
        monthlyRate: 20.49,
        totalBilled: 245.88,
        text: "Billed yearly ($245.88 total)",
      },
    },
    price: 24.99,
    priceDisplay: "$24.99",
  },
];

export function getPricingTier(planId?: string): PricingTierConfig {
  const normalized = String(planId || "Free").trim().toLowerCase();
  const matched = SIX_TIER_PRICING_PLANS.find(
    (tier) => tier.id.toLowerCase() === normalized
  );
  return matched || SIX_TIER_PRICING_PLANS[0];
}
