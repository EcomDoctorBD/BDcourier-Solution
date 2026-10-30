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
    coreRouting: "Shipping Zone & Checkout Rate Sync",
    bulkLimit: "Single order booking (1 at a time)",
    fraudProtection: "Multi-Courier Fraud History Check",
    fulfillmentPrint: "Standard Label & Invoice Template",
    supportFinancials: "Community Support",
    features: [
      "120 orders/month limit",
      "Shipping Zone & Checkout Rate Sync",
      "Single order booking (1 order at a time)",
      "Multi-Courier Fraud History Check",
      "Standard Shipping Label & Invoice Template",
      "Community Support",
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
    coreRouting: "Shipping Zone & Checkout Rate Sync",
    bulkLimit: "Up to 10 orders per click",
    fraudProtection: "Multi-Courier Check + Auto Risk Alert",
    fulfillmentPrint: "Standard Label & Invoice Template",
    supportFinancials: "Standard Email Support",
    features: [
      "250 orders/month limit",
      "Shipping Zone & Checkout Rate Sync",
      "Bulk booking: Up to 10 orders per click",
      "Multi-Courier Fraud Check + Auto Risk Alert",
      "Standard Shipping Label & Invoice Template",
      "Standard Email Support",
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
    coreRouting: "Shipping Zone & Checkout Rate Sync",
    bulkLimit: "Up to 15 orders per click",
    fraudProtection: "Custom Fraud Risk Threshold (Set X%)",
    fulfillmentPrint: "Standard & Modern Templates (with Brand Logo)",
    supportFinancials: "Priority Email Support",
    features: [
      "500 orders/month limit",
      "Shipping Zone & Checkout Rate Sync",
      "Bulk booking: Up to 15 orders per click",
      "Custom Fraud Risk Threshold (Set X%)",
      "Standard & Modern Label/Invoice Templates (with Brand Logo)",
      "Priority Email Support",
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
    coreRouting: "Automatic Courier Selection (City + District Rules)",
    bulkLimit: "Up to 50 orders per click",
    fraudProtection: "Custom Threshold + Auto Safety Lock",
    fulfillmentPrint: "Standard & Modern Templates (with Brand Logo)",
    supportFinancials: "Priority Email & WhatsApp Support",
    features: [
      "1,000 orders/month limit",
      "Automatic Courier Selection (Inside/Outside City + District Rules)",
      "Bulk booking: Up to 50 orders per click",
      "Custom Fraud Risk Threshold + Auto Safety Lock",
      "Standard & Modern Label/Invoice Templates (with Brand Logo)",
      "Priority Email & WhatsApp Support",
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
    coreRouting: "Auto Courier Selection + Smart AI Address Cleaning",
    bulkLimit: "Up to 50 orders per click",
    fraudProtection: "Advanced Fraud Protection + Google Sheets Sync",
    fulfillmentPrint: "All 3 Templates (Standard, Modern & Premium)",
    supportFinancials: "Dedicated WhatsApp & Priority Support",
    features: [
      "2,500 orders/month limit",
      "Automatic Courier Selection + Smart AI Address Cleaning",
      "Bulk booking: Up to 50 orders per click",
      "Advanced Fraud Protection + Google Sheets Sync",
      "All 3 Print Templates (Standard, Modern & Premium with Custom Colors)",
      "Dedicated WhatsApp & Priority Support",
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
    coreRouting: "Full Automation + Smart AI Address & District Routing",
    bulkLimit: "Up to 50 orders per click",
    fraudProtection: "Full Global Fraud Network + Sheets Real-Time Sync",
    fulfillmentPrint: "All 3 Templates (Standard, Modern & Premium)",
    supportFinancials: "24/7 VIP Support & Dedicated Account Manager",
    features: [
      "10,000 orders/month limit",
      "Full Automation + Smart AI Address & District Routing",
      "Bulk booking: Up to 50 orders per click",
      "Full Global Fraud Network + Google Sheets Real-Time Sync",
      "All 3 Print Templates (Standard, Modern & Premium with Custom Colors)",
      "24/7 VIP Support & Dedicated Account Manager",
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
