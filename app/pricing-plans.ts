export type PlanTierId =
  | "Free"
  | "Starter"
  | "Growth"
  | "Pro"
  | "Advanced"
  | "Enterprise";

export interface PricingTierConfig {
  id: PlanTierId;
  name: string;
  price: number;
  priceDisplay: string;
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
}

export const SIX_TIER_PRICING_PLANS: PricingTierConfig[] = [
  {
    id: "Free",
    name: "Free Plan",
    price: 0.0,
    priceDisplay: "$0.00",
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
  },
  {
    id: "Starter",
    name: "Starter Plan",
    price: 1.99,
    priceDisplay: "$1.99",
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
  },
  {
    id: "Growth",
    name: "Growth Plan",
    price: 3.49,
    priceDisplay: "$3.49",
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
  },
  {
    id: "Pro",
    name: "Pro Plan",
    price: 5.99,
    priceDisplay: "$5.99",
    orderLimit: 1000,
    orderLimitDisplay: "1,000 orders/month",
    badgeLabel: "Dynamic Automation",
    coreRouting: "Dynamic Rule Engine + Shipping Zone",
    bulkLimit: "Max 50 orders (Auto-routed)",
    fraudProtection: "Custom Threshold + Bulk Safe-Approve",
    fulfillmentPrint: "Custom Branded invoices + COD Surcharge Toggles",
    supportFinancials: "Priority WhatsApp Support",
    features: [
      "1,000 orders/month limit",
      "Core: Dynamic Rule Engine + Shipping Zone",
      "Bulk: Max 50 orders (Auto-routed)",
      "Fraud: Custom Threshold + Bulk Safe-Approve",
      "Fulfillment: Custom Branded invoices + COD Surcharge Toggles",
      "Support: Priority WhatsApp Support",
    ],
  },
  {
    id: "Advanced",
    name: "Advanced Plan",
    price: 11.99,
    priceDisplay: "$11.99",
    orderLimit: 2500,
    orderLimitDisplay: "2,500 orders/month",
    badgeLabel: "AI + Zero-Risk Sync",
    coreRouting: "Auto-Routing Engine + Shipping Zone",
    bulkLimit: "Max 50 orders (Auto-routed)",
    fraudProtection: "AI-Enhanced Flagging",
    fulfillmentPrint: "Custom Branded invoices",
    supportFinancials: "Zero-Risk Financial Payment Sync",
    features: [
      "2,500 orders/month limit",
      "Core: Auto-Routing Engine + Shipping Zone",
      "Bulk: Max 50 orders (Auto-routed)",
      "Fraud: AI-Enhanced Flagging",
      "Fulfillment: Custom Branded invoices",
      "Support: Zero-Risk Financial Payment Sync",
    ],
  },
  {
    id: "Enterprise",
    name: "Enterprise Plan",
    price: 24.99,
    priceDisplay: "$24.99",
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
  },
];

export function getPricingTier(planId?: string): PricingTierConfig {
  const normalized = String(planId || "Free").trim().toLowerCase();
  const matched = SIX_TIER_PRICING_PLANS.find(
    (tier) => tier.id.toLowerCase() === normalized
  );
  return matched || SIX_TIER_PRICING_PLANS[0];
}
