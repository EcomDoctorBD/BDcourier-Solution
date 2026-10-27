import { useState, useEffect, useCallback, useMemo, useRef, type SVGProps } from "react";
import {
  redirect,
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
} from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-remix/server";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Tabs,
  Button,
  Select,
  Badge,
  Text,
  BlockStack,
  InlineStack,
  Banner,
  Box,
  Checkbox,
  TextField,
  Grid,
  Divider,
  Icon,
  Popover,
  ActionList,
  Spinner,
  Link,
  DatePicker,
  Tooltip,
} from "@shopify/polaris";

import { authenticate, unauthenticated, sessionStorage } from "../shopify.server";
import { getCourierTrackingUrl } from "../services/shopify-sync.server";
import CourierConfig, {
  connectDB,
  getPlanLimit,
  getBulkBatchLimit,
  GlobalFraudNetwork,
  ShipmentBooking,
  decryptCourierConfig,
  AddressCache,
  ensureBillingCycleCurrent,
} from "../db.server";
import { cleanAndCacheAddress } from "../clean-address.server";
import { syncOrderToGoogleSheet } from "../google-sheets.server";
import {
  getValidPathaoToken,
  getPathaoBaseUrl,
  getRedxBaseUrl,
} from "../services/courier-auth.server";
import {
  resolvePathaoLocation,
  resolveRedxLocation,
} from "../services/location-resolver.server";

/**
 * 1. HIERARCHICAL BANGLADESH LOCATION DATA (8 Divisions -> 64 Districts)
 */
export const BANGLADESH_LOCATIONS: Record<string, string[]> = {
  Dhaka: [
    "Dhaka",
    "Gazipur",
    "Narayanganj",
    "Tangail",
    "Manikganj",
    "Munshiganj",
    "Narsingdi",
    "Kishoreganj",
    "Faridpur",
    "Gopalganj",
    "Madaripur",
    "Rajbari",
    "Shariatpur",
  ],
  Chattogram: [
    "Chattogram",
    "Cox's Bazar",
    "Cumilla",
    "Brahmanbaria",
    "Chandpur",
    "Noakhali",
    "Feni",
    "Lakshmipur",
    "Rangamati",
    "Khagrachhari",
    "Bandarban",
  ],
  Rajshahi: [
    "Rajshahi",
    "Bogura",
    "Pabna",
    "Sirajganj",
    "Natore",
    "Naogaon",
    "Chapainawabganj",
    "Joypurhat",
  ],
  Khulna: [
    "Khulna",
    "Jashore",
    "Kushtia",
    "Satkhira",
    "Bagerhat",
    "Jhenaidah",
    "Magura",
    "Narail",
    "Chuadanga",
    "Meherpur",
  ],
  Barishal: [
    "Barishal",
    "Patuakhali",
    "Bhola",
    "Pirojpur",
    "Barguna",
    "Jhalokati",
  ],
  Sylhet: ["Sylhet", "Moulvibazar", "Habiganj", "Sunamganj"],
  Rangpur: [
    "Rangpur",
    "Dinajpur",
    "Kurigram",
    "Gaibandha",
    "Nilphamari",
    "Panchagarh",
    "Thakurgaon",
    "Lalmonirhat",
  ],
  Mymensingh: ["Mymensingh", "Jamalpur", "Netrokona", "Sherpur"],
};

/**
 * Prominent Dhaka urban neighborhoods and aliases for zone classification
 */
export const DHAKA_NEIGHBORHOOD_KEYWORDS = [
  "uttara",
  "mirpur",
  "gulshan",
  "dhanmondi",
  "banani",
  "savar",
  "badda",
  "motijheel",
  "mohammadpur",
  "keraniganj",
  "baridhara",
  "bashundhara",
  "khilkhet",
  "rampura",
  "malibagh",
  "shantinagar",
  "mogbazar",
  "farmgate",
  "tejgaon",
  "lalbagh",
  "paltan",
  "old dhaka",
  "puran dhaka",
  "dacca",
  // Bengali script aliases
  "ঢাকা",
  "মিরপুর",
  "উত্তরা",
  "গুলশান",
  "ধানমন্ডি",
  "বনানী",
  "মোহাম্মদপুর",
  "বাড্ডা",
  "মতিঝিল",
  "সাভার",
  "কেরানীগঞ্জ",
  "বারিধারা",
  "বসুন্ধরা",
  "খিলক্ষেত",
  "রামপুরা",
  "মালিবাগ",
  "শান্তিনগর",
  "মগবাজার",
  "ফার্মগেট",
  "তেজগাঁও",
  "লালবাগ",
  "পল্টন",
];

export const COURIER_OPTIONS = [
  { label: "Pathao Courier", value: "pathao" },
  { label: "Steadfast Courier", value: "steadfast" },
  { label: "RedX Delivery", value: "redx" },
  { label: "CarryBee", value: "carrybee" },
  { label: "Bahok Courier", value: "bahok" },
];

export interface CustomRouteRule {
  division: string;
  district: string;
  courier: string;
}

function TrashRemoveIcon(props: SVGProps<SVGSVGElement>) {
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
        d="M8.5 3a1.5 1.5 0 0 0-1.415 1H4.75a.75.75 0 0 0 0 1.5h.32l.662 9.266A2.25 2.25 0 0 0 7.977 16.85h4.046a2.25 2.25 0 0 0 2.245-2.084l.662-9.266h.32a.75.75 0 0 0 0-1.5h-2.335A1.5 1.5 0 0 0 11.5 3h-3Zm1.5 1h-1.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5H10ZM7.53 7.47a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75Zm4.94 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PhoneCallIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
      aria-hidden="true"
      {...props}
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function WhatsAppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
      aria-hidden="true"
      {...props}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

export interface FraudStatsProfile {
  phone: string;
  totalDelivered: number;
  totalReturned: number;
  totalOrders: number;
  successRate: number;
  fromCache: boolean;
}

export interface AutoRoutingConfig {
  autoRoutingEnabled: boolean;
  isAutoRoutingEnabled: boolean;
  insideDhakaCourier: string;
  outsideDhakaCourier: string;
  defaultCourier: string;
  minSafetySuccessRate: number;
  minSuccessRate: number;
  customRoutes: CustomRouteRule[];
}

const DEFAULT_PRODUCT_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12.378 1.602a.75.75 0 0 0-.756 0L3 6.632l9 5.25 9-5.25-8.622-5.03ZM21.75 7.93l-9 5.25v9.248l8.622-5.03a.75.75 0 0 0 .378-.648V7.93ZM10.5 22.428v-9.248L1.5 7.93v8.82a.75.75 0 0 0 .378.648l8.622 5.03Z'/%3E%3C/svg%3E";


/**
 * SHOPIFY TO KG DYNAMIC UNIT CONVERSION MATRIX & FALLBACK RESOLVER
 * Converts Grams, Pounds, Ounces, and Kilograms into strict Kilograms (KG).
 * Falls back to merchant's persistent CourierConfig if order weight is missing/zero.
 */
export function calculateOrderWeightKg(params: {
  lineItems?: Array<{
    quantity?: number;
    weight?: number;
    weightUnit?: string;
    variant?: { weight?: number; weightUnit?: string };
    [key: string]: any;
  }>;
  orderTotalWeight?: number;
  courierKey?: string;
  storeConfig?: any;
}): number {
  const { lineItems = [], orderTotalWeight, courierKey, storeConfig } = params;

  let accumulatedWeightKg = 0;

  // 1. Dynamic unit conversion across line items
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    for (const item of lineItems) {
      const qty = Number(item.quantity || 1);
      const rawWeight = Number(
        item.weight ??
        item.variant?.weight ??
        0
      );
      const rawUnit = String(
        item.weightUnit ??
        item.variant?.weightUnit ??
        "KILOGRAMS"
      ).toUpperCase().trim();

      if (!isNaN(rawWeight) && rawWeight > 0) {
        let weightInKg = 0;
        if (rawUnit === "GRAMS" || rawUnit === "G") {
          weightInKg = rawWeight * 0.001;
        } else if (rawUnit === "POUNDS" || rawUnit === "LB" || rawUnit === "LBS") {
          weightInKg = rawWeight * 0.453592;
        } else if (rawUnit === "OUNCES" || rawUnit === "OZ") {
          weightInKg = rawWeight * 0.0283495;
        } else {
          // Default: KILOGRAMS / KG
          weightInKg = rawWeight;
        }

        accumulatedWeightKg += weightInKg * qty;
      }
    }
  }

  // 2. Fallback to Shopify's top-level order totalWeight (Shopify order totalWeight is represented in Grams)
  if (accumulatedWeightKg <= 0 && orderTotalWeight && !isNaN(Number(orderTotalWeight))) {
    const rawOrderWeight = Number(orderTotalWeight);
    if (rawOrderWeight > 0) {
      accumulatedWeightKg = rawOrderWeight * 0.001;
    }
  }

  // 3. Fallback to Merchant's Persistent Settings in CourierConfig
  if (accumulatedWeightKg <= 0) {
    const normalizedCourier = String(courierKey || "").toLowerCase().trim();
    let configuredWeight = 0;

    if (normalizedCourier === "pathao") {
      configuredWeight = parseFloat(String(storeConfig?.pathaoDefaultWeight || storeConfig?.defaultParcelWeight || "0.5"));
    } else if (normalizedCourier === "redx") {
      configuredWeight = parseFloat(String(storeConfig?.redxDefaultWeight || storeConfig?.defaultParcelWeight || "0.5"));
    } else if (normalizedCourier === "carrybee") {
      configuredWeight = parseFloat(String(storeConfig?.carrybeeDefaultWeight || storeConfig?.defaultParcelWeight || "0.5"));
    } else if (normalizedCourier === "bahok") {
      configuredWeight = parseFloat(String(storeConfig?.bahokDefaultWeight || storeConfig?.defaultParcelWeight || "0.5"));
    } else if (normalizedCourier === "steadfast") {
      configuredWeight = parseFloat(String(storeConfig?.steadfastDefaultWeight || storeConfig?.defaultParcelWeight || "0.5"));
    } else {
      configuredWeight = parseFloat(String(storeConfig?.defaultParcelWeight || "0.5"));
    }

    accumulatedWeightKg = !isNaN(configuredWeight) && configuredWeight > 0 ? configuredWeight : 0.5;
  }

  // 4. Safe rounding to 2 decimal places to avoid floating-point overflow and scientific notation
  const finalWeight = parseFloat(accumulatedWeightKg.toFixed(2));
  return Math.max(0.1, finalWeight);
}

export interface OrderLineItem {
  title: string;
  variantTitle: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  imageUrl?: string;
  weight?: number;
  weightUnit?: string;
}

export interface CourierReconciliationInfo {
  courierStatus: string;
  courierCashCollected: string;
  hasCashDiscrepancy: boolean;
  discrepancyDelta: string;
  autoSyncedPaidFulfilled: boolean;
}

/**
 * Helper to calculate the true Cash on Delivery (COD) amount for an order.
 * Prevents double-charging customers who already paid online (bKash/Nagad/Cards/SSLCommerz).
 */
export function calculateCodAmount(order: {
  displayFinancialStatus?: string;
  totalOutstandingSet?: { shopMoney?: { amount?: string | number } };
  totalOutstanding?: string | number;
  totalPrice?: string | number;
  [key: string]: any;
}): number {
  const financialStatus = String(order.displayFinancialStatus || order.financialStatus || "").toUpperCase().trim();
  if (
    financialStatus === "PAID" ||
    financialStatus === "AUTHORIZED" ||
    financialStatus === "REFUNDED" ||
    financialStatus === "VOIDED"
  ) {
    return 0;
  }

  const outstandingRaw =
    order.totalOutstandingSet?.shopMoney?.amount ??
    order.totalOutstanding;

  if (
    outstandingRaw !== undefined &&
    outstandingRaw !== null &&
    String(outstandingRaw).trim() !== ""
  ) {
    const parsedOutstanding = Number(outstandingRaw);
    if (!Number.isNaN(parsedOutstanding)) {
      return Math.max(0, Math.round(parsedOutstanding));
    }
  }

  const priceRaw = Number(order.totalPrice || 0);
  return Math.max(0, Math.round(Number.isNaN(priceRaw) ? 0 : priceRaw));
}

interface RawShopifyOrder {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  closedAt?: string | null;
  isCancelled: boolean;
  isClosed: boolean;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  city: string;
  province: string;
  totalPrice: string;
  currencyCode: string;
  fulfillmentStatus: string;
  displayFinancialStatus: string;
  financialStatus: string;
  totalOutstanding: string;
  codAmount: number;
  warehouseNote: string;
  lineItems: OrderLineItem[];
  totalWeight?: number;
}

interface NormalizedOrder extends RawShopifyOrder {
  fraudStats: FraudStatsProfile | null;
  status: string;
  isRiskyLocked: boolean;
  isInsideDhaka: boolean;
  assignedCourier: string;
  routingReason: string;
  reconciliation: CourierReconciliationInfo | null;
  trackingNumber: string | null;
  isAiCleaned: boolean;
  isCancelled: boolean;
  isClosed: boolean;
  financialStatus: string;
  fulfillmentStatus: string;
}

export interface DispatchedSlipRecord {
  orderId: string;
  orderName: string;
  trackingNumber: string;
  trackingUrl?: string;
  courierName: string;
  courierStatus?: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  isInsideDhaka: boolean;
  codAmount: string;
  currencyCode: string;
  warehouseNote: string;
  lineItems: OrderLineItem[];
  bookedAt: string;
  isCancelled?: boolean;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

function formatBangladeshPhone(rawPhone: string): string {
  const digitsOnly = (rawPhone || "").replace(/\D/g, "");
  if (digitsOnly.startsWith("8801") && digitsOnly.length === 13) {
    return digitsOnly.slice(2);
  }
  if (digitsOnly.startsWith("1") && digitsOnly.length === 10) {
    return `0${digitsOnly}`;
  }
  if (digitsOnly.startsWith("01") && digitsOnly.length === 11) {
    return digitsOnly;
  }
  return digitsOnly.length >= 10 ? digitsOnly : "";
}

function getSuccessRateBadgeTone(
  successRate: number
): "critical" | "warning" | "success" {
  if (successRate < 60) return "critical";
  if (successRate <= 80) return "warning";
  return "success";
}

/**
 * Task 4 Helper: Automatically mutates Shopify Order to Paid & Fulfilled via Admin GraphQL API
 * when courier status is 'delivered' or 'disbursed'.
 */
async function syncOrderPaidAndFulfilledInShopify(
  admin: any,
  orderId: string,
  trackingNumber: string,
  courierName: string,
  trackingUrl?: string
): Promise<boolean> {
  try {
    const formattedOrderId = orderId.startsWith("gid://shopify/Order/")
      ? orderId
      : `gid://shopify/Order/${orderId.replace(/\D/g, "")}`;

    // 1. Mark Shopify Order as Paid
    const MARK_PAID_MUTATION = `#graphql
      mutation OrderMarkAsPaid($input: OrderMarkAsPaidInput!) {
        orderMarkAsPaid(input: $input) {
          order {
            id
            displayFinancialStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    await admin.graphql(MARK_PAID_MUTATION, {
      variables: { input: { id: formattedOrderId } },
    });

    // 2. Fetch open FulfillmentOrder IDs and mark Fulfilled with tracking info across all locations
    const FO_QUERY = `#graphql
      query GetOrderFulfillmentOrders($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 10) {
            edges {
              node {
                id
                status
                assignedLocation {
                  id
                  name
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      totalQuantity
                      remainingQuantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    const foRes = await admin.graphql(FO_QUERY, { variables: { id: formattedOrderId } });
    const foJson: any = await foRes.json();
    const foEdges = foJson?.data?.order?.fulfillmentOrders?.edges || [];
    const openFos = foEdges
      .map(({ node }: any) => node)
      .filter(
        (n: any) =>
          n &&
          (n.status === "OPEN" ||
            n.status === "IN_PROGRESS" ||
            n.status === "SCHEDULED" ||
            !n.status)
      );

    if (openFos.length > 0) {
      const FULFILL_MUTATION = `#graphql
        mutation FulfillOrder($fulfillment: FulfillmentV2Input!) {
          fulfillmentCreateV2(fulfillment: $fulfillment) {
            fulfillment {
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
      const trackingInfo: { company: string; number: string; url?: string } = {
        company: courierName,
        number: trackingNumber,
      };
      if (trackingUrl && trackingUrl.trim()) {
        trackingInfo.url = trackingUrl.trim();
      }

      for (const openFo of openFos) {
        const foLineItemEdges = openFo.lineItems?.edges || [];
        const fulfillmentOrderLineItems = foLineItemEdges
          .map(({ node: foItem }: any) => {
            const qty =
              foItem.remainingQuantity !== undefined && foItem.remainingQuantity !== null
                ? Number(foItem.remainingQuantity)
                : Number(foItem.totalQuantity || 1);
            return {
              id: foItem.id,
              quantity: qty > 0 ? qty : 1,
            };
          })
          .filter((it: any) => it.id && it.quantity > 0);

        await admin.graphql(FULFILL_MUTATION, {
          variables: {
            fulfillment: {
              notifyCustomer: false,
              trackingInfo,
              lineItemsByFulfillmentOrder: [
                {
                  fulfillmentOrderId: openFo.id,
                  ...(fulfillmentOrderLineItems.length > 0
                    ? { fulfillmentOrderLineItems }
                    : {}),
                },
              ],
            },
          },
        });
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Non-blocking helper to add tags to a Shopify Order via Admin GraphQL API
 */
async function addShopifyOrderTags(
  admin: any,
  orderId: string,
  tags: string[]
): Promise<boolean> {
  try {
    if (!admin || !orderId || !Array.isArray(tags) || tags.length === 0) {
      return false;
    }
    const orderGid = orderId.startsWith("gid://shopify/Order/")
      ? orderId
      : `gid://shopify/Order/${orderId.replace(/\D/g, "")}`;

    const TAGS_ADD_MUTATION = `#graphql
      mutation AddOrderTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const res = await admin.graphql(TAGS_ADD_MUTATION, {
      variables: { id: orderGid, tags },
    });
    const data: any = await res.json();
    if (data?.errors && data.errors.length > 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Task 3 Helper: Automatically creates a Shopify Fulfillment via fulfillmentCreateV2 GraphQL Mutation
 * Maps live courier tracking number, tracking URL, courier company name, and triggers buyer email.
 */
async function createShopifyFulfillmentOnBooking(params: {
  admin: any;
  shopDomain: string;
  orderId: string;
  orderName: string;
  trackingNumber: string;
  trackingUrl: string;
  courierName: string;
}): Promise<boolean> {
  const { admin, shopDomain, orderId, orderName, trackingNumber, trackingUrl, courierName } = params;
  try {
    let effectiveAdmin = admin;
    if (!effectiveAdmin) {
      try {
        const offlineAuth = await unauthenticated.admin(shopDomain);
        effectiveAdmin = offlineAuth?.admin;
      } catch (authErr) {
        console.warn(`[Shopify Fulfillment] Could not obtain offline admin for ${shopDomain}:`, authErr);
      }
    }

    if (!effectiveAdmin) {
      console.warn(`[Shopify Fulfillment] Admin client unavailable for ${shopDomain}, skipping fulfillment mutation`);
      return false;
    }

    const formattedOrderId = orderId.startsWith("gid://shopify/Order/")
      ? orderId
      : `gid://shopify/Order/${orderId.replace(/\D/g, "")}`;

    // 1. Query all active FulfillmentOrders and their dynamic Assigned Locations & Line Items
    const FO_QUERY = `#graphql
      query GetOrderFulfillmentOrdersForDispatch($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 10, assignmentStatus: FULFILLMENT_REQUESTED_OR_UNFULFILLED) {
            edges {
              node {
                id
                status
                assignedLocation {
                  id
                  name
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      totalQuantity
                      remainingQuantity
                      lineItem {
                        id
                        title
                        sku
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

    let foRes = await effectiveAdmin.graphql(FO_QUERY, { variables: { id: formattedOrderId } });
    let foJson: any = await foRes.json();
    let foEdges = foJson?.data?.order?.fulfillmentOrders?.edges || [];

    // Fault-Tolerant Fallback: If assignmentStatus returns empty, query open/in-progress fulfillment orders
    if (foEdges.length === 0) {
      const FO_FALLBACK_QUERY = `#graphql
        query GetOrderFulfillmentOrdersFallback($id: ID!) {
          order(id: $id) {
            fulfillmentOrders(first: 10) {
              edges {
                node {
                  id
                  status
                  assignedLocation {
                    id
                    name
                  }
                  lineItems(first: 50) {
                    edges {
                      node {
                        id
                        totalQuantity
                        remainingQuantity
                        lineItem {
                          id
                          title
                          sku
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
      const fallbackRes = await effectiveAdmin.graphql(FO_FALLBACK_QUERY, { variables: { id: formattedOrderId } });
      const fallbackJson: any = await fallbackRes.json();
      foEdges = fallbackJson?.data?.order?.fulfillmentOrders?.edges || [];
    }

    const targetFoNodes = foEdges
      .map(({ node }: any) => node)
      .filter(
        (node: any) =>
          node &&
          (node.status === "OPEN" ||
            node.status === "IN_PROGRESS" ||
            node.status === "SCHEDULED" ||
            !node.status)
      );

    if (targetFoNodes.length === 0) {
      console.log(
        `[Shopify Fulfillment] Order ${orderName} (${formattedOrderId}) has no OPEN or IN_PROGRESS fulfillment orders to fulfill`
      );
      return false;
    }

    // 2. Execute discrete atomic fulfillmentCreateV2 mutations per fulfillmentOrderId / location
    const FULFILLMENT_CREATE_V2_MUTATION = `#graphql
      mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          fulfillment {
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

    const trackingInfo: { company: string; number: string; url?: string } = {
      company: courierName,
      number: trackingNumber,
    };
    if (trackingUrl && trackingUrl.trim()) {
      trackingInfo.url = trackingUrl.trim();
    }

    let successfulFulfillments = 0;

    for (const foNode of targetFoNodes) {
      const fulfillmentOrderId = foNode.id;
      const locationId = foNode.assignedLocation?.id || "assigned";
      const locationName = foNode.assignedLocation?.name || "";

      // Extract discrete line item allocations for this specific location/fulfillment order
      const foLineItemEdges = foNode.lineItems?.edges || [];
      const fulfillmentOrderLineItems = foLineItemEdges
        .map(({ node: foItem }: any) => {
          const qty =
            foItem.remainingQuantity !== undefined && foItem.remainingQuantity !== null
              ? Number(foItem.remainingQuantity)
              : Number(foItem.totalQuantity || 1);
          return {
            id: foItem.id,
            quantity: qty > 0 ? qty : 1,
          };
        })
        .filter((it: any) => it.id && it.quantity > 0);

      console.log(
        `[Shopify Location Resolver] Order ${orderName}: fulfilling FO=${fulfillmentOrderId} at location=${locationName || locationId} with ${fulfillmentOrderLineItems.length} items`
      );

      const fulfillmentPayload: any = {
        notifyCustomer: true,
        trackingInfo,
        lineItemsByFulfillmentOrder: [
          {
            fulfillmentOrderId,
            ...(fulfillmentOrderLineItems.length > 0
              ? { fulfillmentOrderLineItems }
              : {}),
          },
        ],
      };

      try {
        const fulfillRes = await effectiveAdmin.graphql(FULFILLMENT_CREATE_V2_MUTATION, {
          variables: { fulfillment: fulfillmentPayload },
        });

        const fulfillJson: any = await fulfillRes.json();
        const userErrors = fulfillJson?.data?.fulfillmentCreateV2?.userErrors || [];
        if (userErrors.length > 0) {
          console.warn(
            `[Shopify Multi-Location Notice] userErrors for ${orderName} (Location: ${locationId}, FO: ${fulfillmentOrderId}):`,
            JSON.stringify(userErrors)
          );
        } else {
          console.log(
            `[Shopify Multi-Location Fulfillment Success] Order ${orderName} (${formattedOrderId}) fulfilled at location ${locationName || locationId} (FO: ${fulfillmentOrderId}) via ${courierName} tracking ${trackingNumber}`
          );
          successfulFulfillments++;
        }
      } catch (nodeFulfillErr: any) {
        console.warn(
          `[Shopify Multi-Location Error] FO execution failed for ${orderName} (${fulfillmentOrderId}):`,
          nodeFulfillErr?.message || nodeFulfillErr
        );
      }
    }

    return successfulFulfillments > 0;
  } catch (err: any) {
    console.warn(
      `[Shopify Fulfillment Exception] Non-blocking fulfillment failure for order ${orderName}:`,
      err?.message || err
    );
    return false;
  }
}

/**
 * Task 4 Helper: Queries Courier API (Pathao / Steadfast) for live delivery & payment status,
 * triggers Shopify Paid/Fulfilled auto-sync if 'delivered' or 'disbursed',
 * and computes the Zero-Risk Cash Discrepancy Flag.
 */
async function evaluateOrderStatusAndCashDiscrepancy(params: {
  admin: any;
  order: RawShopifyOrder;
  bookingDoc: any;
  storeConfig: any;
  isProOrEnterprise: boolean;
  cachedPathaoTokenRef: { token: string | null; attempted: boolean };
}): Promise<CourierReconciliationInfo> {
  const {
    admin,
    order,
    bookingDoc,
    storeConfig,
    isProOrEnterprise,
    cachedPathaoTokenRef,
  } = params;

  const expectedAmount =
    typeof order.codAmount === "number"
      ? order.codAmount
      : calculateCodAmount(order);

  if (!isProOrEnterprise) {
    return {
      courierStatus: "locked_tier",
      courierCashCollected: String(expectedAmount),
      hasCashDiscrepancy: false,
      discrepancyDelta: "0.00",
      autoSyncedPaidFulfilled: false,
    };
  }

  let liveStatus = bookingDoc?.courierStatus || "";
  let collectedAmount = Number(bookingDoc?.courierCashCollected ?? NaN);

  // If a booking exists in MongoDB, poll the respective courier's status & payment endpoint
  if (bookingDoc?.trackingNumber) {
    const cid = bookingDoc.trackingNumber;
    const courierKey = bookingDoc.courierKey;

    if (
      courierKey === "steadfast" &&
      storeConfig?.steadfastApiKey &&
      storeConfig?.steadfastSecretKey
    ) {
      try {
        const sfRes = await fetch(
          `https://portal.steadfast.com.bd/api/v1/status_by_cid/${encodeURIComponent(
            cid
          )}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "Api-Key": storeConfig.steadfastApiKey,
              "Secret-Key": storeConfig.steadfastSecretKey,
            },
            signal: AbortSignal.timeout(3000),
          }
        );
        if (sfRes.ok) {
          const sfData: any = await sfRes.json();
          liveStatus = String(
            sfData?.delivery_status ||
              sfData?.status ||
              liveStatus ||
              "delivered"
          ).toLowerCase();
          const apiCollected = Number(
            sfData?.cod_amount ??
              sfData?.collected_amount ??
              sfData?.amount ??
              NaN
          );
          if (!Number.isNaN(apiCollected)) {
            collectedAmount = apiCollected;
          }
        }
      } catch {
        // Fallback to stored/sandbox status
      }
    } else if (
      courierKey === "pathao" &&
      storeConfig?.pathaoClientId &&
      storeConfig?.pathaoSecret
    ) {
      try {
        if (!cachedPathaoTokenRef.token && !cachedPathaoTokenRef.attempted) {
          cachedPathaoTokenRef.attempted = true;
          const tokenRes = await getValidPathaoToken(storeConfig.shopDomain || "");
          cachedPathaoTokenRef.token = tokenRes.token;
        }

        if (cachedPathaoTokenRef.token) {
          const baseUrl = getPathaoBaseUrl(storeConfig?.pathaoEnvironment);
          const ptRes = await fetch(
            `${baseUrl}/aladdin/api/v1/orders/${encodeURIComponent(cid)}`,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${cachedPathaoTokenRef.token}`,
              },
              signal: AbortSignal.timeout(3000),
            }
          );
          if (ptRes.ok) {
            const ptData: any = await ptRes.json();
            const orderInfo = ptData?.data || ptData;
            liveStatus = String(
              orderInfo?.order_status ||
                orderInfo?.payment_status ||
                liveStatus ||
                "delivered"
            ).toLowerCase();
            const apiCollected = Number(
              orderInfo?.amount_to_collect ??
                orderInfo?.collected_amount ??
                orderInfo?.cod_amount ??
                NaN
            );
            if (!Number.isNaN(apiCollected)) {
              collectedAmount = apiCollected;
            }
          }
        }
      } catch {
        // Fallback to stored/sandbox status
      }
    } else if (
      courierKey === "redx" &&
      storeConfig?.redxAccessToken
    ) {
      try {
        const baseUrl = getRedxBaseUrl(storeConfig?.redxEnvironment);
        const rdxRes = await fetch(
          `${baseUrl}/v1.0.0-beta/parcels/info/${encodeURIComponent(cid)}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "API-ACCESS-TOKEN": `Bearer ${storeConfig.redxAccessToken}`,
            },
            signal: AbortSignal.timeout(3000),
          }
        );
        if (rdxRes.ok) {
          const rdxData: any = await rdxRes.json();
          const parcelInfo = rdxData?.parcel || rdxData?.data || rdxData;
          liveStatus = String(
            parcelInfo?.status ||
              parcelInfo?.delivery_status ||
              liveStatus ||
              "delivered"
          ).toLowerCase();
          const apiCollected = Number(
            parcelInfo?.cash_collection_amount ??
              parcelInfo?.collected_amount ??
              parcelInfo?.cod_amount ??
              NaN
          );
          if (!Number.isNaN(apiCollected)) {
            collectedAmount = apiCollected;
          }
        }
      } catch {
        // Fallback to stored/sandbox status
      }
    }
  }

  if (!liveStatus) {
    return {
      courierStatus: "unbooked",
      courierCashCollected: "0.00",
      hasCashDiscrepancy: false,
      discrepancyDelta: "0.00",
      autoSyncedPaidFulfilled: false,
    };
  }

  if (Number.isNaN(collectedAmount)) {
    collectedAmount = expectedAmount;
  }

  const normalizedStatus = liveStatus.toLowerCase();
  const isDeliveredOrDisbursed =
    normalizedStatus.includes("delivered") ||
    normalizedStatus.includes("disbursed");

  let autoSyncedPaidFulfilled = Boolean(
    bookingDoc?.shopifySyncedPaidFulfilled
  );

  // If courier status indicates 'delivered' or 'disbursed', mutate Shopify order to Paid & Fulfilled
  // ONLY if real booking doc with tracking number exists
  if (bookingDoc?.trackingNumber && isDeliveredOrDisbursed && !autoSyncedPaidFulfilled) {
    const courierLower = (bookingDoc?.courierKey || bookingDoc?.courierName || "").toLowerCase();
    const partnerName = courierLower.includes("pathao")
      ? "Pathao"
      : courierLower.includes("steadfast")
      ? "Steadfast"
      : courierLower.includes("redx")
      ? "RedX"
      : bookingDoc?.courierName || "Courier";

    const trkNumber = bookingDoc.trackingNumber;
    const trkUrl =
      bookingDoc?.trackingUrl ||
      getCourierTrackingUrl(
        bookingDoc?.courierKey || bookingDoc?.courierName,
        trkNumber,
        bookingDoc?.customerPhone || order.customerPhone
      );

    const synced = await syncOrderPaidAndFulfilledInShopify(
      admin,
      order.id,
      trkNumber,
      bookingDoc?.courierName || "BD Courier Partner",
      trkUrl
    );
    autoSyncedPaidFulfilled = synced || true;

    // Non-blocking Shopify order delivery tag
    addShopifyOrderTags(admin, order.id, [`${partnerName} Delivered`]).catch(() => {});

    if (bookingDoc?._id) {
      await ShipmentBooking.updateOne(
        { _id: bookingDoc._id },
        {
          $set: {
            courierStatus: normalizedStatus,
            courierCashCollected: collectedAmount.toFixed(2),
            shopifySyncedPaidFulfilled: true,
            trackingUrl: trkUrl,
          },
        }
      );
    }
  }

  // Zero Financial Risk Discrepancy Conditional Check:
  // Does Shopify Order Total Price !== Courier Cash Collected?
  const delta = collectedAmount - expectedAmount;
  const hasCashDiscrepancy = isDeliveredOrDisbursed && Math.abs(delta) > 0.01;

  return {
    courierStatus: normalizedStatus,
    courierCashCollected: collectedAmount.toFixed(2),
    hasCashDiscrepancy,
    discrepancyDelta: `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`,
    autoSyncedPaidFulfilled: isDeliveredOrDisbursed,
  };
}

/**
 * 3. ROUTING ENGINE EVALUATION LOGIC SNIPPET (For Webhook / Order Sync Evaluation)
 */
export function evaluateWebhookOrderRouting(params: {
  orderCity: string;
  customerSuccessRate: number;
  customRoutes: CustomRouteRule[];
  defaultCourier: string;
  minSuccessRate: number;
  isAutoRoutingEnabled: boolean;
}) {
  const {
    orderCity,
    customerSuccessRate,
    customRoutes,
    defaultCourier,
    minSuccessRate,
    isAutoRoutingEnabled,
  } = params;

  if (!isAutoRoutingEnabled) {
    return {
      status: "Manual Mode",
      isLockedForReview: false,
      assignedCourier: defaultCourier,
    };
  }

  // Step 1: Fraud Risk Safety Net Check
  if (customerSuccessRate < minSuccessRate) {
    return {
      status: "Risky - Locked for Manual Review",
      isLockedForReview: true,
      assignedCourier: null,
    };
  }

  const normalizedCity = (orderCity || "").trim().toLowerCase();

  // Step 2: Primary Exact District Match or Division Wildcard Match, Fallback to defaultCourier
  const exactDistrictRule = customRoutes.find(
    (r) => r.district.toLowerCase() === normalizedCity
  );

  const divisionWildcardRule = customRoutes.find((r) => {
    if (r.district !== "All Districts in Division") return false;
    const divisionDistricts = BANGLADESH_LOCATIONS[r.division] || [];
    return divisionDistricts.some(
      (d) => d.toLowerCase() === normalizedCity
    );
  });

  const assignedCourier =
    exactDistrictRule?.courier ||
    divisionWildcardRule?.courier ||
    customRoutes.find((r) => r.district === orderCity)?.courier ||
    defaultCourier;

  return {
    status: "Auto-Routed (Safe)",
    isLockedForReview: false,
    assignedCourier,
  };
}

function applyRoutingAndSafetyLogic(
  order: RawShopifyOrder,
  fraudStats: FraudStatsProfile | null,
  routingConfig: AutoRoutingConfig,
  defaultCourierFallback: string,
  reconciliation: CourierReconciliationInfo | null,
  isAiCleaned: boolean,
  trackingNumber?: string | null,
  cachedDistrict?: string | null
): NormalizedOrder {
  const locationString =
    `${order.city} ${order.province} ${order.shippingAddress}`.toLowerCase();

  // Zone Evaluation: AddressCache verified district check + Local Neighborhood Map + Substring matches
  const isDistrictDhaka = Boolean(
    cachedDistrict && cachedDistrict.trim().toLowerCase().includes("dhaka")
  );

  const matchesNeighborhood = DHAKA_NEIGHBORHOOD_KEYWORDS.some((keyword) =>
    locationString.includes(keyword)
  );

  const isInsideDhaka =
    isDistrictDhaka ||
    locationString.includes("dhaka") ||
    locationString.includes("dacca") ||
    matchesNeighborhood;

  const isEnabled = Boolean(
    routingConfig.isAutoRoutingEnabled ?? routingConfig.autoRoutingEnabled
  );
  const minRate = Number(
    routingConfig.minSuccessRate ?? routingConfig.minSafetySuccessRate ?? 70
  );
  const fallbackCourier =
    routingConfig.defaultCourier || defaultCourierFallback || "steadfast";

  const hasRealFraudHistory = Boolean(fraudStats && fraudStats.totalOrders > 0);
  const isBelowThreshold = hasRealFraudHistory && fraudStats!.successRate < minRate;

  const isCancelled = Boolean(order.isCancelled || (order as any).cancelledAt);
  const isClosed = Boolean(order.isClosed || (order as any).closedAt);
  const financialStatus = order.financialStatus || order.displayFinancialStatus || "UNPAID";
  const fulfillmentStatus = order.fulfillmentStatus || "UNFULFILLED";

  if (isEnabled) {
    if (isBelowThreshold) {
      return {
        ...order,
        isCancelled,
        isClosed,
        financialStatus,
        fulfillmentStatus,
        customerPhone: order.customerPhone,
        fraudStats,
        reconciliation,
        trackingNumber: trackingNumber || null,
        status: "Risky - Locked for Manual Review",
        isRiskyLocked: true,
        isInsideDhaka,
        assignedCourier: fallbackCourier,
        routingReason: `Blocked: Real Success Rate (${fraudStats!.successRate}%) < ${minRate}% threshold`,
        isAiCleaned,
      };
    }

    const orderCity = (order.city || "").trim();
    const effectiveCity = orderCity || cachedDistrict || (isInsideDhaka ? "Dhaka" : "");
    const normalizedCity = effectiveCity.toLowerCase();
    const customRoutes = routingConfig.customRoutes || [];

    const exactDistrictRule = customRoutes.find(
      (r) => r.district.toLowerCase() === normalizedCity
    );

    const divisionWildcardRule = customRoutes.find((r) => {
      if (r.district !== "All Districts in Division") return false;
      const divisionDistricts = BANGLADESH_LOCATIONS[r.division] || [];
      return divisionDistricts.some(
        (d) => d.toLowerCase() === normalizedCity
      );
    });

    const routedCourier =
      exactDistrictRule?.courier ||
      divisionWildcardRule?.courier ||
      (isInsideDhaka
        ? routingConfig.insideDhakaCourier
        : routingConfig.outsideDhakaCourier) ||
      fallbackCourier;

    const matchedRuleText = exactDistrictRule
      ? `District Match: ${exactDistrictRule.district} → ${exactDistrictRule.courier.toUpperCase()}`
      : divisionWildcardRule
      ? `Division Rule: ${divisionWildcardRule.division} → ${divisionWildcardRule.courier.toUpperCase()}`
      : isInsideDhaka
      ? `Inside Dhaka → ${routedCourier.toUpperCase()}`
      : `Default Courier → ${routedCourier.toUpperCase()}`;

    return {
      ...order,
      isCancelled,
      isClosed,
      financialStatus,
      fulfillmentStatus,
      customerPhone: order.customerPhone,
      fraudStats,
      reconciliation,
      trackingNumber: trackingNumber || null,
      status: reconciliation?.autoSyncedPaidFulfilled
        ? "Paid & Fulfilled (Auto-Synced)"
        : "Auto-Routed (Safe)",
      isRiskyLocked: false,
      isInsideDhaka,
      assignedCourier: routedCourier,
      routingReason: matchedRuleText,
      isAiCleaned,
    };
  }

  return {
    ...order,
    isCancelled,
    isClosed,
    financialStatus,
    fulfillmentStatus,
    customerPhone: order.customerPhone,
    fraudStats,
    reconciliation,
    trackingNumber: trackingNumber || null,
    status: isBelowThreshold
      ? "Risky - Locked for Manual Review"
      : reconciliation?.autoSyncedPaidFulfilled
      ? "Paid & Fulfilled (Auto-Synced)"
      : order.fulfillmentStatus,
    isRiskyLocked: isBelowThreshold,
    isInsideDhaka,
    assignedCourier: defaultCourierFallback,
    routingReason: isBelowThreshold
      ? `Blocked: Real Success Rate (${fraudStats!.successRate}%) < ${minRate}% threshold`
      : `Manual Mode → ${defaultCourierFallback.toUpperCase()}`,
    isAiCleaned,
  };
}

async function resolveCustomerFraudProfile(
  rawPhone: string,
  storeConfig: any,
  cachedPathaoTokenRef: { token: string | null; attempted: boolean }
): Promise<FraudStatsProfile | null> {
  const cleanPhone = formatBangladeshPhone(rawPhone);
  if (!cleanPhone || cleanPhone.length < 11) {
    return null;
  }
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  // Purge any previously poisoned sandbox mock records for this phone
  try {
    await GlobalFraudNetwork.deleteMany({
      phone: cleanPhone,
      dataSource: "multi_courier_sandbox_sync",
    });
  } catch {}

  const existingProfile: any = await GlobalFraudNetwork.findOne({
    phone: cleanPhone,
    dataSource: { $ne: "multi_courier_sandbox_sync" },
  }).lean();

  const isCacheFresh =
    existingProfile &&
    existingProfile.lastCheckedAt &&
    Date.now() - new Date(existingProfile.lastCheckedAt).getTime() <
      CACHE_TTL_MS;

  if (existingProfile && isCacheFresh) {
    return {
      phone: cleanPhone,
      totalDelivered: existingProfile.totalDelivered ?? 0,
      totalReturned: existingProfile.totalReturned ?? 0,
      totalOrders: existingProfile.totalOrders ?? 0,
      successRate: existingProfile.successRate ?? 100,
      fromCache: true,
    };
  }

  const requestSteadfastHistory = async () => {
    const apiKey = storeConfig?.steadfastApiKey?.trim();
    const secretKey = storeConfig?.steadfastSecretKey?.trim();
    if (!apiKey || !secretKey) return null;

    const response = await fetch(
      "https://portal.steadfast.com.bd/api/v1/check_delivery_history",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Api-Key": apiKey,
          "Secret-Key": secretKey,
        },
        body: JSON.stringify({ phone: cleanPhone }),
        signal: AbortSignal.timeout(3500),
      }
    );

    if (!response.ok) return null;
    const data: any = await response.json();
    const delivered = Number(
      data?.total_delivered ??
        data?.delivered ??
        data?.data?.total_delivered ??
        NaN
    );
    const returned = Number(
      data?.total_cancelled ??
        data?.returned ??
        data?.total_returned ??
        data?.data?.total_cancelled ??
        NaN
    );
    if (Number.isNaN(delivered) && Number.isNaN(returned)) return null;
    return {
      delivered: Number.isNaN(delivered) ? 0 : delivered,
      returned: Number.isNaN(returned) ? 0 : returned,
    };
  };

  const requestPathaoHistory = async () => {
    const clientId = storeConfig?.pathaoClientId?.trim();
    const clientSecret = storeConfig?.pathaoSecret?.trim();
    if (!clientId || !clientSecret) return null;

    if (!cachedPathaoTokenRef.attempted) {
      cachedPathaoTokenRef.attempted = true;
      try {
        const tokenRes = await getValidPathaoToken(storeConfig.shopDomain || "");
        cachedPathaoTokenRef.token = tokenRes.token;
      } catch {
        cachedPathaoTokenRef.token = null;
      }
    }

    if (!cachedPathaoTokenRef.token) return null;

    const baseUrl = getPathaoBaseUrl(storeConfig?.pathaoEnvironment);
    const historyUrl = new URL(`${baseUrl}/aladdin/api/v1/user-history`);
    historyUrl.searchParams.set("phone", cleanPhone);

    const response = await fetch(historyUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cachedPathaoTokenRef.token}`,
      },
      signal: AbortSignal.timeout(3500),
    });

    if (!response.ok) return null;
    const data: any = await response.json();
    const delivered = Number(
      data?.total_delivered ??
        data?.success_count ??
        data?.data?.total_delivered ??
        NaN
    );
    const returned = Number(
      data?.total_returned ??
        data?.return_count ??
        data?.data?.total_returned ??
        NaN
    );
    if (Number.isNaN(delivered) && Number.isNaN(returned)) return null;
    return {
      delivered: Number.isNaN(delivered) ? 0 : delivered,
      returned: Number.isNaN(returned) ? 0 : returned,
    };
  };

  const [steadfastOutcome, pathaoOutcome] = await Promise.allSettled([
    requestSteadfastHistory(),
    requestPathaoHistory(),
  ]);

  const liveSteadfast =
    steadfastOutcome.status === "fulfilled" ? steadfastOutcome.value : null;
  const livePathao =
    pathaoOutcome.status === "fulfilled" ? pathaoOutcome.value : null;

  // Real data only: if neither courier returned real delivery history, return null
  if (!liveSteadfast && !livePathao) {
    return null;
  }

  const steadfastDelivered = liveSteadfast?.delivered ?? 0;
  const steadfastReturned = liveSteadfast?.returned ?? 0;
  const pathaoDelivered = livePathao?.delivered ?? 0;
  const pathaoReturned = livePathao?.returned ?? 0;

  const totalDelivered = steadfastDelivered + pathaoDelivered;
  const totalReturned = steadfastReturned + pathaoReturned;
  const totalOrders = totalDelivered + totalReturned;

  if (totalOrders === 0) {
    return null;
  }

  const successRate = Math.round((totalDelivered / totalOrders) * 100);

  const savedProfile: any = await GlobalFraudNetwork.findOneAndUpdate(
    { phone: cleanPhone },
    {
      $set: {
        phone: cleanPhone,
        totalDelivered,
        totalReturned,
        totalOrders,
        successRate,
        steadfastDelivered,
        steadfastReturned,
        pathaoDelivered,
        pathaoReturned,
        dataSource: "live_courier_api",
        lastCheckedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return {
    phone: cleanPhone,
    totalDelivered: savedProfile.totalDelivered,
    totalReturned: savedProfile.totalReturned,
    totalOrders: savedProfile.totalOrders,
    successRate: savedProfile.successRate,
    fromCache: false,
  };
}

async function dispatchSingleOrderToCourier(params: {
  shopDomain: string;
  storeConfig: any;
  orderId: string;
  orderName: string;
  selectedCourier: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  isInsideDhaka: boolean;
  codAmount: string;
  currencyCode: string;
  warehouseNote: string;
  lineItems: OrderLineItem[];
  sharedPathaoTokenRef: { token: string | null; attempted: boolean };
  manualCityId?: number | null;
  manualZoneId?: number | null;
  manualAreaId?: number | null;
  manualAreaName?: string | null;
  admin?: any;
  financialStatus?: string;
  totalPrice?: string | number;
  totalWeight?: number;
}): Promise<{
  success: boolean;
  orderId: string;
  orderName: string;
  courierName: string;
  trackingNumber: string;
  message: string;
  slip?: DispatchedSlipRecord;
  isRiskyLocked?: boolean;
  limitReached?: boolean;
}> {
  const {
    shopDomain,
    storeConfig,
    orderId,
    orderName,
    selectedCourier,
    customerName,
    customerPhone,
    shippingAddress,
    isInsideDhaka,
    codAmount,
    currencyCode,
    warehouseNote,
    lineItems,
    sharedPathaoTokenRef,
    manualCityId,
    manualZoneId,
    manualAreaId,
    manualAreaName,
    financialStatus,
    totalPrice,
  } = params;

  // 1. Pre-Flight Double-Booking Atomic Check & Re-dispatch Safe Isolation
  const existingBooking: any = await ShipmentBooking.findOne({ shopDomain, orderId }).lean();
  let isRedispatch = false;
  let historicalEntryToArchive: any = null;

  if (existingBooking) {
    const currentStatus = String(existingBooking.courierStatus || "").toLowerCase().trim();
    const hasHistoricalTracking = Boolean(
      existingBooking.trackingNumber && String(existingBooking.trackingNumber).trim()
    );

    // Active in-flight booking check (<60 seconds)
    const isRecentInProgress =
      currentStatus === "booking_in_progress" &&
      existingBooking.updatedAt &&
      Date.now() - new Date(existingBooking.updatedAt).getTime() < 60000;

    if (isRecentInProgress) {
      return {
        success: false,
        orderId,
        orderName,
        courierName: existingBooking.courierName || "",
        trackingNumber: existingBooking.trackingNumber || "",
        message: `Order ${orderName} is currently being dispatched to a courier. Please wait a moment.`,
      };
    }

    // Terminal completion check: delivered or disbursed parcels must NOT be re-dispatched
    const isTerminalDelivered = ["delivered", "disbursed"].includes(currentStatus);
    if (isTerminalDelivered) {
      return {
        success: false,
        orderId,
        orderName,
        courierName: existingBooking.courierName || "",
        trackingNumber: existingBooking.trackingNumber || "",
        message: `Order ${orderName} has already been marked as DELIVERED/DISBURSED by ${existingBooking.courierName || "courier"} (${existingBooking.trackingNumber}). Completed deliveries cannot be re-dispatched.`,
      };
    }

    // Determine if this order is eligible for re-dispatch:
    // It has historical tracking but was cancelled, returned, or failed by the courier
    const isCancelledOrReturned =
      ["cancelled", "returned", "failed", "partial_delivery", "paid_returned", "return_received", "cancelled_by_courier", "delivery_failed"].includes(
        currentStatus
      ) ||
      currentStatus.includes("cancel") ||
      currentStatus.includes("return");

    if (hasHistoricalTracking && isCancelledOrReturned) {
      isRedispatch = true;
      historicalEntryToArchive = {
        courierKey: existingBooking.courierKey || "",
        courierName: existingBooking.courierName || "",
        trackingNumber: existingBooking.trackingNumber || "",
        trackingUrl: existingBooking.trackingUrl || "",
        courierStatus: existingBooking.courierStatus || "cancelled",
        deliveryStatus: existingBooking.deliveryStatus || "cancelled",
        codAmount: existingBooking.codAmount || "0.00",
        bookedAt: existingBooking.bookedAt || existingBooking.createdAt || new Date(),
        archivedAt: new Date(),
        reason: `redispatch_from_${existingBooking.courierStatus || "cancelled"}`,
      };
    } else if (
      hasHistoricalTracking &&
      ["in_transit", "booked", "accepted", "in_review", "processing"].includes(currentStatus)
    ) {
      return {
        success: false,
        orderId,
        orderName,
        courierName: existingBooking.courierName || "",
        trackingNumber: existingBooking.trackingNumber || "",
        message: `Order ${orderName} is actively in transit with ${existingBooking.courierName || "courier"} (${existingBooking.trackingNumber}). Please cancel the active shipment before re-dispatching.`,
      };
    }
  }

  // 2. AI Address Correction & Caching Pipeline (Respects Merchant Toggle)
  const isAiCleaningEnabled = Boolean(
    storeConfig?.aiAddressCleaningEnabled ?? true
  );
  const addressResolution = await cleanAndCacheAddress(shippingAddress, {
    allowAi: isAiCleaningEnabled,
  });

  if (addressResolution.confidence === "LOW" || !addressResolution.district) {
    return {
      success: false,
      isRiskyLocked: true,
      orderId,
      orderName,
      courierName: "",
      trackingNumber: "",
      message: `Address Quality Alert for ${orderName}: Address Confidence is LOW or district unidentifiable. Automated dispatch aborted and order locked for manual review.`,
    };
  }

  // 3. Pre-Flight Atomic Quota Reservation (Issue 8.2)
  const activePlan = storeConfig?.currentPlan || "Free";
  const tierLimit = getPlanLimit(activePlan);
  let quotaReserved = false;

  if (Number.isFinite(tierLimit)) {
    const reservedConfig = await CourierConfig.findOneAndUpdate(
      { shopDomain, monthlyOrderCount: { $lt: tierLimit } },
      { $inc: { monthlyOrderCount: 1 } },
      { new: true }
    );
    if (!reservedConfig) {
      return {
        success: false,
        limitReached: true,
        orderId,
        orderName,
        courierName: "",
        trackingNumber: "",
        message: `Monthly order quota reached for your current plan (${tierLimit} orders). Please upgrade under the Pricing tab.`,
      };
    }
    quotaReserved = true;
  } else {
    await CourierConfig.updateOne(
      { shopDomain },
      { $inc: { monthlyOrderCount: 1 } }
    );
    quotaReserved = true;
  }

  // 4. Atomic Booking In-Progress Lock in MongoDB & Clean State Flush
  if (isRedispatch && historicalEntryToArchive) {
    // Atomically archive legacy tracking details into history sub-document array
    // Completely flush out primary active tracking placeholders before compiling the fresh payload
    await ShipmentBooking.findOneAndUpdate(
      { shopDomain, orderId },
      {
        $push: { bookingHistory: historicalEntryToArchive },
        $set: {
          shopDomain,
          orderId,
          orderName,
          trackingNumber: "",
          trackingUrl: "",
          courierKey: "",
          courierName: "",
          courierStatus: "booking_in_progress",
          deliveryStatus: "booking_in_progress",
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
  } else {
    await ShipmentBooking.findOneAndUpdate(
      { shopDomain, orderId },
      {
        $set: {
          shopDomain,
          orderId,
          orderName,
          courierStatus: "booking_in_progress",
          deliveryStatus: "booking_in_progress",
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
  }

  let courierDisplayName = "";

  // Helper to cleanly rollback quota reservation and in-progress lock on courier failure
  const rollbackBooking = async (errorMessage: string) => {
    if (quotaReserved) {
      await CourierConfig.updateOne(
        { shopDomain, monthlyOrderCount: { $gt: 0 } },
        { $inc: { monthlyOrderCount: -1 } }
      );
    }
    if (isRedispatch && historicalEntryToArchive) {
      // Re-dispatch failure recovery: restore the archived tracking state as inactive/cancelled
      await ShipmentBooking.updateOne(
        { shopDomain, orderId, courierStatus: "booking_in_progress" },
        {
          $set: {
            trackingNumber: historicalEntryToArchive.trackingNumber || "",
            trackingUrl: historicalEntryToArchive.trackingUrl || "",
            courierKey: historicalEntryToArchive.courierKey || "",
            courierName: historicalEntryToArchive.courierName || "",
            courierStatus: historicalEntryToArchive.courierStatus || "cancelled",
            deliveryStatus: historicalEntryToArchive.deliveryStatus || "cancelled",
            updatedAt: new Date(),
          },
        }
      );
    } else {
      await ShipmentBooking.deleteOne({
        shopDomain,
        orderId,
        courierStatus: "booking_in_progress",
      });
    }
    return {
      success: false,
      orderId,
      orderName,
      courierName: courierDisplayName,
      trackingNumber: "",
      message: errorMessage,
    };
  };

  // Automated Routing Integration:
  // If AI/Cache updates district to 'Dhaka', dispatch payload to Pathao Courier API.
  // If district is outside Dhaka, dispatch to Steadfast Courier API.
  const resolvedDistrict = addressResolution.district.trim();
  const isInsideDhakaResolved = resolvedDistrict.toLowerCase().includes("dhaka");
  const routedCourier = isInsideDhakaResolved ? "pathao" : "steadfast";
  const activeCourier = selectedCourier || routedCourier;

  // ==================== NOTE PRIORITIZATION OVERRIDE LOGIC ====================
  // 1. Resolve persistent "Default Parcel Note" for the active courier from storeConfig in database
  let courierDefaultNote = "";
  const normalizedActiveCourier = String(activeCourier || "").toLowerCase().trim();
  if (normalizedActiveCourier === "pathao") {
    courierDefaultNote = String(storeConfig?.pathaoParcelNote || storeConfig?.defaultParcelNote || "").trim();
  } else if (normalizedActiveCourier === "steadfast") {
    courierDefaultNote = String(storeConfig?.steadfastParcelNote || storeConfig?.defaultParcelNote || "").trim();
  } else if (normalizedActiveCourier === "redx") {
    courierDefaultNote = String(storeConfig?.redxParcelNote || storeConfig?.defaultParcelNote || "").trim();
  } else if (normalizedActiveCourier === "carrybee") {
    courierDefaultNote = String(storeConfig?.carrybeeParcelNote || storeConfig?.defaultParcelNote || "").trim();
  } else if (normalizedActiveCourier === "bahok") {
    courierDefaultNote = String(storeConfig?.bahokParcelNote || storeConfig?.defaultParcelNote || "").trim();
  } else {
    courierDefaultNote = String(storeConfig?.defaultParcelNote || "").trim();
  }

  // 2. Exact Condition Chain:
  // 1st Priority (Absolute): Custom text instruction typed/saved directly inside individual order row's "Warehouse Note"
  // 2nd Priority (Fallback): Persistent "Default Parcel Note" fetched from respective courier's configuration settings
  const rawWarehouseNote = String(warehouseNote || "").trim();
  const effectiveWarehouseNote = rawWarehouseNote
    ? rawWarehouseNote
    : courierDefaultNote
      ? courierDefaultNote
      : "";

  // Courier API transmission instruction (fallback to Shopify Order name if both are completely empty)
  const courierInstructionPayload = effectiveWarehouseNote || `Shopify Order ${orderName}`;

  const cleanPhone = formatBangladeshPhone(customerPhone);
  const cleanAddress =
    addressResolution.cleanAddress ||
    shippingAddress ||
    "";

  // ==================== DYNAMIC WEIGHT UNIT CONVERSION MATRIX & FALLBACK ====================
  const parcelWeightKg = calculateOrderWeightKg({
    lineItems,
    orderTotalWeight: params.totalWeight,
    courierKey: activeCourier,
    storeConfig,
  });

  // 1. AUTOMATIC ZERO-LOCK FOR PREPAID / AUTHORIZED ORDERS
  const rawFinStatus = String(financialStatus || "").toLowerCase().trim();
  const isPrepaidOrder =
    rawFinStatus === "paid" ||
    rawFinStatus === "authorized";

  let amountToCollect = 0;
  if (!isPrepaidOrder) {
    const parsedCod = Math.max(0, Math.round(Number(codAmount) || 0));
    const maxPayable = Math.round(
      Number(String(totalPrice || "0").replace(/[^0-9.]/g, "")) || 0
    );
    // Hard financial boundary guardrail: COD cannot exceed total remaining order value
    if (maxPayable > 0 && parsedCod > maxPayable) {
      amountToCollect = maxPayable;
    } else {
      amountToCollect = parsedCod;
    }
  }

  const redispatchCount = isRedispatch
    ? Number(existingBooking?.bookingHistory?.length || 0) + 1
    : 0;

  let finalTracking = "";

  if (activeCourier === "pathao") {
    courierDisplayName = "Pathao Courier";
    const clientId = storeConfig?.pathaoClientId?.trim();
    const clientSecret = storeConfig?.pathaoSecret?.trim();
    const storeId = storeConfig?.pathaoStoreId?.trim();

    if (!clientId || !clientSecret || !storeId) {
      return rollbackBooking(`Pathao credentials missing for ${orderName}.`);
    }

    try {
      if (!sharedPathaoTokenRef.attempted) {
        sharedPathaoTokenRef.attempted = true;
        const tokenRes = await getValidPathaoToken(shopDomain);
        sharedPathaoTokenRef.token = tokenRes.token;
      }

      if (!sharedPathaoTokenRef.token) {
        return rollbackBooking(`Pathao Auth Token failed for ${orderName}. Please check your Merchant credentials in Courier Settings.`);
      }

      // Resolve Pathao City & Zone IDs (respecting manual override if provided)
      let recipientCity: number;
      let recipientZone: number;

      if (
        manualCityId &&
        manualZoneId &&
        Number(manualCityId) > 0 &&
        Number(manualZoneId) > 0
      ) {
        recipientCity = Number(manualCityId);
        recipientZone = Number(manualZoneId);
      } else {
        const resolvedPathao = await resolvePathaoLocation(
          shopDomain,
          resolvedDistrict,
          addressResolution.thana,
          cleanAddress
        );
        recipientCity = resolvedPathao.recipient_city || 1;
        recipientZone = resolvedPathao.recipient_zone || 1;
      }

      const baseUrl = getPathaoBaseUrl(storeConfig?.pathaoEnvironment);
      const pathaoPayload = {
        store_id: Number(storeId) || storeId,
        merchant_order_id: isRedispatch
          ? `${orderName.replace("#", "").trim()}-R${redispatchCount}`
          : orderName.replace("#", "").trim(),
        recipient_name: customerName,
        recipient_phone: cleanPhone,
        recipient_address: cleanAddress,
        recipient_city: recipientCity,
        recipient_zone: recipientZone,
        delivery_type: 48,
        item_type: 2,
        special_instruction: courierInstructionPayload,
        item_quantity: 1,
        item_weight: parcelWeightKg,
        amount_to_collect: amountToCollect,
        item_description: `Order ${orderName} from ${shopDomain}`,
      };

      let orderResponse = await fetch(
        `${baseUrl}/aladdin/api/v1/orders`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${sharedPathaoTokenRef.token}`,
          },
          body: JSON.stringify(pathaoPayload),
          signal: AbortSignal.timeout(10000),
        }
      );

      // Silent 401 Unauthorized Interception & Automatic Retry with Fresh Token
      if (orderResponse.status === 401) {
        console.warn(`[Pathao 401 Intercept] Token expired for order ${orderName}. Triggering silent refresh...`);
        const refreshTokenRes = await getValidPathaoToken(shopDomain, { forceRefresh: true });
        if (refreshTokenRes.success && refreshTokenRes.token) {
          sharedPathaoTokenRef.token = refreshTokenRes.token;

          orderResponse = await fetch(
            `${baseUrl}/aladdin/api/v1/orders`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${sharedPathaoTokenRef.token}`,
              },
              body: JSON.stringify(pathaoPayload),
              signal: AbortSignal.timeout(10000),
            }
          );
        }
      }

      const orderResult: any = await orderResponse.json();
      const consignmentId =
        orderResult?.data?.consignment_id || orderResult?.consignment_id;

      if (!orderResponse.ok || !consignmentId) {
        const validationErrors = orderResult?.errors
          ? Object.values(orderResult.errors).flat().join(" | ")
          : "";
        return rollbackBooking(`Pathao Order Creation Failed (${orderName}): ${
          validationErrors || orderResult?.message || orderResponse.status
        }`);
      }

      finalTracking = String(consignmentId);
    } catch (err: any) {
      return rollbackBooking(`Pathao network error on ${orderName}: ${
        err?.message || "Unknown"
      }`);
    }
  } else if (activeCourier === "steadfast") {
    courierDisplayName = "Steadfast Courier";
    const apiKey = storeConfig?.steadfastApiKey?.trim();
    const secretKey = storeConfig?.steadfastSecretKey?.trim();

    if (!apiKey || !secretKey) {
      return rollbackBooking(`Steadfast credentials missing for ${orderName}. Please configure API Key and Secret Key in Courier Settings.`);
    }

    try {
      const sanitizedInvoice = String(orderName || orderId).replace(/[^a-zA-Z0-9_-]/g, "");
      const sfInvoice = isRedispatch
        ? `${sanitizedInvoice}-R${redispatchCount}`
        : sanitizedInvoice;
      const payload = {
        invoice: sfInvoice,
        recipient_name: customerName,
        recipient_phone: cleanPhone,
        recipient_address: cleanAddress,
        cod_amount: amountToCollect,
        note: courierInstructionPayload,
        weight: parcelWeightKg,
      };

      let sfResponse = await fetch("https://packzy.com/api/v1/create_order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Api-Key": apiKey,
          "Secret-Key": secretKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      // Secondary fallback to steadfast portal if packzy encounters 5xx server issues
      if (!sfResponse.ok && sfResponse.status >= 500) {
        try {
          sfResponse = await fetch(
            "https://portal.steadfast.com.bd/api/v1/create_order",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "Api-Key": apiKey,
                "Secret-Key": secretKey,
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(8000),
            }
          );
        } catch {
          // retain initial packzy response
        }
      }

      const sfData: any = await sfResponse.json();
      const trackingCode =
        sfData?.consignment?.tracking_code ||
        sfData?.consignment?.consignment_id ||
        sfData?.tracking_code;

      if (!sfResponse.ok || !trackingCode || (sfData.status && sfData.status !== 200)) {
        const validationErrors = sfData?.errors
          ? Object.values(sfData.errors).flat().join(" | ")
          : "";
        return rollbackBooking(`Steadfast Order Creation Failed (${orderName}): ${
          validationErrors || sfData?.message || `HTTP ${sfResponse.status}`
        }`);
      }

      finalTracking = String(trackingCode);
    } catch (err: any) {
      return rollbackBooking(`Steadfast network error on ${orderName}: ${
        err?.message || "Unknown"
      }`);
    }
  } else if (activeCourier === "redx") {
    courierDisplayName = "RedX Delivery";
    const token = storeConfig?.redxAccessToken?.trim();

    if (!token) {
      return rollbackBooking(`RedX credentials missing for ${orderName}. Please configure API Access Token in Courier Settings.`);
    }

    try {
      const baseUrl = getRedxBaseUrl(storeConfig?.redxEnvironment);
      const rawStoreId = storeConfig?.redxPickupStoreId || storeConfig?.redxLocationId;
      const pickupStoreId = rawStoreId ? Number(rawStoreId) : undefined;

      // Resolve RedX Delivery Area ID & Name (respecting manual override if provided)
      let deliveryAreaId: number;
      let deliveryArea: string;

      if (
        manualAreaId &&
        manualAreaName &&
        Number(manualAreaId) > 0 &&
        String(manualAreaName).trim()
      ) {
        deliveryAreaId = Number(manualAreaId);
        deliveryArea = String(manualAreaName).trim();
      } else {
        const resolvedRedx = await resolveRedxLocation(
          shopDomain,
          resolvedDistrict,
          addressResolution.thana,
          cleanAddress
        );
        deliveryAreaId = resolvedRedx.delivery_area_id || 1;
        deliveryArea = resolvedRedx.delivery_area || resolvedDistrict || "Dhaka";
      }

      const payload: Record<string, any> = {
        customer_name: customerName,
        customer_phone: cleanPhone,
        delivery_area: deliveryArea,
        delivery_area_id: deliveryAreaId,
        customer_address: cleanAddress,
        merchant_invoice_id: isRedispatch
          ? `${String(orderName || orderId).replace("#", "").trim()}-R${redispatchCount}`
          : String(orderName || orderId).replace("#", "").trim(),
        cash_collection_amount: String(amountToCollect),
        parcel_weight: Math.max(100, Math.round(parcelWeightKg * 1000)),
        instruction: courierInstructionPayload,
        value: amountToCollect || 100,
      };

      if (pickupStoreId && !Number.isNaN(pickupStoreId)) {
        payload.pickup_store_id = pickupStoreId;
      }

      const rdxResponse = await fetch(`${baseUrl}/v1.0.0-beta/parcels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "API-ACCESS-TOKEN": `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      const rdxData: any = await rdxResponse.json();
      const trackingId =
        rdxData?.tracking_id ||
        rdxData?.data?.tracking_id ||
        rdxData?.parcel?.tracking_id;

      if (!rdxResponse.ok || !trackingId) {
        const errorDetail =
          rdxData?.message ||
          rdxData?.error ||
          (rdxData?.errors ? Object.values(rdxData.errors).flat().join(" | ") : "") ||
          `HTTP ${rdxResponse.status}`;
        return rollbackBooking(`RedX Order Creation Failed (${orderName}): ${errorDetail}`);
      }

      finalTracking = String(trackingId);
    } catch (err: any) {
      return rollbackBooking(`RedX network error on ${orderName}: ${
        err?.message || "Unknown"
      }`);
    }
  } else if (activeCourier === "carrybee" || activeCourier.toLowerCase() === "carrybee") {
    courierDisplayName = "CarryBee";
    const clientId = storeConfig?.carrybeeClientId?.trim();
    const clientSecret = storeConfig?.carrybeeClientSecret?.trim();
    const clientContext = storeConfig?.carrybeeClientContext?.trim();
    const storeId = storeConfig?.carrybeeStoreId?.trim();

    if (!clientId || !clientSecret || !clientContext) {
      return rollbackBooking(
        `CarryBee credentials missing for ${orderName}. Please configure Client ID, Client Secret, and Client Context in Courier Settings.`
      );
    }

    try {
      const baseUrl = storeConfig?.carrybeeSandbox
        ? "https://stage-sandbox.carrybee.com"
        : "https://api.carrybee.com";

      const payload: Record<string, any> = {
        store_id: storeId || undefined,
        merchant_order_id: isRedispatch
          ? `${String(orderName || orderId).replace("#", "").trim()}-R${redispatchCount}`
          : String(orderName || orderId).replace("#", "").trim(),
        recipient_name: customerName,
        recipient_phone: cleanPhone,
        recipient_address: cleanAddress,
        collectable_amount: amountToCollect,
        notes: courierInstructionPayload,
        weight: parcelWeightKg,
      };

      const cbResponse = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Client-ID": clientId,
          "Client-Secret": clientSecret,
          "Client-Context": clientContext,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      const cbData: any = await cbResponse.json().catch(() => null);
      const trackingCode =
        cbData?.consignment_id ||
        cbData?.data?.consignment_id ||
        cbData?.tracking_id ||
        cbData?.data?.tracking_id ||
        cbData?.tracking_code ||
        cbData?.data?.tracking_code ||
        cbData?.order_id ||
        cbData?.data?.order_id;

      if (!cbResponse.ok || !trackingCode) {
        const errorDetail =
          cbData?.message ||
          cbData?.error ||
          (cbData?.errors ? Object.values(cbData.errors).flat().join(" | ") : "") ||
          `HTTP ${cbResponse.status}`;
        return rollbackBooking(
          `CarryBee Order Creation Failed (${orderName}): ${errorDetail}`
        );
      }

      finalTracking = String(trackingCode);
    } catch (err: any) {
      return rollbackBooking(
        `CarryBee network error on ${orderName}: ${err?.message || "Unknown"}`
      );
    }
  } else if (activeCourier === "bahok" || activeCourier.toLowerCase() === "bahok") {
    courierDisplayName = "Bahok Courier";
    const apiKey = storeConfig?.bahokApiKey?.trim();
    const apiToken = storeConfig?.bahokApiToken?.trim();
    const merchantId = storeConfig?.bahokMerchantId?.trim();

    if (!apiKey || !apiToken) {
      return rollbackBooking(
        `Bahok Courier credentials missing for ${orderName}. Please configure API Key and API Secret / Bearer Token in Courier Settings.`
      );
    }

    try {
      const baseUrl = "https://api.bahok.com.bd";

      const payload: Record<string, any> = {
        merchant_id: merchantId || undefined,
        merchant_order_id: isRedispatch
          ? `${String(orderName || orderId).replace("#", "").trim()}-R${redispatchCount}`
          : String(orderName || orderId).replace("#", "").trim(),
        recipient_name: customerName,
        recipient_phone: cleanPhone,
        recipient_address: cleanAddress,
        cod_amount: amountToCollect,
        instructions: courierInstructionPayload,
        weight: parcelWeightKg,
      };

      const bahokResponse = await fetch(`${baseUrl}/api/v1/orders/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiToken}`,
          "x-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      const bahokData: any = await bahokResponse.json().catch(() => null);
      const trackingCode =
        bahokData?.tracking_id ||
        bahokData?.data?.tracking_id ||
        bahokData?.consignment_id ||
        bahokData?.data?.consignment_id ||
        bahokData?.tracking_code ||
        bahokData?.data?.tracking_code ||
        bahokData?.invoice;

      if (!bahokResponse.ok || !trackingCode) {
        const errorDetail =
          bahokData?.message ||
          bahokData?.error ||
          (bahokData?.errors ? Object.values(bahokData.errors).flat().join(" | ") : "") ||
          `HTTP ${bahokResponse.status}`;
        return rollbackBooking(
          `Bahok Order Creation Failed (${orderName}): ${errorDetail}`
        );
      }

      finalTracking = String(trackingCode);
    } catch (err: any) {
      return rollbackBooking(
        `Bahok network error on ${orderName}: ${err?.message || "Unknown"}`
      );
    }
  } else {
    return rollbackBooking(`Invalid courier selected for ${orderName}.`);
  }

  const bookedAtIso = new Date().toISOString();
  const trackingUrl = getCourierTrackingUrl(activeCourier, finalTracking, cleanPhone);

  const normalizedActive = String(activeCourier || "").toLowerCase();
  const partnerName =
    normalizedActive === "pathao"
      ? "Pathao"
      : normalizedActive === "steadfast"
      ? "Steadfast"
      : normalizedActive === "redx"
      ? "RedX"
      : normalizedActive === "carrybee"
      ? "CarryBee"
      : normalizedActive === "bahok"
      ? "Bahok"
      : courierDisplayName;

  // 5. Automatic Shopify Fulfillment Mutation via fulfillmentCreateV2
  // Synchronizes courier tracking number, tracking URL, and triggers customer email
  let shopifyFulfilledSuccessfully = false;
  try {
    shopifyFulfilledSuccessfully = await createShopifyFulfillmentOnBooking({
      admin,
      shopDomain,
      orderId,
      orderName,
      trackingNumber: finalTracking,
      trackingUrl,
      courierName: courierDisplayName || partnerName,
    });
  } catch (fulfillErr: any) {
    console.warn(
      `[Shopify Fulfillment Mutation Notice] Non-blocking fulfillment failure for order ${orderName}:`,
      fulfillErr?.message || fulfillErr
    );
  }

  await ShipmentBooking.findOneAndUpdate(
    { shopDomain, orderId },
    {
      $set: {
        shopDomain,
        orderId,
        orderName,
        courierKey: activeCourier,
        courierName: courierDisplayName,
        trackingNumber: finalTracking,
        trackingUrl,
        customerName,
        customerPhone: cleanPhone,
        shippingAddress: cleanAddress,
        codAmount: String(amountToCollect),
        courierCashCollected: String(amountToCollect),
        courierStatus: "in_transit",
        shopifySyncedPaidFulfilled: shopifyFulfilledSuccessfully,
        shopifySyncedAt: shopifyFulfilledSuccessfully ? new Date() : undefined,
        currencyCode,
        warehouseNote: effectiveWarehouseNote,
        bookedAt: new Date(bookedAtIso),
      },
    },
    { upsert: true, new: true }
  );

  // Non-blocking Shopify Order Tagging: ["Courier Booked", "${partnerName} Booked"]
  if (admin) {
    addShopifyOrderTags(admin, orderId, [
      "Courier Booked",
      `${partnerName} Booked`,
    ]).catch(() => {});
  } else {
    unauthenticated
      .admin(shopDomain)
      .then(({ admin: offlineAdmin }) => {
        if (offlineAdmin) {
          addShopifyOrderTags(offlineAdmin, orderId, [
            "Courier Booked",
            `${partnerName} Booked`,
          ]).catch(() => {});
        }
      })
      .catch(() => {});
  }

  // Background Google Sheets Auto-Sync (Real-time append)
  syncOrderToGoogleSheet(shopDomain, {
    orderId: orderName || orderId,
    timestamp: bookedAtIso,
    customerName,
    phoneNumber: cleanPhone,
    rawAddress: shippingAddress,
    cleanedDistrict: addressResolution?.district || "Dhaka",
    cleanedThana: addressResolution?.thana || "",
    courierPartner: courierDisplayName,
    courierTrackingId: finalTracking,
  }).catch((sheetErr: any) =>
    console.warn("Google Sheets background auto-sync error:", sheetErr.message)
  );

  return {
    success: true,
    orderId,
    orderName,
    courierName: courierDisplayName,
    trackingNumber: finalTracking,
    message: `Order ${orderName} booked via ${courierDisplayName} (${finalTracking})`,
    slip: {
      orderId,
      orderName,
      trackingNumber: finalTracking,
      trackingUrl,
      courierName: courierDisplayName,
      courierStatus: "in_transit",
      customerName,
      customerPhone: cleanPhone,
      shippingAddress: cleanAddress,
      isInsideDhaka: isInsideDhakaResolved,
      codAmount: String(amountToCollect),
      currencyCode,
      warehouseNote: effectiveWarehouseNote,
      lineItems,
      bookedAt: bookedAtIso,
    },
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Stale scope check: ensure the session has the core scopes
  const REQUIRED_SCOPES = [
    "read_orders",
    "write_orders",
    "read_fulfillments",
    "write_fulfillments",
    "read_shipping",
    "write_shipping",
    "read_products",
  ];
  const grantedScopes = (session.scope || "").split(",").map((s) => s.trim());
  const isMissingCoreScopes = REQUIRED_SCOPES.some(
    (req) =>
      !grantedScopes.includes(req) &&
      !(req.startsWith("read_") && grantedScopes.includes(req.replace("read_", "write_")))
  );

  const url = new URL(request.url);
  const tabParam = (url.searchParams.get("tab") || "").toLowerCase().trim();
  const rawSearchQ = (url.searchParams.get("q") || "").trim();
  const startDateParam = (url.searchParams.get("startDate") || "").trim();
  const endDateParam = (url.searchParams.get("endDate") || "").trim();

  if (isMissingCoreScopes && !url.searchParams.has("reauth_attempted")) {
    console.warn(
      `Session for ${shopDomain} is missing required scopes. Stored: [${session.scope}]. Triggering re-auth...`
    );
    try {
      if ((sessionStorage as any)?.deleteSession && session.id) {
        await (sessionStorage as any).deleteSession(session.id);
      }
    } catch (e) {
      console.warn("Could not clear stale session from storage:", e);
    }
    return redirect(`/auth?shop=${encodeURIComponent(shopDomain)}`);
  }

  await connectDB();
  await ensureBillingCycleCurrent(shopDomain);
  try {
    await GlobalFraudNetwork.deleteMany({ dataSource: "multi_courier_sandbox_sync" });
  } catch {}
  let storeConfig: any = await CourierConfig.findOne({ shopDomain }).lean();

  if (!storeConfig) {
    const created = await CourierConfig.create({
      shopDomain,
      currentPlan: "Free",
      monthlyOrderCount: 0,
      billingCycleStart: new Date(),
      autoRoutingEnabled: false,
      insideDhakaCourier: "pathao",
      outsideDhakaCourier: "steadfast",
      minSafetySuccessRate: 70,
    });
    storeConfig = created.toObject();
  }
  storeConfig = decryptCourierConfig(storeConfig);

  const currentPlan = storeConfig?.currentPlan || "Free";
  const planLower = String(currentPlan).trim().toLowerCase();
  const isProOrEnterprise =
    planLower.startsWith("pro") || planLower.startsWith("enterprise");

  const monthlyOrderCount = Number(storeConfig?.monthlyOrderCount ?? 0);
  const rawLimit = getPlanLimit(currentPlan);
  const isUnlimited = !Number.isFinite(rawLimit);
  const planLimit = isUnlimited ? -1 : rawLimit;

  const rawBulkCap = getBulkBatchLimit(currentPlan);
  const isUnlimitedBulk = !Number.isFinite(rawBulkCap);
  const bulkBatchLimit = isUnlimitedBulk ? -1 : rawBulkCap;

  const isAutoRoutingEnabled = Boolean(
    storeConfig?.isAutoRoutingEnabled ?? storeConfig?.autoRoutingEnabled ?? false
  );
  const customRoutes: CustomRouteRule[] =
    Array.isArray(storeConfig?.customRoutes) &&
    storeConfig.customRoutes.length > 0
      ? storeConfig.customRoutes.map((r: any) => ({
          division: String(r.division || "Dhaka"),
          district: String(r.district || "Dhaka"),
          courier: String(r.courier || "pathao"),
        }))
      : [
          { division: "Dhaka", district: "Dhaka", courier: "pathao" },
          {
            division: "Chattogram",
            district: "All Districts in Division",
            courier: "steadfast",
          },
        ];
  const defaultCourier = String(storeConfig?.defaultCourier || "steadfast");
  const minSuccessRate = Number(
    storeConfig?.minSuccessRate ?? storeConfig?.minSafetySuccessRate ?? 70
  );

  const routingConfig: AutoRoutingConfig = {
    autoRoutingEnabled: isAutoRoutingEnabled,
    isAutoRoutingEnabled,
    insideDhakaCourier: storeConfig?.insideDhakaCourier || "pathao",
    outsideDhakaCourier: storeConfig?.outsideDhakaCourier || "steadfast",
    defaultCourier,
    minSafetySuccessRate: minSuccessRate,
    minSuccessRate,
    customRoutes,
  };

  const activeCouriers = {
    pathao: Boolean(
      storeConfig?.pathaoClientId?.trim() &&
        storeConfig?.pathaoSecret?.trim() &&
        storeConfig?.pathaoStoreId?.trim()
    ),
    steadfast: Boolean(
      storeConfig?.steadfastApiKey?.trim() &&
        storeConfig?.steadfastSecretKey?.trim()
    ),
    redx: Boolean(
      (storeConfig?.redxAccessToken?.trim() &&
        (storeConfig?.redxPickupStoreId?.trim() ||
          storeConfig?.redxLocationId?.trim())) ||
        (storeConfig?.redxProfileId?.trim() &&
          storeConfig?.redxLocationId?.trim())
    ),
    carrybee: Boolean(
      storeConfig?.carrybeeClientId?.trim() &&
        storeConfig?.carrybeeClientSecret?.trim() &&
        storeConfig?.carrybeeClientContext?.trim()
    ),
    bahok: Boolean(
      storeConfig?.bahokApiKey?.trim() &&
        storeConfig?.bahokApiToken?.trim()
    ),
  };

  const defaultCourierFallback = activeCouriers.pathao
    ? "pathao"
    : activeCouriers.steadfast
    ? "steadfast"
    : activeCouriers.redx
    ? "redx"
    : activeCouriers.carrybee
    ? "carrybee"
    : activeCouriers.bahok
    ? "bahok"
    : "pathao";

  // Pull existing booked tracking records from MongoDB for Task 4 Status & COD Sync
  const existingBookings = await ShipmentBooking.find({ shopDomain }).lean();
  const bookingsByOrderId: Record<string, any> = {};
  const initialDispatchedOrders: Record<string, DispatchedSlipRecord> = {};
  for (const b of existingBookings) {
    bookingsByOrderId[String(b.orderId)] = b;
    if (b.orderId && b.trackingNumber) {
      const trackingUrl =
        b.trackingUrl ||
        getCourierTrackingUrl(
          b.courierKey || b.courierName,
          b.trackingNumber,
          b.customerPhone
        );
      initialDispatchedOrders[String(b.orderId)] = {
        orderId: String(b.orderId),
        orderName: b.orderName || "",
        trackingNumber: b.trackingNumber,
        trackingUrl,
        courierName: b.courierName || "Courier",
        courierStatus: b.courierStatus || "in_transit",
        customerName: b.customerName || "",
        customerPhone: b.customerPhone || "",
        shippingAddress: b.shippingAddress || "",
        isInsideDhaka: false,
        codAmount: b.codAmount || "0.00",
        currencyCode: b.currencyCode || "BDT",
        warehouseNote: b.warehouseNote || "",
        lineItems: [],
        bookedAt: b.bookedAt
          ? new Date(b.bookedAt).toISOString()
          : new Date().toISOString(),
      };
    }
  }

  // Tier 2 Dynamic GraphQL Query Builder based on parsed search params
  const queryParts: string[] = [];
  let pageSize = 25;

  if (tabParam === "old_orders") {
    // Dynamic archived & historical order query
    queryParts.push("(fulfillment_status:fulfilled OR status:closed OR status:cancelled)");
    pageSize = 50;
  } else if (tabParam === "cancelled") {
    queryParts.push("(status:cancelled OR financial_status:voided)");
  } else if (tabParam === "pending") {
    // Unfulfilled rows matching manual locking criteria
    queryParts.push("fulfillment_status:unfulfilled");
  } else if (tabParam === "all") {
    queryParts.push("(status:open OR status:closed OR status:cancelled)");
  } else {
    // Default safe backward-compatible state (tab === "new" or parameter is omitted)
    queryParts.push("fulfillment_status:unfulfilled");
  }

  // Raw search query filter token across order IDs, customer names
  if (rawSearchQ) {
    const cleanQ = rawSearchQ.replace(/["\\]/g, "");
    if (cleanQ) {
      const orderSearchPart = cleanQ.startsWith("#")
        ? `name:${cleanQ}`
        : `(name:*${cleanQ}* OR customer_name:*${cleanQ}*)`;
      queryParts.push(orderSearchPart);
    }
  }

  // Date range filter tokens (Shopify index criteria syntax)
  if (startDateParam && endDateParam) {
    queryParts.push(`created_at:>=${startDateParam} created_at:<=${endDateParam}`);
  } else if (startDateParam) {
    queryParts.push(`created_at:>=${startDateParam}`);
  } else if (endDateParam) {
    queryParts.push(`created_at:<=${endDateParam}`);
  }

  const shopifyQueryString = queryParts.join(" ");

  let rawOrders: RawShopifyOrder[] = [];
  let graphqlWarning: string | null = null;

  const FULL_ORDERS_QUERY = `#graphql
    query GetOrdersWithItems($first: Int!, $query: String) {
      orders(first: $first, query: $query, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            cancelledAt
            cancelReason
            closedAt
            note
            displayFulfillmentStatus
            displayFinancialStatus
            totalOutstandingSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              firstName
              lastName
              phone
            }
            shippingAddress {
              name
              phone
              address1
              address2
              city
              province
              zip
              country
            }
            totalWeight
            lineItems(first: 10) {
              edges {
                node {
                  title
                  variantTitle
                  sku
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                    }
                  }
                  variant {
                    weight
                    weightUnit
                    image {
                      url
                      altText
                    }
                  }
                  product {
                    featuredImage {
                      url
                      altText
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

  const BASIC_ORDERS_QUERY = `#graphql
    query GetBasicOrdersWithItems($first: Int!, $query: String) {
      orders(first: $first, query: $query, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            cancelledAt
            cancelReason
            closedAt
            note
            displayFulfillmentStatus
            displayFinancialStatus
            totalOutstandingSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalWeight
            lineItems(first: 10) {
              edges {
                node {
                  title
                  variantTitle
                  sku
                  quantity
                  variant {
                    weight
                    weightUnit
                  }
                  originalUnitPriceSet {
                    shopMoney {
                      amount
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

  try {
    const response = await admin.graphql(FULL_ORDERS_QUERY, {
      variables: {
        first: pageSize,
        query: shopifyQueryString,
      },
    });
    const result: any = await response.json();

    // Check for GraphQL errors
    if (result.errors && result.errors.length > 0) {
      console.warn("GraphQL field notices in FULL_ORDERS_QUERY:", JSON.stringify(result.errors));
    }

    const edges = result?.data?.orders?.edges;
    if (!edges || (edges.length === 0 && result.errors?.length > 0 && !result.data?.orders)) {
      const topLevelError = result.errors?.[0]?.message || "Full orders query returned no data";
      throw new Error(topLevelError);
    }

    // If edges exist, process real live orders even if non-fatal customer field notices exist
    if (result.errors && result.errors.length > 0) {
      const isProtectedNotice = result.errors.some((e: any) =>
        /protected customer data|not approved to access|read_customers/i.test(e.message || "")
      );
      if (isProtectedNotice) {
        const hasLiveAddressData = edges.some(
          (edge: any) => Boolean(edge.node?.shippingAddress?.address1 || edge.node?.shippingAddress?.name)
        );
        if (!hasLiveAddressData) {
          graphqlWarning =
            "Orders loaded in restricted mode. Enable 'Protected Customer Data' in Shopify Partner Dashboard (App setup -> API access) to view customer names and delivery addresses.";
        }
      }
    }

    rawOrders = edges.map(({ node }: any) => {
      const addr = node.shippingAddress;
      const cust = node.customer;
      const customerName =
        addr?.name ||
        [cust?.firstName, cust?.lastName].filter(Boolean).join(" ") ||
        "";

      const customerPhone = addr?.phone || cust?.phone || "";

      const city = addr?.city || "";
      const province = addr?.province || city;
      const shippingAddress = addr
        ? [addr.address1, addr.address2, addr.city, addr.province, addr.zip]
            .filter(Boolean)
            .join(", ")
        : "";

      const displayFinancialStatus = String(node.displayFinancialStatus || "UNPAID");
      const totalOutstanding =
        node.totalOutstandingSet?.shopMoney?.amount ||
        (displayFinancialStatus.toUpperCase() === "PAID"
          ? "0.00"
          : node.totalPriceSet?.shopMoney?.amount || "0.00");
      const codAmount = calculateCodAmount({
        displayFinancialStatus,
        totalOutstandingSet: node.totalOutstandingSet,
        totalOutstanding,
        totalPrice: node.totalPriceSet?.shopMoney?.amount,
      });

      const itemEdges = node.lineItems?.edges || [];
      const lineItems: OrderLineItem[] = itemEdges.map(({ node: item }: any) => {
        const imageUrl =
          item.variant?.image?.url ||
          item.product?.featuredImage?.url ||
          "";
        return {
          title: item.title || "",
          variantTitle: item.variantTitle || "",
          sku: item.sku || "",
          quantity: Number(item.quantity || 1),
          unitPrice:
            item.originalUnitPriceSet?.shopMoney?.amount ||
            node.totalPriceSet?.shopMoney?.amount ||
            "0.00",
          imageUrl,
          weight: item.variant?.weight !== undefined ? Number(item.variant?.weight) : undefined,
          weightUnit: item.variant?.weightUnit ? String(item.variant?.weightUnit) : undefined,
        };
      });

      return {
        id: node.id,
        name: node.name,
        createdAt: node.createdAt,
        cancelledAt: node.cancelledAt || null,
        cancelReason: node.cancelReason || null,
        closedAt: node.closedAt || null,
        isCancelled: Boolean(node.cancelledAt),
        isClosed: Boolean(node.closedAt),
        customerName,
        customerPhone,
        shippingAddress,
        city,
        province,
        totalPrice: node.totalPriceSet?.shopMoney?.amount || "0.00",
        currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "BDT",
        fulfillmentStatus: node.displayFulfillmentStatus || "UNFULFILLED",
        displayFinancialStatus,
        financialStatus: displayFinancialStatus,
        totalOutstanding,
        codAmount,
        warehouseNote: node.note || "",
        lineItems,
        totalWeight: node.totalWeight !== undefined ? Number(node.totalWeight) : undefined,
      };
    });
  } catch (err: any) {
    console.warn("FULL_ORDERS_QUERY failed, attempting BASIC_ORDERS_QUERY fallback:", err?.message || err);
    const errMessage = String(err?.message || "");
    const isProtectedDataBlocked = /protected customer data|not approved to access|read_customers|access denied for customer|access denied for shippingAddress/i.test(
      errMessage
    );

    try {
      const fallbackResponse = await admin.graphql(BASIC_ORDERS_QUERY, {
        variables: {
          first: pageSize,
          query: shopifyQueryString,
        },
      });
      const fallbackResult: any = await fallbackResponse.json();

      if (fallbackResult.errors && fallbackResult.errors.length > 0) {
        console.warn("GraphQL field notices in BASIC_ORDERS_QUERY:", JSON.stringify(fallbackResult.errors));
      }

      const edges = fallbackResult?.data?.orders?.edges || [];
      if (edges.length === 0 && fallbackResult.errors?.length > 0 && !fallbackResult.data?.orders) {
        throw new Error(fallbackResult.errors[0].message);
      }

      rawOrders = edges.map(({ node }: any) => {
        const displayFinancialStatus = String(node.displayFinancialStatus || "UNPAID");
        const totalOutstanding =
          node.totalOutstandingSet?.shopMoney?.amount ||
          (displayFinancialStatus.toUpperCase() === "PAID"
            ? "0.00"
            : node.totalPriceSet?.shopMoney?.amount || "0.00");
        const codAmount = calculateCodAmount({
          displayFinancialStatus,
          totalOutstandingSet: node.totalOutstandingSet,
          totalOutstanding,
          totalPrice: node.totalPriceSet?.shopMoney?.amount,
        });

        const itemEdges = node.lineItems?.edges || [];
        const lineItems: OrderLineItem[] = itemEdges.map(({ node: item }: any) => {
          const imageUrl =
            item.variant?.image?.url ||
            item.product?.featuredImage?.url ||
            "";
          return {
            title: item.title || "",
            variantTitle: item.variantTitle || "",
            sku: item.sku || "",
            quantity: Number(item.quantity || 1),
            unitPrice:
              item.originalUnitPriceSet?.shopMoney?.amount ||
              node.totalPriceSet?.shopMoney?.amount ||
              "0.00",
            imageUrl,
          };
        });

        return {
          id: node.id,
          name: node.name,
          createdAt: node.createdAt,
          cancelledAt: node.cancelledAt || null,
          cancelReason: node.cancelReason || null,
          closedAt: node.closedAt || null,
          isCancelled: Boolean(node.cancelledAt),
          isClosed: Boolean(node.closedAt),
          customerName: "",
          customerPhone: "",
          shippingAddress: "",
          city: "",
          province: "",
          totalPrice: node.totalPriceSet?.shopMoney?.amount || "0.00",
          currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "BDT",
          fulfillmentStatus: node.displayFulfillmentStatus || "UNFULFILLED",
          displayFinancialStatus,
          financialStatus: displayFinancialStatus,
          totalOutstanding,
          codAmount,
          warehouseNote: node.note || "",
          lineItems,
        };
      });

      if (isProtectedDataBlocked) {
        graphqlWarning =
          "Orders loaded in safe mode without customer details. To view live customer names, phone numbers, and delivery addresses, enable 'Protected Customer Data' in Shopify Partner Dashboard -> App setup -> API access.";
      } else {
        graphqlWarning =
          "Orders loaded in basic mode. Enable 'Protected Customer Data' in Shopify Partners to read live customer names and addresses.";
      }
    } catch (fallbackErr: any) {
      console.error("Both FULL_ORDERS_QUERY and BASIC_ORDERS_QUERY failed:", fallbackErr?.message || fallbackErr);
      const finalMsg = String(fallbackErr?.message || errMessage);
      if (/protected customer data|not approved to access/i.test(finalMsg)) {
        graphqlWarning =
          "Could not query live orders due to Protected Customer Data restrictions. Please enable Protected Customer Data in your Shopify Partner Dashboard (App setup -> API access).";
      } else if (/read_products/i.test(finalMsg)) {
        graphqlWarning =
          "Product media and variant access restricted. Please re-authenticate your app to grant the 'read_products' scope.";
      } else if (/read_orders/i.test(finalMsg)) {
        graphqlWarning =
          "Could not query live orders from Shopify GraphQL API. Make sure 'read_orders' scope is enabled in your app configuration.";
      } else {
        graphqlWarning =
          `Could not query live orders from Shopify GraphQL API: ${finalMsg}`;
      }
    }
  }

  const cleanedAddresses = await AddressCache.find({
    rawInput: {
      $in: rawOrders
        .map((o) => (o.shippingAddress || "").trim().toLowerCase())
        .filter(Boolean),
    },
    confidence: { $in: ["HIGH", "MEDIUM"] },
  }).lean();
  const cleanedMap = new Set(cleanedAddresses.map((a: any) => a.rawInput));
  const addressCacheByRaw = new Map<string, any>(
    cleanedAddresses.map((a: any) => [a.rawInput, a])
  );

  const cachedPathaoTokenRef = {
    token: null as string | null,
    attempted: false,
  };

  // Enrich orders with Task 1 Fraud + Task 2 Routing + Task 4 Status Sync & Discrepancy Check
  const orders: NormalizedOrder[] = await Promise.all(
    rawOrders.map(async (order) => {
      const bookingDoc = bookingsByOrderId[order.id] || null;
      const trackingNumber: string | null = bookingDoc?.trackingNumber || null;

      let fraudStats: FraudStatsProfile | null = null;
      let reconciliation: CourierReconciliationInfo | null = null;

      try {
        const [resolvedFraud, resolvedRecon] = await Promise.all([
          order.customerPhone
            ? resolveCustomerFraudProfile(
                order.customerPhone,
                storeConfig,
                cachedPathaoTokenRef
              )
            : Promise.resolve(null),
          bookingDoc
            ? evaluateOrderStatusAndCashDiscrepancy({
                admin,
                order,
                bookingDoc,
                storeConfig,
                isProOrEnterprise,
                cachedPathaoTokenRef,
              })
            : Promise.resolve(null),
        ]);
        fraudStats = resolvedFraud;
        reconciliation = resolvedRecon;
      } catch (enrichErr: any) {
        console.warn(
          `Data enrichment warning for order ${order.name || order.id}:`,
          enrichErr?.message || enrichErr
        );
        fraudStats = null;
        reconciliation = null;
      }

      const rawAddressKey = (order.shippingAddress || "").trim().toLowerCase();
      const cachedRecord = addressCacheByRaw.get(rawAddressKey) || null;
      const isAiCleaned = cleanedMap.has(rawAddressKey);
      const cachedDistrict = cachedRecord?.district || null;

      return applyRoutingAndSafetyLogic(
        order,
        fraudStats,
        routingConfig,
        defaultCourierFallback,
        reconciliation,
        isAiCleaned,
        trackingNumber,
        cachedDistrict
      );
    })
  );

  const shippingLabelConfig = {
    labelSize: (storeConfig as any)?.labelSize || "4in x 6in",
    labelStyle: (storeConfig as any)?.labelStyle || "standard",
    socialHandle: (storeConfig as any)?.socialHandle || "",
    warehouseWarning:
      (storeConfig as any)?.warehouseWarning || "FRAGILE / HANDLE WITH CARE",
    brandName: (storeConfig as any)?.brandName || "",
    brandPhone: (storeConfig as any)?.brandPhone || "",
    brandAddress: (storeConfig as any)?.brandAddress || "",
    brandLogo: (storeConfig as any)?.brandLogo || "",
    defaultParcelNote: (storeConfig as any)?.defaultParcelNote || "",
    pathaoParcelNote: (storeConfig as any)?.pathaoParcelNote || "",
    steadfastParcelNote: (storeConfig as any)?.steadfastParcelNote || "",
    redxParcelNote: (storeConfig as any)?.redxParcelNote || "",
    carrybeeParcelNote: (storeConfig as any)?.carrybeeParcelNote || "",
    bahokParcelNote: (storeConfig as any)?.bahokParcelNote || "",
  };

  const invoiceConfig = {
    invoiceTemplate: (storeConfig as any)?.invoiceTemplate || "classic",
    invoiceBrandName:
      (storeConfig as any)?.invoiceBrandName ||
      (storeConfig as any)?.brandName ||
      "",
    invoiceBrandPhone:
      (storeConfig as any)?.invoiceBrandPhone ||
      (storeConfig as any)?.brandPhone ||
      "",
    invoiceBrandAddress:
      (storeConfig as any)?.invoiceBrandAddress ||
      (storeConfig as any)?.brandAddress ||
      "",
    invoiceBrandEmail: (storeConfig as any)?.invoiceBrandEmail || "",
    invoiceBrandWebsite: (storeConfig as any)?.invoiceBrandWebsite || "",
    invoiceBrandLogo:
      (storeConfig as any)?.invoiceBrandLogo ||
      (storeConfig as any)?.brandLogo ||
      "",
    invoiceAccentColor: (storeConfig as any)?.invoiceAccentColor || "#2563eb",
  };

  return {
    shopDomain,
    orders,
    activeCouriers,
    routingConfig,
    graphqlWarning,
    initialDispatchedOrders,
    usageSummary: {
      currentPlan,
      isProOrEnterprise,
      monthlyOrderCount,
      planLimit,
      isUnlimited,
      bulkBatchLimit,
      isUnlimitedBulk,
    },
    activeFilters: {
      tab: tabParam || "new",
      q: rawSearchQ,
      startDate: startDateParam,
      endDate: endDateParam,
    },
    shippingLabelConfig,
    invoiceConfig,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();
  await ensureBillingCycleCurrent(shopDomain);
  try {
    await GlobalFraudNetwork.deleteMany({ dataSource: "multi_courier_sandbox_sync" });
  } catch {}
  let storeConfig: any = await CourierConfig.findOne({ shopDomain }).lean();

  if (!storeConfig) {
    const created = await CourierConfig.create({
      shopDomain,
      currentPlan: "Free",
      monthlyOrderCount: 0,
      billingCycleStart: new Date(),
    });
    storeConfig = created.toObject();
  }
  storeConfig = decryptCourierConfig(storeConfig);

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "dispatchOrder");

  const activePlan = storeConfig?.currentPlan || "Free";
  const currentMonthlyCount = Number(storeConfig?.monthlyOrderCount ?? 0);
  const tierLimit = getPlanLimit(activePlan);
  const bulkCap = getBulkBatchLimit(activePlan);

  if (actionType === "bulkBookCouriers") {
    const rawOrdersJson = String(formData.get("ordersPayload") || "[]");
    let selectedBatch: any[] = [];

    try {
      selectedBatch = JSON.parse(rawOrdersJson);
    } catch {
      return {
        success: false,
        actionType: "bulkBookCouriers",
        limitReached: false,
        message: "Invalid bulk orders payload submitted.",
        bookedSlips: [] as DispatchedSlipRecord[],
      };
    }

    if (!Array.isArray(selectedBatch) || selectedBatch.length === 0) {
      return {
        success: false,
        actionType: "bulkBookCouriers",
        limitReached: false,
        message: "Please select at least one order for bulk courier booking.",
        bookedSlips: [] as DispatchedSlipRecord[],
      };
    }

    if (Number.isFinite(bulkCap) && selectedBatch.length > bulkCap) {
      return {
        success: false,
        actionType: "bulkBookCouriers",
        limitReached: true,
        message: `Bulk selection limit exceeded: Your ${activePlan} plan allows up to ${bulkCap} orders per bulk batch (you selected ${selectedBatch.length}). Please upgrade under Pricing & Billing.`,
        bookedSlips: [] as DispatchedSlipRecord[],
      };
    }

    if (
      Number.isFinite(tierLimit) &&
      currentMonthlyCount + selectedBatch.length > tierLimit
    ) {
      return {
        success: false,
        actionType: "bulkBookCouriers",
        limitReached: true,
        message:
          "Monthly booking limit reached for your active plan. Please upgrade under the Pricing tab.",
        bookedSlips: [] as DispatchedSlipRecord[],
      };
    }

    const sharedPathaoTokenRef = {
      token: null as string | null,
      attempted: false,
    };

    const batchResults = await Promise.all(
      selectedBatch.map(async (item) => {
        if (item.isRiskyLocked && !item.manualOverrideConfirmed) {
          return {
            success: false,
            orderId: String(item.orderId),
            orderName: String(item.orderName),
            courierName: "",
            trackingNumber: "",
            message: `${item.orderName} skipped (Locked by Risk Safety Net)`,
          };
        }

        return dispatchSingleOrderToCourier({
          shopDomain,
          storeConfig,
          orderId: String(item.orderId || ""),
          orderName: String(item.orderName || ""),
          selectedCourier: String(item.selectedCourier || "pathao"),
          customerName: String(item.customerName || "Customer"),
          customerPhone: String(item.customerPhone || ""),
          shippingAddress: String(item.shippingAddress || ""),
          isInsideDhaka: Boolean(item.isInsideDhaka),
          codAmount: String(item.codAmount || "0"),
          currencyCode: String(item.currencyCode || "BDT"),
          warehouseNote: String(item.warehouseNote || ""),
          lineItems: Array.isArray(item.lineItems) ? item.lineItems : [],
          sharedPathaoTokenRef,
          manualCityId: item.manualCityId ? Number(item.manualCityId) : null,
          manualZoneId: item.manualZoneId ? Number(item.manualZoneId) : null,
          manualAreaId: item.manualAreaId ? Number(item.manualAreaId) : null,
          manualAreaName: item.manualAreaName ? String(item.manualAreaName) : null,
          admin,
          financialStatus: String(item.financialStatus || item.displayFinancialStatus || ""),
          totalPrice: item.totalPrice,
          totalWeight: item.totalWeight ? Number(item.totalWeight) : undefined,
        });
      })
    );

    const succeededSlips = batchResults
      .filter((r) => r.success && r.slip)
      .map((r) => r.slip as DispatchedSlipRecord);

    const failedMessages = batchResults
      .filter((r) => !r.success)
      .map((r) => r.message);

    // Quota was atomically reserved pre-flight per order in dispatchSingleOrderToCourier

    const lockedOrders = batchResults
      .filter((r) => r.isRiskyLocked)
      .map((r) => r.orderId);

    if (succeededSlips.length === 0) {
      return {
        success: false,
        actionType: "bulkBookCouriers",
        limitReached: false,
        message: `Bulk booking failed for all ${selectedBatch.length} selected orders. ${failedMessages.join(" | ")}`,
        bookedSlips: [] as DispatchedSlipRecord[],
        lockedOrderIds: lockedOrders,
      };
    }

    return {
      success: true,
      actionType: "bulkBookCouriers",
      limitReached: false,
      message: `Bulk Fulfillment Complete! ${succeededSlips.length} of ${
        selectedBatch.length
      } orders booked with couriers and ready for packing slip printing.${
        failedMessages.length > 0 ? ` (${failedMessages.join(" | ")})` : ""
      }`,
      bookedSlips: succeededSlips,
      lockedOrderIds: lockedOrders,
    };
  }

  const orderId = String(formData.get("orderId") || "");
  const orderName = String(formData.get("orderName") || "");
  const selectedCourier = String(formData.get("selectedCourier") || "");
  const customerName = String(
    formData.get("customerName") || "Customer"
  ).trim();
  const rawCustomerPhone = String(formData.get("customerPhone") || "");
  const rawShippingAddress = String(
    formData.get("shippingAddress") || ""
  ).trim();
  const isInsideDhaka = String(formData.get("isInsideDhaka")) === "true";
  const codAmount = String(formData.get("codAmount") || "0");
  const currencyCode = String(formData.get("currencyCode") || "BDT");
  const warehouseNote = String(formData.get("warehouseNote") || "");
  const isRiskyLocked = String(formData.get("isRiskyLocked")) === "true";
  const manualOverrideConfirmed =
    String(formData.get("manualOverrideConfirmed")) === "true";

  const manualCityId = formData.get("manualCityId")
    ? Number(formData.get("manualCityId"))
    : null;
  const manualZoneId = formData.get("manualZoneId")
    ? Number(formData.get("manualZoneId"))
    : null;
  const manualAreaId = formData.get("manualAreaId")
    ? Number(formData.get("manualAreaId"))
    : null;
  const manualAreaName = formData.get("manualAreaName")
    ? String(formData.get("manualAreaName"))
    : null;

  let parsedLineItems: OrderLineItem[] = [];
  try {
    parsedLineItems = JSON.parse(String(formData.get("lineItemsJson") || "[]"));
  } catch {
    parsedLineItems = [];
  }

  if (isRiskyLocked && !manualOverrideConfirmed) {
    return {
      success: false,
      actionType: "dispatchOrder",
      limitReached: false,
      message: `Order ${orderName} is locked by the Risk Safety Net. Please review and approve the order first.`,
      bookedSlips: [] as DispatchedSlipRecord[],
    };
  }

  if (Number.isFinite(tierLimit) && currentMonthlyCount >= tierLimit) {
    return {
      success: false,
      actionType: "dispatchOrder",
      limitReached: true,
      message:
        "Monthly booking limit reached for your active plan. Please upgrade under the Pricing tab.",
      bookedSlips: [] as DispatchedSlipRecord[],
    };
  }

  const sharedPathaoTokenRef = {
    token: null as string | null,
    attempted: false,
  };

  const singleResult = await dispatchSingleOrderToCourier({
    shopDomain,
    storeConfig,
    orderId,
    orderName,
    selectedCourier,
    customerName,
    customerPhone: rawCustomerPhone,
    shippingAddress: rawShippingAddress,
    isInsideDhaka,
    codAmount,
    currencyCode,
    warehouseNote,
    lineItems: parsedLineItems,
    sharedPathaoTokenRef,
    manualCityId,
    manualZoneId,
    manualAreaId,
    manualAreaName,
    admin,
    financialStatus: String(formData.get("financialStatus") || ""),
    totalPrice: formData.get("totalPrice") ? String(formData.get("totalPrice")) : undefined,
    totalWeight: formData.get("totalWeight") ? Number(formData.get("totalWeight")) : undefined,
  });

  return {
    success: singleResult.success,
    actionType: "dispatchOrder",
    limitReached: singleResult.limitReached || false,
    message: singleResult.message,
    bookedSlips: singleResult.slip ? [singleResult.slip] : [],
    isRiskyLocked: singleResult.isRiskyLocked || false,
    orderId: singleResult.orderId,
  };
};

function DynamicBarcodeGraphic({
  code,
  height = 46,
}: {
  code?: string;
  height?: number;
}) {
  const cleanCode = (code || "").trim();
  if (!cleanCode) {
    return (
      <div style={{ display: "inline-block", textAlign: "center", padding: "6px" }}>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "11px",
            fontWeight: 600,
            color: "#6b7280",
          }}
        >
          [ Consignment Pending Booking ]
        </div>
      </div>
    );
  }
  const bars: number[] = [];
  for (let i = 0; i < cleanCode.length; i++) {
    const charCode = cleanCode.charCodeAt(i);
    bars.push((charCode % 3) + 1);
    bars.push(((charCode >> 2) % 2) + 1);
  }

  let currentX = 4;
  return (
    <div style={{ display: "inline-block", textAlign: "center" }}>
      <svg
        width={Math.max(150, bars.length * 6 + 12)}
        height={height}
        viewBox={`0 0 ${Math.max(150, bars.length * 6 + 12)} ${height}`}
        style={{ background: "#ffffff", display: "block" }}
      >
        {bars.map((barWidth, idx) => {
          const xPos = currentX;
          currentX += barWidth * 2 + 2;
          return (
            <rect
              key={`${idx}-${xPos}`}
              x={xPos}
              y={4}
              width={barWidth * 1.6}
              height={height - 8}
              fill="#111827"
            />
          );
        })}
      </svg>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "1.5px",
          marginTop: "2px",
          color: "#111827",
        }}
      >
        *{cleanCode}*
      </div>
    </div>
  );
}

const formatDateToYMD = (d: Date | null): string => {
  if (!d || Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getPrintLabelDimensions = (size: string) => {
  switch (size) {
    case "4in x 6in":
      return { width: "100mm", maxHeight: "148mm", padding: "6mm" };
    case "4in x 2in":
      return { width: "100mm", maxHeight: "48mm", padding: "3mm" };
    case "3in x 4in":
      return { width: "75mm", maxHeight: "98mm", padding: "4mm" };
    case "3in x 3in":
      return { width: "75mm", maxHeight: "73mm", padding: "4mm" };
    case "3in x 2in":
      return { width: "75mm", maxHeight: "48mm", padding: "3mm" };
    case "2in x 1.5in":
      return { width: "50mm", maxHeight: "36mm", padding: "2.5mm" };
    case "1.5in x 1in":
      return { width: "38mm", maxHeight: "23mm", padding: "2mm" };
    case "2in x 1in":
      return { width: "50mm", maxHeight: "23mm", padding: "2mm" };
    case "2in x 1.15in":
      return { width: "50mm", maxHeight: "27mm", padding: "2mm" };
    case "2.2in x 1.4in":
      return { width: "55mm", maxHeight: "33mm", padding: "2.5mm" };
    case "2in x 2.95in":
      return { width: "50mm", maxHeight: "72mm", padding: "3mm" };
    default:
      return { width: "100mm", maxHeight: "148mm", padding: "6mm" };
  }
};

export const resolveEffectiveNote = (
  slip: any,
  labelConfig?: any
): string => {
  const rowNote = String(slip?.warehouseNote || "").trim();
  if (rowNote) return rowNote;

  const courierKey = String(slip?.courierName || "").toLowerCase();
  let defaultNote = "";
  if (courierKey.includes("pathao")) {
    defaultNote = labelConfig?.pathaoParcelNote || "";
  } else if (courierKey.includes("steadfast")) {
    defaultNote = labelConfig?.steadfastParcelNote || "";
  } else if (courierKey.includes("redx")) {
    defaultNote = labelConfig?.redxParcelNote || "";
  } else if (courierKey.includes("carrybee")) {
    defaultNote = labelConfig?.carrybeeParcelNote || "";
  } else if (courierKey.includes("bahok")) {
    defaultNote = labelConfig?.bahokParcelNote || "";
  }
  if (!defaultNote) {
    defaultNote = labelConfig?.defaultParcelNote || "";
  }
  return defaultNote || "Handle with care • Fragile";
};

interface DatePresetItem {
  id: string;
  title: string;
}

const DATE_PRESET_ITEMS: DatePresetItem[] = [
  { id: "all", title: "All time" },
  { id: "today", title: "Today" },
  { id: "yesterday", title: "Yesterday" },
  { id: "last7", title: "Last 7 Days" },
  { id: "last30", title: "Last 30 Days" },
  { id: "last3m", title: "Last 3 months" },
  { id: "last6m", title: "Last 6 months" },
];

export default function OrdersFulfillmentPage() {
  const {
    shopDomain,
    orders,
    activeCouriers,
    routingConfig,
    graphqlWarning,
    initialDispatchedOrders,
    usageSummary,
    activeFilters,
    shippingLabelConfig,
    invoiceConfig,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") || "";
  const initialTabId = urlTab || activeFilters?.tab || "new";

  const [manuallyUnlockedOrders, setManuallyUnlockedOrders] = useState<
    Record<string, boolean>
  >({});
  const [lockedRiskOrders, setLockedRiskOrders] = useState<
    Record<string, boolean>
  >({});

  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [selectedCouriersByOrder, setSelectedCouriersByOrder] = useState<
    Record<string, string>
  >({});
  const [warehouseNotesByOrder, setWarehouseNotesByOrder] = useState<
    Record<string, string>
  >({});

  const [manualCityIds, setManualCityIds] = useState<Record<string, string>>({});
  const [manualZoneIds, setManualZoneIds] = useState<Record<string, string>>({});
  const [manualAreaIds, setManualAreaIds] = useState<Record<string, string>>({});
  const [manualAreaNames, setManualAreaNames] = useState<Record<string, string>>({});
  const [showLocationOverride, setShowLocationOverride] = useState<
    Record<string, boolean>
  >({});

  const [dispatchedOrders, setDispatchedOrders] = useState<
    Record<string, DispatchedSlipRecord>
  >(initialDispatchedOrders || {});
  const [batchPrintSlips, setBatchPrintSlips] = useState<DispatchedSlipRecord[]>([]);
  const [showPackingSlipView, setShowPackingSlipView] = useState(false);
  const [customCodAmountsByOrder, setCustomCodAmountsByOrder] = useState<Record<string, string>>({});
  const [showCodEdit, setShowCodEdit] = useState<Record<string, boolean>>({});

  const planNormalized = usageSummary.currentPlan.toLowerCase();
  const isFreePlan = planNormalized === "free";
  const isEnterprisePlan = planNormalized === "enterprise";
  const isProOrEnterprise = usageSummary.isProOrEnterprise;

  const defaultTemplateByPlan = isEnterprisePlan
    ? "warehouse"
    : isFreePlan
    ? "classic"
    : "modern";

  const [selectedSlipTemplate, setSelectedSlipTemplate] = useState<string>(
    invoiceConfig?.invoiceTemplate || defaultTemplateByPlan
  );
  const [customShopSlogan, setCustomShopSlogan] = useState(
    "100% Authentic Bangladeshi Products • Fast Nationwide Delivery"
  );

  const brandName =
    invoiceConfig?.invoiceBrandName ||
    shippingLabelConfig?.brandName ||
    "";
  const brandPhone =
    invoiceConfig?.invoiceBrandPhone ||
    shippingLabelConfig?.brandPhone ||
    "";
  const brandAddress =
    invoiceConfig?.invoiceBrandAddress ||
    shippingLabelConfig?.brandAddress ||
    "";
  const brandLogo =
    invoiceConfig?.invoiceBrandLogo ||
    shippingLabelConfig?.brandLogo ||
    "";

  // Standalone printing configuration error banner states
  const [showLabelConfigError, setShowLabelConfigError] = useState(false);
  const [showInvoiceConfigError, setShowInvoiceConfigError] = useState(false);
  // Point 7 Cancelled Orders Printing Security banner state
  const [showCancelledOrdersPrintWarning, setShowCancelledOrdersPrintWarning] = useState(false);

  // Secondary dropdown for batch document printing (4x6 Shipping Labels vs A4 Invoices)
  const [isPrintPopoverActive, setIsPrintPopoverActive] = useState(false);
  const [printDocumentMode, setPrintDocumentMode] = useState<
    "labels_4x6" | "invoices_a4"
  >("invoices_a4");

  const [showBanner, setShowBanner] = useState(false);
  const [clientBatchError, setClientBatchError] = useState<string | null>(null);

  const [phoneCopiedToast, setPhoneCopiedToast] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleCopyPhone = useCallback((phone: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!phone) return;
    const cleanNumber = phone.trim();
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(cleanNumber).catch(() => {});
    }
    setPhoneCopiedToast(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => {
      setPhoneCopiedToast(false);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (invoiceConfig?.invoiceTemplate) {
      setSelectedSlipTemplate(invoiceConfig.invoiceTemplate);
    }
  }, [invoiceConfig?.invoiceTemplate]);

  useEffect(() => {
    if (isFreePlan) {
      setSelectedSlipTemplate("classic");
    } else if (!isEnterprisePlan && selectedSlipTemplate === "warehouse") {
      setSelectedSlipTemplate("modern");
    }
  }, [isFreePlan, isEnterprisePlan, selectedSlipTemplate]);

  useEffect(() => {
    if (actionData) {
      setShowBanner(true);
      setClientBatchError(null);
      if (actionData.isRiskyLocked && (actionData as any).orderId) {
        setLockedRiskOrders((prev) => ({
          ...prev,
          [(actionData as any).orderId]: true,
        }));
      }
      if (Array.isArray((actionData as any).lockedOrderIds)) {
        setLockedRiskOrders((prev) => {
          const updated = { ...prev };
          for (const id of (actionData as any).lockedOrderIds) {
            updated[id] = true;
          }
          return updated;
        });
      }
      if (
        actionData.success &&
        Array.isArray(actionData.bookedSlips) &&
        actionData.bookedSlips.length > 0
      ) {
        setDispatchedOrders((prev) => {
          const updated = { ...prev };
          for (const slip of actionData.bookedSlips) {
            updated[slip.orderId] = slip;
          }
          return updated;
        });
        setBatchPrintSlips(actionData.bookedSlips);
        setSelectedResources([]);
        setShowPackingSlipView(true);
      }
    }
  }, [actionData]);

  // 1. Filter Controls & States
  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("q") || activeFilters?.q || ""
  );
  const [selectedTabId, setSelectedTabId] = useState(initialTabId);
  const [isDatePopoverActive, setIsDatePopoverActive] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("all");
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null } | null>(() => {
    if (activeFilters?.startDate || activeFilters?.endDate) {
      return {
        start: activeFilters.startDate ? new Date(activeFilters.startDate) : null,
        end: activeFilters.endDate ? new Date(activeFilters.endDate) : null,
      };
    }
    return null;
  });
  const [tempRange, setTempRange] = useState<{ start: Date | null; end: Date | null } | null>(dateRange);
  const [startDateInput, setStartDateInput] = useState(() => formatDateToYMD(dateRange?.start ?? null));
  const [endDateInput, setEndDateInput] = useState(() => formatDateToYMD(dateRange?.end ?? null));
  const [dateRangeLabel, setDateRangeLabel] = useState(() => {
    if (activeFilters?.startDate && activeFilters?.endDate) {
      return `📅 ${activeFilters.startDate} ➔ ${activeFilters.endDate}`;
    }
    return "📅 All time";
  });

  const [{ month: pickerMonth, year: pickerYear }, setPickerMonthYear] = useState(() => {
    const d = dateRange?.start || new Date();
    return { month: d.getMonth(), year: d.getFullYear() };
  });

  useEffect(() => {
    if (urlTab && urlTab !== selectedTabId) {
      setSelectedTabId(urlTab);
    }
  }, [urlTab]);

  const handleMonthChange = useCallback((month: number, year: number) => {
    setPickerMonthYear({ month, year });
  }, []);

  const handleDatePickerChange = useCallback(({ start, end }: { start: Date; end: Date }) => {
    const normalizedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    const normalizedEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    setTempRange({ start: normalizedStart, end: normalizedEnd });
    setStartDateInput(formatDateToYMD(start));
    setEndDateInput(formatDateToYMD(end));
    setSelectedPresetId("custom");
  }, []);

  const handlePresetClick = useCallback((presetId: string) => {
    setSelectedPresetId(presetId);
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = null;

    if (presetId === "all") {
      start = null;
      end = null;
    } else if (presetId === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (presetId === "yesterday") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    } else if (presetId === "last7") {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      end = now;
    } else if (presetId === "last30") {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      end = now;
    } else if (presetId === "last3m") {
      start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate(), 0, 0, 0, 0);
      end = now;
    } else if (presetId === "last6m") {
      start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate(), 0, 0, 0, 0);
      end = now;
    }

    if (start && end) {
      setTempRange({ start, end });
      setStartDateInput(formatDateToYMD(start));
      setEndDateInput(formatDateToYMD(end));
      setPickerMonthYear({ month: start.getMonth(), year: start.getFullYear() });
    } else {
      setTempRange(null);
      setStartDateInput("");
      setEndDateInput("");
    }
  }, []);

  const handleStartDateInputChange = useCallback((val: string) => {
    setStartDateInput(val);
    setSelectedPresetId("custom");
    if (val.length === 10) {
      const parsed = new Date(val);
      if (!Number.isNaN(parsed.getTime())) {
        const startDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
        setTempRange((prev) => ({
          start: startDay,
          end: prev?.end || new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999),
        }));
        setPickerMonthYear({ month: parsed.getMonth(), year: parsed.getFullYear() });
      }
    }
  }, []);

  const handleEndDateInputChange = useCallback((val: string) => {
    setEndDateInput(val);
    setSelectedPresetId("custom");
    if (val.length === 10) {
      const parsed = new Date(val);
      if (!Number.isNaN(parsed.getTime())) {
        const endDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999);
        setTempRange((prev) => ({
          start: prev?.start || new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0),
          end: endDay,
        }));
      }
    }
  }, []);

  const handleCancelDatePopover = useCallback(() => {
    setTempRange(dateRange);
    setStartDateInput(formatDateToYMD(dateRange?.start ?? null));
    setEndDateInput(formatDateToYMD(dateRange?.end ?? null));
    setIsDatePopoverActive(false);
  }, [dateRange]);

  const handleApplyDatePopover = useCallback(() => {
    let finalRange: { start: Date; end: Date } | null = null;
    let label = "📅 All time";

    if (tempRange && tempRange.start) {
      const finalStart = tempRange.start;
      const finalEnd = tempRange.end || new Date(tempRange.start.getFullYear(), tempRange.start.getMonth(), tempRange.start.getDate(), 23, 59, 59, 999);
      finalRange = { start: finalStart, end: finalEnd };

      const matchedPreset = DATE_PRESET_ITEMS.find((p) => p.id === selectedPresetId && p.id !== "all");
      if (matchedPreset) {
        label = `📅 ${matchedPreset.title}`;
      } else {
        label = `📅 ${formatDateToYMD(finalStart)} ➔ ${formatDateToYMD(finalEnd)}`;
      }
    } else {
      setSelectedPresetId("all");
    }

    setDateRange(finalRange);
    setDateRangeLabel(label);
    setIsDatePopoverActive(false);

    if (
      searchParams.get("tab") === "old_orders" ||
      searchParams.has("startDate")
    ) {
      const nextParams = new URLSearchParams(searchParams);
      if (finalRange?.start) {
        nextParams.set("startDate", formatDateToYMD(finalRange.start));
      } else {
        nextParams.delete("startDate");
      }
      if (finalRange?.end) {
        nextParams.set("endDate", formatDateToYMD(finalRange.end));
      } else {
        nextParams.delete("endDate");
      }
      setSearchParams(nextParams, { replace: true });
    }
  }, [tempRange, selectedPresetId, searchParams, setSearchParams]);

  const handleClearAllDates = useCallback(() => {
    setDateRange(null);
    setTempRange(null);
    setSelectedPresetId("all");
    setStartDateInput("");
    setEndDateInput("");
    setDateRangeLabel("📅 All time");
  }, []);

  const checkIsLocked = useCallback(
    (order: NormalizedOrder) => {
      return (
        Boolean(
          order.fraudStats &&
            order.fraudStats.totalOrders > 0 &&
            order.fraudStats.successRate < (routingConfig.minSuccessRate || 70)
        ) &&
        (order.isRiskyLocked || Boolean(lockedRiskOrders[order.id])) &&
        !manuallyUnlockedOrders[order.id]
      );
    },
    [routingConfig.minSuccessRate, lockedRiskOrders, manuallyUnlockedOrders]
  );

  const matchesTab = useCallback(
    (order: NormalizedOrder, tabId: string) => {
      const dispatched = dispatchedOrders[order.id];
      const courierStatus = (
        dispatched?.courierStatus ||
        order.reconciliation?.courierStatus ||
        ""
      ).toLowerCase();
      const isLocked = checkIsLocked(order);

      const isCancelledOrder =
        Boolean(order.isCancelled) ||
        order.financialStatus?.toUpperCase() === "VOIDED" ||
        order.displayFinancialStatus?.toUpperCase() === "VOIDED" ||
        order.fulfillmentStatus?.toUpperCase() === "CANCELLED" ||
        courierStatus === "cancelled";

      const isClosedOrder =
        Boolean(order.isClosed) ||
        order.fulfillmentStatus?.toUpperCase() === "CLOSED";

      switch (tabId) {
        case "all":
          return true;
        case "new":
          return (
            !dispatched &&
            !order.isCancelled &&
            !order.isClosed &&
            !isCancelledOrder &&
            !isClosedOrder &&
            (order.fulfillmentStatus?.toUpperCase() === "UNFULFILLED" ||
              !order.fulfillmentStatus)
          );
        case "accepted":
          if (isCancelledOrder || isClosedOrder) return false;
          return (
            Boolean(dispatched) &&
            (courierStatus === "accepted" ||
              courierStatus === "in_review" ||
              courierStatus === "processing" ||
              courierStatus === "pending")
          );
        case "pending":
          if (isCancelledOrder || isClosedOrder) return false;
          return isLocked || courierStatus === "pending" || courierStatus === "hold";
        case "shipping":
          if (isCancelledOrder || isClosedOrder) return false;
          return (
            Boolean(dispatched) &&
            courierStatus !== "delivered" &&
            courierStatus !== "returned" &&
            courierStatus !== "cancelled" &&
            order.fulfillmentStatus?.toUpperCase() !== "FULFILLED"
          );
        case "delivered":
          if (isCancelledOrder) return false;
          return (
            Boolean(dispatched) &&
            (courierStatus === "delivered" ||
              order.fulfillmentStatus?.toUpperCase() === "FULFILLED" ||
              Boolean(order.reconciliation?.autoSyncedPaidFulfilled))
          );
        case "cancelled":
          return isCancelledOrder;
        case "returned":
          if (isCancelledOrder) return false;
          return courierStatus === "returned";
        case "partially_delivered":
          if (isCancelledOrder) return false;
          return (
            courierStatus === "partially_delivered" ||
            courierStatus.includes("partial")
          );
        case "paid_returned":
          if (isCancelledOrder) return false;
          return (
            courierStatus === "paid_returned" ||
            (courierStatus === "returned" &&
              Boolean(order.reconciliation?.courierCashCollected) &&
              order.reconciliation?.courierCashCollected !== "0.00")
          );
        case "old_orders":
          return (
            Boolean(order.isClosed) ||
            isClosedOrder ||
            order.fulfillmentStatus?.toUpperCase() === "FULFILLED" ||
            Boolean(order.reconciliation?.autoSyncedPaidFulfilled)
          );
        default:
          return true;
      }
    },
    [dispatchedOrders, checkIsLocked]
  );

  // Exact 11 Functional Tabs
  const tabDefinitions = useMemo(
    () => [
      { id: "all", content: "All" },
      { id: "new", content: "New" },
      { id: "accepted", content: "Accepted" },
      { id: "pending", content: "Pending" },
      { id: "shipping", content: "Shipping" },
      { id: "delivered", content: "Delivered" },
      { id: "cancelled", content: "Cancelled" },
      { id: "returned", content: "Returned" },
      { id: "partially_delivered", content: "Partially Delivered" },
      { id: "paid_returned", content: "Paid Returned" },
      { id: "old_orders", content: "Old Orders" },
    ],
    []
  );

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of tabDefinitions) {
      counts[tab.id] = orders.filter((o) => matchesTab(o, tab.id)).length;
    }
    return counts;
  }, [orders, tabDefinitions, matchesTab]);

  const tabsList = useMemo(
    () =>
      tabDefinitions.map((tab) => ({
        id: tab.id,
        content: tab.content,
        badge: String(tabCounts[tab.id] ?? 0),
      })),
    [tabDefinitions, tabCounts]
  );

  const selectedTabIndex = useMemo(() => {
    const idx = tabDefinitions.findIndex((t) => t.id === selectedTabId);
    return idx >= 0 ? idx : 1; // Default to 'new' (index 1)
  }, [tabDefinitions, selectedTabId]);

  const handleTabSelect = useCallback(
    (index: number) => {
      const targetTab = tabDefinitions[index]?.id || "new";
      setSelectedTabId(targetTab);

      // Sync URL parameters when switching between active and historical orders
      const currentParamTab = searchParams.get("tab") || "new";
      if (
        targetTab === "old_orders" ||
        currentParamTab === "old_orders" ||
        searchParams.has("tab")
      ) {
        const nextParams = new URLSearchParams(searchParams);
        if (targetTab === "new") {
          nextParams.delete("tab");
        } else {
          nextParams.set("tab", targetTab);
        }
        setSearchParams(nextParams, { replace: true });
      }
    },
    [tabDefinitions, searchParams, setSearchParams]
  );

  // 2. Tier 1 Non-Destructive Filter Pipeline
  const displayedOrders = useMemo(() => {
    return orders.filter((order) => {
      // 1. Search Query Filter (Phone, Order Name, Customer Name, Address, Tracking)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const qDigits = q.replace(/\D/g, "");
        const dispatched = dispatchedOrders[order.id];
        const matchesName = order.name.toLowerCase().includes(q);
        const phoneDigits = (order.customerPhone || "").replace(/\D/g, "");
        const matchesPhone = qDigits.length > 0 && phoneDigits.includes(qDigits);
        const matchesCustomer = order.customerName.toLowerCase().includes(q);
        const matchesAddress = order.shippingAddress.toLowerCase().includes(q);
        const matchesTracking = Boolean(
          dispatched?.trackingNumber?.toLowerCase().includes(q)
        );

        if (
          !matchesName &&
          !matchesPhone &&
          !matchesCustomer &&
          !matchesAddress &&
          !matchesTracking
        ) {
          return false;
        }
      }

      // 2. Active Tab Status Filter
      if (!matchesTab(order, selectedTabId)) {
        return false;
      }

      // 3. Date Range Selector Filter
      if (dateRange && (dateRange.start || dateRange.end)) {
        const orderTime = new Date(order.createdAt).getTime();
        if (dateRange.start && orderTime < dateRange.start.getTime()) {
          return false;
        }
        if (dateRange.end && orderTime > dateRange.end.getTime()) {
          return false;
        }
      }

      return true;
    });
  }, [orders, searchQuery, selectedTabId, dateRange, matchesTab, dispatchedOrders]);

  const riskyOrdersCount = displayedOrders.filter(
    (o) =>
      Boolean(
        o.fraudStats &&
        o.fraudStats.totalOrders > 0 &&
        o.fraudStats.successRate < (routingConfig.minSuccessRate || 70)
      ) &&
      (o.isRiskyLocked || Boolean(lockedRiskOrders[o.id])) &&
      !manuallyUnlockedOrders[o.id]
  ).length;

  const handleSelectionChange = useCallback(
    (
      selectionType: string,
      isSelecting: boolean,
      selection?: string | [number, number]
    ) => {
      setClientBatchError(null);
      if (selectionType === "all" || selectionType === "page") {
        if (isSelecting) {
          setSelectedResources(displayedOrders.map((o) => o.id));
        } else {
          setSelectedResources([]);
        }
        return;
      }

      if (typeof selection === "string") {
        setSelectedResources((prev) =>
          isSelecting
            ? prev.includes(selection)
              ? prev
              : [...prev, selection]
            : prev.filter((id) => id !== selection)
        );
      }
    },
    [displayedOrders]
  );

  const toggleSingleRowCheckbox = (orderId: string, checked: boolean) => {
    setClientBatchError(null);
    setSelectedResources((prev) =>
      checked ? [...prev, orderId] : prev.filter((id) => id !== orderId)
    );
  };

  const courierSelectOptions = useMemo(() => {
    const list: Array<{ label: string; value: string; disabled?: boolean }> = [];
    if (activeCouriers.pathao) {
      list.push({ label: "Pathao Courier", value: "pathao" });
    }
    if (activeCouriers.steadfast) {
      list.push({ label: "Steadfast Courier", value: "steadfast" });
    }
    if (activeCouriers.redx) {
      list.push({ label: "RedX Delivery", value: "redx" });
    }
    if (activeCouriers.carrybee) {
      list.push({ label: "CarryBee", value: "carrybee" });
    }
    if (activeCouriers.bahok) {
      list.push({ label: "Bahok Courier", value: "bahok" });
    }

    if (list.length === 0) {
      return [{ label: "No active courier configured", value: "", disabled: true }];
    }

    return list;
  }, [activeCouriers]);

  const hasActiveCouriers = useMemo(
    () => courierSelectOptions.some((opt) => !opt.disabled && opt.value !== ""),
    [courierSelectOptions]
  );

  const fallbackCourierOptions = [
    { label: "Pathao Courier", value: "pathao" },
    { label: "Steadfast Courier", value: "steadfast" },
    { label: "RedX Delivery", value: "redx" },
    { label: "CarryBee", value: "carrybee" },
    { label: "Bahok Courier", value: "bahok" },
  ];

  const templateSelectorOptions = [
    {
      label: "1. Classic Minimalist (Standard Clean Invoice)",
      value: "classic",
    },
    {
      label: isFreePlan
        ? "2. Modern Pro (🔒 Upgrade to Growth / Pro)"
        : "2. Modern Pro (Dynamic Accent & Visual Product Table)",
      value: "modern",
      disabled: isFreePlan,
    },
    {
      label: isEnterprisePlan
        ? "3. Warehouse Fulfillment (Enterprise Mode — Industrial Pick/Pack)"
        : "3. Warehouse Fulfillment (🔒 Upgrade to Enterprise)",
      value: "warehouse",
      disabled: !isEnterprisePlan,
    },
  ];

  const handleSendSingleOrder = (order: NormalizedOrder) => {
    const rawCourier =
      selectedCouriersByOrder[order.id] || order.assignedCourier;
    const isChosenActive = courierSelectOptions.some(
      (opt) => opt.value === rawCourier && !opt.disabled
    );
    const chosenCourier = isChosenActive
      ? rawCourier
      : courierSelectOptions[0]?.value || rawCourier;
    const isUnlocked = Boolean(manuallyUnlockedOrders[order.id]);
    const customNote = warehouseNotesByOrder[order.id] ?? order.warehouseNote;

    const isPrepaid =
      order.financialStatus?.toLowerCase() === "paid" ||
      order.financialStatus?.toLowerCase() === "authorized" ||
      order.displayFinancialStatus?.toUpperCase() === "PAID";

    const customCodVal = customCodAmountsByOrder[order.id];
    const maxOrderPrice = Math.round(
      Number(String(order.totalPrice || "0").replace(/[^0-9.]/g, "")) || 0
    );
    const enteredCodNum =
      customCodVal !== undefined && customCodVal.trim() !== ""
        ? Math.round(Number(String(customCodVal).replace(/[^0-9.]/g, "")) || 0)
        : null;

    // Rigid real-time intercept: block dispatch if custom COD exceeds order total
    if (!isPrepaid && enteredCodNum !== null && maxOrderPrice > 0 && enteredCodNum > maxOrderPrice) {
      return;
    }

    const effectiveCod = isPrepaid
      ? "0"
      : enteredCodNum !== null
      ? String(enteredCodNum)
      : String(order.codAmount);

    const formData = new FormData();
    formData.append("actionType", "dispatchOrder");
    formData.append("orderId", order.id);
    formData.append("orderName", order.name);
    formData.append("selectedCourier", chosenCourier);
    formData.append("customerName", order.customerName);
    formData.append("customerPhone", order.customerPhone);
    formData.append("shippingAddress", order.shippingAddress);
    formData.append("isInsideDhaka", String(order.isInsideDhaka));
    formData.append("codAmount", effectiveCod);
    formData.append("currencyCode", order.currencyCode);
    formData.append("warehouseNote", customNote);
    formData.append("financialStatus", String(order.financialStatus || order.displayFinancialStatus || ""));
    formData.append("totalPrice", String(order.totalPrice || ""));
    formData.append("totalWeight", String(order.totalWeight || ""));
    formData.append("lineItemsJson", JSON.stringify(order.lineItems));
    formData.append("isRiskyLocked", String(order.isRiskyLocked));
    formData.append("manualOverrideConfirmed", String(isUnlocked));

    // Optional manual location overrides
    if (manualCityIds[order.id]) {
      formData.append("manualCityId", manualCityIds[order.id]);
    }
    if (manualZoneIds[order.id]) {
      formData.append("manualZoneId", manualZoneIds[order.id]);
    }
    if (manualAreaIds[order.id]) {
      formData.append("manualAreaId", manualAreaIds[order.id]);
    }
    if (manualAreaNames[order.id]) {
      formData.append("manualAreaName", manualAreaNames[order.id]);
    }

    submit(formData, { method: "post" });
  };

  const handleBulkSendToCourier = () => {
    setClientBatchError(null);
    if (selectedResources.length === 0) return;

    if (
      !usageSummary.isUnlimitedBulk &&
      selectedResources.length > usageSummary.bulkBatchLimit
    ) {
      setClientBatchError(
        `Plan Cap Reached: Your ${usageSummary.currentPlan} tier allows up to ${usageSummary.bulkBatchLimit} orders per bulk batch (you selected ${selectedResources.length}). Please deselect some orders or upgrade your plan.`
      );
      return;
    }

    const selectedOrderObjects = displayedOrders
      .filter((order) => selectedResources.includes(order.id))
      .map((order) => {
        const rawCourier =
          selectedCouriersByOrder[order.id] || order.assignedCourier;
        const isChosenActive = courierSelectOptions.some(
          (opt) => opt.value === rawCourier && !opt.disabled
        );
        const selectedCourier = isChosenActive
          ? rawCourier
          : courierSelectOptions[0]?.value || rawCourier;

        const isPrepaid =
          order.financialStatus?.toLowerCase() === "paid" ||
          order.financialStatus?.toLowerCase() === "authorized" ||
          order.displayFinancialStatus?.toUpperCase() === "PAID";

        const customCodVal = customCodAmountsByOrder[order.id];
        const maxOrderPrice = Math.round(
          Number(String(order.totalPrice || "0").replace(/[^0-9.]/g, "")) || 0
        );
        const enteredCodNum =
          customCodVal !== undefined && customCodVal.trim() !== ""
            ? Math.round(Number(String(customCodVal).replace(/[^0-9.]/g, "")) || 0)
            : null;

        const effectiveCod = isPrepaid
          ? "0"
          : enteredCodNum !== null
          ? String(Math.min(enteredCodNum, maxOrderPrice > 0 ? maxOrderPrice : enteredCodNum))
          : String(order.codAmount);

        return {
          orderId: order.id,
          orderName: order.name,
          selectedCourier,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          shippingAddress: order.shippingAddress,
          isInsideDhaka: order.isInsideDhaka,
          codAmount: effectiveCod,
          currencyCode: order.currencyCode,
          warehouseNote: warehouseNotesByOrder[order.id] ?? order.warehouseNote,
          lineItems: order.lineItems,
          isRiskyLocked: order.isRiskyLocked,
          manualOverrideConfirmed: Boolean(manuallyUnlockedOrders[order.id]),
          financialStatus: String(order.financialStatus || order.displayFinancialStatus || ""),
          totalPrice: String(order.totalPrice || ""),
          totalWeight: order.totalWeight,
          manualCityId: manualCityIds[order.id] || null,
          manualZoneId: manualZoneIds[order.id] || null,
          manualAreaId: manualAreaIds[order.id] || null,
          manualAreaName: manualAreaNames[order.id] || null,
        };
      });

    const formData = new FormData();
    formData.append("actionType", "bulkBookCouriers");
    formData.append("ordersPayload", JSON.stringify(selectedOrderObjects));
    submit(formData, { method: "post" });
  };

  const isCourierActive = (courierNameOrKey?: string | null) => {
    if (!courierNameOrKey) return false;
    const c = courierNameOrKey.toLowerCase();
    if (c.includes("pathao")) return activeCouriers.pathao;
    if (c.includes("steadfast")) return activeCouriers.steadfast;
    if (c.includes("redx")) return activeCouriers.redx;
    if (c.includes("carrybee")) return activeCouriers.carrybee;
    if (c.includes("bahok")) return activeCouriers.bahok;
    return false;
  };

  const handleBulkAssignCourier = (courierKey: string) => {
    setSelectedCouriersByOrder((prev) => {
      const updated = { ...prev };
      for (const id of selectedResources) {
        updated[id] = courierKey;
      }
      return updated;
    });
    setShowLabelConfigError(false);
    setShowInvoiceConfigError(false);
  };

  // Master Audit List Point 7: Real-time order cancellation status evaluation helper
  const isOrderCancelledRecord = (order: any): boolean =>
    Boolean(
      order?.cancelReason ||
      order?.cancelledAt ||
      order?.isCancelled ||
      order?.displayFulfillmentStatus === "CANCELLED" ||
      order?.fulfillmentStatus === "CANCELLED" ||
      order?.status?.toLowerCase() === "cancelled"
    );

  const handlePrintLabels = () => {
    const selectedOrdersList = displayedOrders.filter((o) =>
      selectedResources.includes(o.id)
    );
    if (selectedOrdersList.length === 0) return;

    // Point 7 Check: Intercept single cancelled order print attempt
    if (selectedOrdersList.length === 1 && isOrderCancelledRecord(selectedOrdersList[0])) {
      setShowCancelledOrdersPrintWarning(true);
      setShowLabelConfigError(false);
      setShowInvoiceConfigError(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const hasCancelled = selectedOrdersList.some(isOrderCancelledRecord);
    setShowCancelledOrdersPrintWarning(hasCancelled);

    const hasUnbookedOrders = selectedOrdersList.some(
      (order) => !dispatchedOrders[order.id]?.trackingNumber && !order.trackingNumber
    );

    if (hasUnbookedOrders) {
      setShowLabelConfigError(true);
      setShowInvoiceConfigError(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setShowLabelConfigError(false);
    setShowInvoiceConfigError(false);
    handlePrintBatchDocuments("labels_4x6");
  };

  const handlePrintInvoices = () => {
    const selectedOrdersList = displayedOrders.filter((o) =>
      selectedResources.includes(o.id)
    );
    if (selectedOrdersList.length === 0) return;

    // Point 7 Check: Intercept single cancelled order print attempt
    if (selectedOrdersList.length === 1 && isOrderCancelledRecord(selectedOrdersList[0])) {
      setShowCancelledOrdersPrintWarning(true);
      setShowLabelConfigError(false);
      setShowInvoiceConfigError(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const hasCancelled = selectedOrdersList.some(isOrderCancelledRecord);
    setShowCancelledOrdersPrintWarning(hasCancelled);

    const hasMissingInvoiceConfig =
      !invoiceConfig ||
      !invoiceConfig.invoiceBrandName ||
      invoiceConfig.invoiceBrandName.trim() === "";

    if (hasMissingInvoiceConfig) {
      setShowInvoiceConfigError(true);
      setShowLabelConfigError(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setShowLabelConfigError(false);
    setShowInvoiceConfigError(false);
    handlePrintBatchDocuments("invoices_a4");
  };

  const handlePrintBatchDocuments = (mode: "labels_4x6" | "invoices_a4") => {
    setIsPrintPopoverActive(false);
    setPrintDocumentMode(mode);

    const selectedOrdersList = displayedOrders.filter((o) =>
      selectedResources.includes(o.id)
    );

    if (selectedOrdersList.length === 0) return;

    const hasCancelled = selectedOrdersList.some(isOrderCancelledRecord);
    if (hasCancelled) {
      setShowCancelledOrdersPrintWarning(true);
    }

    const slipsForPrint: DispatchedSlipRecord[] = selectedOrdersList.map((order) => {
      const orderIsCancelled = isOrderCancelledRecord(order);
      const chosenCourier = String(
        selectedCouriersByOrder[order.id] || order.assignedCourier || ""
      ).toLowerCase();
      const courierName =
        chosenCourier === "pathao"
          ? "Pathao Courier"
          : chosenCourier === "steadfast"
          ? "Steadfast Courier"
          : chosenCourier === "carrybee"
          ? "CarryBee"
          : chosenCourier === "bahok"
          ? "Bahok Courier"
          : chosenCourier === "redx"
          ? "RedX Delivery"
          : "";

      if (dispatchedOrders[order.id]) {
        return {
          ...dispatchedOrders[order.id],
          isCancelled: orderIsCancelled,
          cancelledAt: order.cancelledAt || null,
          cancelReason: (order as any).cancelReason || null,
        };
      }

      return {
        orderId: order.id,
        orderName: order.name,
        courierName,
        trackingNumber: order.trackingNumber || "",
        bookingDate: new Date().toLocaleDateString("en-GB"),
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        shippingAddress: order.shippingAddress,
        isInsideDhaka: order.isInsideDhaka,
        codAmount: String(order.codAmount),
        currencyCode: order.currencyCode,
        warehouseNote:
          warehouseNotesByOrder[order.id] ?? order.warehouseNote,
        lineItems: order.lineItems,
        bookedAt: new Date().toISOString(),
        isCancelled: orderIsCancelled,
        cancelledAt: order.cancelledAt || null,
        cancelReason: (order as any).cancelReason || null,
      };
    });

    setBatchPrintSlips(slipsForPrint);
    setShowPackingSlipView(true);

    if (typeof window !== "undefined") {
      setTimeout(() => {
        window.print();
      }, 350);
    }
  };

  const pendingActionType = navigation.formData?.get("actionType");
  const isBulkSubmitting =
    navigation.state === "submitting" &&
    pendingActionType === "bulkBookCouriers";
  const submittingOrderId = navigation.formData?.get("orderId");

  const bookedSlipsList =
    batchPrintSlips.length > 0
      ? batchPrintSlips
      : Object.values(dispatchedOrders);
  const isBatchOverPlanCap =
    !usageSummary.isUnlimitedBulk &&
    selectedResources.length > usageSummary.bulkBatchLimit;

  // Reorganized 8-Column Table Headings for High-Converting Courier Fulfillment
  const tableHeadings = [
    { title: "Order" },
    { title: "Products" },
    { title: "Customer" },
    { title: "Payment & COD" },
    { title: "Fraud Check" },
    { title: "Courier & Tracking" },
    { title: "Warehouse Note" },
    { title: "Action" },
  ];

  // Official Polaris Native Bulk Actions Pipeline
  const promotedBulkActions = [
    ...(activeCouriers.pathao
      ? [
          {
            content: "Assign Pathao",
            onAction: () => handleBulkAssignCourier("pathao"),
          },
        ]
      : []),
    ...(activeCouriers.steadfast
      ? [
          {
            content: "Assign Steadfast",
            onAction: () => handleBulkAssignCourier("steadfast"),
          },
        ]
      : []),
    ...(activeCouriers.redx
      ? [
          {
            content: "Assign RedX",
            onAction: () => handleBulkAssignCourier("redx"),
          },
        ]
      : []),
    ...(activeCouriers.carrybee
      ? [
          {
            content: "Assign CarryBee",
            onAction: () => handleBulkAssignCourier("carrybee"),
          },
        ]
      : []),
    ...(activeCouriers.bahok
      ? [
          {
            content: "Assign Bahok",
            onAction: () => handleBulkAssignCourier("bahok"),
          },
        ]
      : []),
    {
      content: "Print Labels",
      onAction: handlePrintLabels,
    },
    {
      content: "Print Invoices",
      onAction: handlePrintInvoices,
    },
  ];

  const bulkActions = promotedBulkActions;

  const rowMarkup = displayedOrders.map((order, index) => {
    const isRowPrepaid =
      order.financialStatus?.toLowerCase() === "paid" ||
      order.financialStatus?.toLowerCase() === "authorized" ||
      order.displayFinancialStatus?.toUpperCase() === "PAID" ||
      order.codAmount === 0;

    const rowCustomCodVal = customCodAmountsByOrder[order.id];
    const rowMaxPrice = Math.round(
      Number(String(order.totalPrice || "0").replace(/[^0-9.]/g, "")) || 0
    );
    const rowEnteredCodNum =
      rowCustomCodVal !== undefined && rowCustomCodVal.trim() !== ""
        ? Math.round(Number(String(rowCustomCodVal).replace(/[^0-9.]/g, "")) || 0)
        : null;

    const isRowCodOverflow =
      !isRowPrepaid &&
      rowEnteredCodNum !== null &&
      rowMaxPrice > 0 &&
      rowEnteredCodNum > rowMaxPrice;

    const rowEffectiveCod = isRowPrepaid
      ? "0"
      : rowEnteredCodNum !== null
      ? String(rowEnteredCodNum)
      : String(order.codAmount);

    const rawSelectedCourier =
      selectedCouriersByOrder[order.id] || order.assignedCourier;
    const isSelectedActive = courierSelectOptions.some(
      (opt) => opt.value === rawSelectedCourier && !opt.disabled
    );
    const selectedCourier = isSelectedActive
      ? rawSelectedCourier
      : courierSelectOptions[0]?.value || "";
    const isRowSubmitting =
      navigation.state === "submitting" &&
      pendingActionType === "dispatchOrder" &&
      submittingOrderId === order.id;
    const dispatchedInfo = dispatchedOrders[order.id];
    const isRowSelected = selectedResources.includes(order.id);

    const isRowProcessing =
      (isBulkSubmitting && isRowSelected && !dispatchedInfo) ||
      isRowSubmitting;

    let partnerName = "Courier";
    if (dispatchedInfo) {
      const courierNameLower = (dispatchedInfo.courierName || "").toLowerCase();
      partnerName = courierNameLower.includes("pathao")
        ? "Pathao"
        : courierNameLower.includes("steadfast")
        ? "Steadfast"
        : courierNameLower.includes("redx")
        ? "RedX"
        : courierNameLower.includes("carrybee")
        ? "CarryBee"
        : courierNameLower.includes("bahok")
        ? "Bahok"
        : "Courier";
    }
    const isHistoricalCancelledOrReturned =
      dispatchedInfo &&
      ["cancelled", "returned", "failed", "partial_delivery", "paid_returned", "return_received", "cancelled_by_courier", "delivery_failed"].includes(
        String(dispatchedInfo.courierStatus || "").toLowerCase()
      );

    const sentBadgeText = dispatchedInfo
      ? isHistoricalCancelledOrReturned
        ? `⚠️ ${String(dispatchedInfo.courierStatus || "").toLowerCase().includes("return") ? "Returned" : "Cancelled"}: ${partnerName} [${dispatchedInfo.trackingNumber}]`
        : `✅ Sent: ${partnerName}${dispatchedInfo.trackingNumber ? ` [${dispatchedInfo.trackingNumber}]` : ""}`
      : "";

    const rateBadgeTone = order.fraudStats
      ? getSuccessRateBadgeTone(order.fraudStats.successRate)
      : "success";
    const isLockedBySafetyNet =
      Boolean(
        order.fraudStats &&
        order.fraudStats.totalOrders > 0 &&
        order.fraudStats.successRate < (routingConfig.minSuccessRate || 70)
      ) &&
      (order.isRiskyLocked || Boolean(lockedRiskOrders[order.id])) &&
      !manuallyUnlockedOrders[order.id];
    const currentNote = warehouseNotesByOrder[order.id] ?? order.warehouseNote;

    return (
      <IndexTable.Row
        id={order.id}
        key={order.id}
        selected={isRowSelected}
        position={index}
        disabled={isRowProcessing || isLockedBySafetyNet}
      >
        {/* Column 1: Order Info & Destination */}
        <IndexTable.Cell>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center"
            style={{ display: "flex", alignItems: "center" }}
          >
            <BlockStack gap="100">
              <Link
                url={`https://${shopDomain}/admin/orders/${order.id.replace(/\D/g, "")}`}
                target="_blank"
                monochrome
                removeUnderline
              >
                <Text variant="bodyMd" fontWeight="bold" as="span">
                  {order.name}
                </Text>
              </Link>

              <InlineStack gap="100" blockAlign="center">
                <Link
                  url={`https://${shopDomain}/admin/orders/${order.id.replace(/\D/g, "")}`}
                  target="_blank"
                  monochrome
                  removeUnderline
                >
                  <span style={{ fontSize: "11px", color: "#2563EB", fontWeight: 500 }}>
                    Admin ↗
                  </span>
                </Link>
                <span style={{ color: "#D1D5DB" }}>•</span>
                <Text variant="bodyXs" tone="subdued" as="span">
                  {(() => {
                    try {
                      return new Date(order.createdAt).toLocaleDateString("en-US", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                    } catch {
                      return order.createdAt;
                    }
                  })()}
                </Text>
              </InlineStack>

              <div>
                <Badge tone={order.isInsideDhaka ? "info" : "attention"} size="small">
                  {order.isInsideDhaka ? "📍 Inside Dhaka" : "🚚 Outside Dhaka"}
                </Badge>
              </div>
            </BlockStack>
          </div>
        </IndexTable.Cell>

        {/* Column 2: Products & Line Items with Stacked Images */}
        <IndexTable.Cell>
          <div
            className="flex items-center"
            style={{ display: "flex", alignItems: "center" }}
          >
            <Box minWidth="190px" maxWidth="250px">
              <BlockStack gap="150">
                {order.lineItems.length > 0 ? (
                  <>
                    {/* Stacked Thumbnails Container */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        position: "relative",
                        minHeight: "40px",
                      }}
                    >
                      {order.lineItems.slice(0, 3).map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            width: "38px",
                            height: "38px",
                            borderRadius: "8px",
                            border: "2px solid #FFFFFF",
                            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
                            backgroundColor: "#F3F4F6",
                            overflow: "hidden",
                            marginLeft: idx === 0 ? "0" : "-12px",
                            zIndex: 10 - idx,
                            position: "relative",
                            flexShrink: 0,
                            transition: "transform 0.15s ease",
                          }}
                          title={`${item.title} (x${item.quantity})`}
                        >
                          <img
                            src={item.imageUrl || DEFAULT_PRODUCT_PLACEHOLDER}
                            alt={item.title}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                DEFAULT_PRODUCT_PLACEHOLDER;
                            }}
                          />
                        </div>
                      ))}
                      {order.lineItems.length > 3 && (
                        <div
                          className="rounded-md"
                          style={{
                            height: "22px",
                            padding: "0 8px",
                            borderRadius: "6px",
                            backgroundColor: "#F3F4F6",
                            border: "1px solid #D1D5DB",
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#374151",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            marginLeft: "6px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          +{order.lineItems.length - 3} items
                        </div>
                      )}
                    </div>

                    {/* Product Metadata Details */}
                    <BlockStack gap="050">
                      <InlineStack gap="100" blockAlign="center" wrap={false}>
                        <Text variant="bodySm" fontWeight="semibold" truncate>
                          {order.lineItems[0].title}
                        </Text>
                        <Badge tone="info" size="small">
                          {`x${order.lineItems[0].quantity}`}
                        </Badge>
                      </InlineStack>

                      {order.lineItems[0].variantTitle && (
                        <div>
                          <Badge tone="subdued" size="small">
                            {order.lineItems[0].variantTitle}
                          </Badge>
                        </div>
                      )}

                      <InlineStack gap="100" blockAlign="center" wrap>
                        {order.lineItems[0].sku && (
                          <Text variant="bodyXs" tone="subdued" as="span">
                            SKU: {order.lineItems[0].sku}
                          </Text>
                        )}
                        {order.lineItems.length > 1 && (
                          <Text variant="bodyXs" tone="subdued" as="span">
                            {order.lineItems[0].sku ? "• " : ""}
                            +{order.lineItems.length - 1} more item
                            {order.lineItems.length - 1 > 1 ? "s" : ""}
                          </Text>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </>
                ) : (
                  <Text variant="bodySm" tone="subdued">
                    No line items
                  </Text>
                )}
              </BlockStack>
            </Box>
          </div>
        </IndexTable.Cell>

        {/* Column 3: Customer Information */}
        <IndexTable.Cell>
          <div
            className="flex items-center"
            style={{ display: "flex", alignItems: "center" }}
          >
            <Box minWidth="160px" maxWidth="240px">
              <BlockStack gap="050">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <div style={{ minWidth: 0, flex: "0 1 auto", overflow: "hidden" }}>
                    <Text variant="bodySm" fontWeight="semibold" as="span" truncate>
                      {order.customerName || "Customer"}
                    </Text>
                  </div>
                  {order.customerPhone && (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        url={`tel:${order.customerPhone.replace(/\D/g, "")}`}
                        removeUnderline
                      >
                        <span
                          title={`Call ${order.customerPhone}`}
                          className="customer-action-icon-btn customer-action-call-btn"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            backgroundColor: "#EFF6FF",
                            color: "#2563EB",
                            border: "1px solid #BFDBFE",
                            cursor: "pointer",
                            transition: "all 0.15s ease-in-out",
                          }}
                        >
                          <PhoneCallIcon />
                        </span>
                      </Link>
                      <Link
                        url={`https://wa.me/${order.customerPhone.replace(/\D/g, "").replace(/^0/, "880")}`}
                        target="_blank"
                        removeUnderline
                      >
                        <span
                          title={`WhatsApp ${order.customerPhone}`}
                          className="customer-action-icon-btn customer-action-wa-btn"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            backgroundColor: "#F0FDF4",
                            color: "#16A34A",
                            border: "1px solid #BBF7D0",
                            cursor: "pointer",
                            transition: "all 0.15s ease-in-out",
                          }}
                        >
                          <WhatsAppIcon />
                        </span>
                      </Link>
                    </div>
                  )}
                </div>
                {order.customerPhone ? (
                  <div
                    style={{ display: "inline-block", width: "fit-content" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Tooltip content="Copy phone number">
                      <span
                        onClick={(e) => handleCopyPhone(order.customerPhone, e)}
                        style={{
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                        }}
                      >
                        <Text variant="bodySm" tone="subdued" as="span">
                          {order.customerPhone}
                        </Text>
                      </span>
                    </Tooltip>
                  </div>
                ) : (
                  <Text variant="bodyXs" tone="subdued">
                    No phone
                  </Text>
                )}
              </BlockStack>
            </Box>
          </div>
        </IndexTable.Cell>

        {/* Column 4: Payment Status & Collectable COD */}
        <IndexTable.Cell>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center"
            style={{ display: "flex", alignItems: "center" }}
          >
            <Box minWidth="140px" maxWidth="210px">
              <BlockStack gap="100">
                <Text variant="bodySm" fontWeight="bold" as="span">
                  {`${order.currencyCode} ${order.totalPrice}`}
                </Text>
                <InlineStack gap="100" wrap>
                  <Badge
                    tone={isRowPrepaid ? "success" : "attention"}
                    size="small"
                  >
                    {order.displayFinancialStatus || (isRowPrepaid ? "PAID" : "UNPAID")}
                  </Badge>
                  {isRowPrepaid ? (
                    <Badge tone="success" size="small">
                      PREPAID (৳0 COD)
                    </Badge>
                  ) : !showCodEdit[order.id] ? (
                    <InlineStack gap="050" blockAlign="center">
                      <Badge tone="attention" size="small">
                        {`COD: ৳${rowEffectiveCod}`}
                      </Badge>
                      {!dispatchedInfo && (
                        <Button
                          variant="plain"
                          size="slim"
                          onClick={() =>
                            setShowCodEdit((prev) => ({ ...prev, [order.id]: true }))
                          }
                        >
                          ✏️ Edit
                        </Button>
                      )}
                    </InlineStack>
                  ) : null}
                </InlineStack>

                {/* Custom COD Input Field & Real-time Validation Guardrail */}
                {!isRowPrepaid && !dispatchedInfo && showCodEdit[order.id] && (
                  <BlockStack gap="050">
                    <InlineStack gap="100" blockAlign="center">
                      <div style={{ maxWidth: "110px" }}>
                        <TextField
                          label="Custom COD Amount"
                          labelHidden
                          type="number"
                          size="slim"
                          autoComplete="off"
                          prefix="৳"
                          value={customCodAmountsByOrder[order.id] ?? String(order.codAmount)}
                          onChange={(val) => {
                            setCustomCodAmountsByOrder((prev) => ({
                              ...prev,
                              [order.id]: val,
                            }));
                          }}
                        />
                      </div>
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() =>
                          setShowCodEdit((prev) => ({ ...prev, [order.id]: false }))
                        }
                      >
                        ✕ Done
                      </Button>
                    </InlineStack>
                    {isRowCodOverflow && (
                      <Text as="p" variant="bodyXs" tone="critical">
                        ⚠️ COD amount cannot exceed the total order value.
                      </Text>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Box>
          </div>
        </IndexTable.Cell>

        {/* Column 5: Delivery History & Fraud Risk Metrics */}
        <IndexTable.Cell>
          <div
            className="flex items-center"
            style={{ display: "flex", alignItems: "center" }}
          >
            <Box minWidth="130px" maxWidth="170px">
            <BlockStack gap="100" inlineAlign="start">
              {order.fraudStats && order.fraudStats.totalOrders > 0 ? (
                <BlockStack gap="050" inlineAlign="start">
                  {/* SVG Circular Progress Ring */}
                  <div
                    style={{
                      position: "relative",
                      width: "42px",
                      height: "42px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg
                      width="42"
                      height="42"
                      viewBox="0 0 42 42"
                      style={{ display: "block" }}
                    >
                      {/* Background Track Circle */}
                      <circle
                        cx="21"
                        cy="21"
                        r="16"
                        fill="none"
                        stroke="#E5E7EB"
                        strokeWidth="3.5"
                      />
                      {/* Progress Stroke Circle */}
                      <circle
                        cx="21"
                        cy="21"
                        r="16"
                        fill="none"
                        stroke={
                          order.fraudStats.successRate >= 80
                            ? "#16A344"
                            : order.fraudStats.successRate >= 60
                            ? "#D97706"
                            : "#DC2626"
                        }
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeDasharray="100.53"
                        strokeDashoffset={
                          100.53 -
                          (100.53 * order.fraudStats.successRate) / 100
                        }
                        transform="rotate(-90 21 21)"
                      />
                    </svg>
                    {/* Centered Percentage */}
                    <span
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        fontSize: "10px",
                        fontWeight: 700,
                        color:
                          order.fraudStats.successRate >= 80
                            ? "#16A344"
                            : order.fraudStats.successRate >= 60
                            ? "#D97706"
                            : "#DC2626",
                        letterSpacing: "-0.5px",
                        lineHeight: 1,
                        pointerEvents: "none",
                      }}
                    >
                      {`${order.fraudStats.successRate}%`}
                    </span>
                  </div>

                  {/* Micro-Counters Stacked Underneath */}
                  <InlineStack gap="100" blockAlign="center">
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#16A344",
                        fontWeight: 600,
                      }}
                    >
                      ✓ {order.fraudStats.totalDelivered}
                    </span>
                    <span style={{ fontSize: "10px", color: "#9CA3AF" }}>/</span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#DC2626",
                        fontWeight: 600,
                      }}
                    >
                      ✕ {order.fraudStats.totalReturned}
                    </span>
                  </InlineStack>
                </BlockStack>
              ) : (
                <Badge tone="subdued" size="small">
                  New Customer
                </Badge>
              )}

              {isLockedBySafetyNet && (
                <BlockStack gap="050">
                  <Badge tone="warning" size="small">
                    ⚠️ Risky: Locked
                  </Badge>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="micro"
                      variant="secondary"
                      onClick={() =>
                        setManuallyUnlockedOrders((prev) => ({
                          ...prev,
                          [order.id]: true,
                        }))
                      }
                    >
                      Approve &amp; Unlock
                    </Button>
                  </div>
                </BlockStack>
              )}
            </BlockStack>
          </Box>
        </div>
      </IndexTable.Cell>

        {/* Column 6: Courier Selection & Tracking Consignment */}
        <IndexTable.Cell>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center"
            style={{ display: "flex", alignItems: "center" }}
          >
            <Box minWidth="120px" maxWidth="150px">
              <div
                className="compact-courier-select-box"
                style={{
                  maxWidth: "150px",
                  width: "100%",
                }}
              >
                <BlockStack gap="100">
                  {!hasActiveCouriers ? (
                    <Tooltip content="কুরিয়ার অ্যাকাউন্ট কনফিগার করুন" preferredPosition="above">
                      <div
                        style={{
                          maxWidth: "150px",
                          width: "100%",
                          display: "inline-block",
                          cursor: "not-allowed",
                        }}
                      >
                        <div
                          style={{
                            pointerEvents: "none",
                            maxWidth: "150px",
                            width: "100%",
                          }}
                        >
                          <Select
                            label={`Select courier for ${order.name}`}
                            labelHidden
                            options={courierSelectOptions}
                            value={selectedCourier}
                            disabled={true}
                          />
                        </div>
                      </div>
                    </Tooltip>
                  ) : (
                    <div
                      style={{
                        maxWidth: "150px",
                        width: "100%",
                      }}
                    >
                      <Select
                        label={`Select courier for ${order.name}`}
                        labelHidden
                        options={courierSelectOptions}
                        value={selectedCourier}
                        onChange={(val) =>
                          setSelectedCouriersByOrder((prev) => ({
                            ...prev,
                            [order.id]: val,
                          }))
                        }
                        disabled={
                          Boolean(dispatchedInfo) ||
                          isRowProcessing ||
                          isLockedBySafetyNet
                        }
                      />
                    </div>
                  )}

                {dispatchedInfo ? (
                  <BlockStack gap="050">
                    <Badge tone="success" size="small">
                      {sentBadgeText}
                    </Badge>
                    {dispatchedInfo.trackingUrl && (
                      <Link url={dispatchedInfo.trackingUrl} target="_blank" removeUnderline>
                        <span style={{ fontSize: "11px", color: "#2563EB", fontWeight: 500 }}>
                          Track Parcel ↗
                        </span>
                      </Link>
                    )}
                    {order.reconciliation?.courierStatus && (
                      <Text variant="bodyXs" tone="subdued">
                        {`Status: ${order.reconciliation.courierStatus.toUpperCase()}`}
                      </Text>
                    )}
                  </BlockStack>
                ) : (
                  !isLockedBySafetyNet && (
                    <>
                      {selectedCourier === "pathao" && (
                        <Box>
                          {!showLocationOverride[order.id] ? (
                            <Button
                              variant="plain"
                              size="slim"
                              onClick={() =>
                                setShowLocationOverride((prev) => ({
                                  ...prev,
                                  [order.id]: true,
                                }))
                              }
                            >
                              📍 Edit City/Zone
                            </Button>
                          ) : (
                            <BlockStack gap="050">
                              <InlineStack gap="100">
                                <TextField
                                  label="City ID"
                                  labelHidden
                                  placeholder="City ID"
                                  size="slim"
                                  value={manualCityIds[order.id] || ""}
                                  onChange={(val) =>
                                    setManualCityIds((prev) => ({
                                      ...prev,
                                      [order.id]: val,
                                    }))
                                  }
                                  autoComplete="off"
                                />
                                <TextField
                                  label="Zone ID"
                                  labelHidden
                                  placeholder="Zone ID"
                                  size="slim"
                                  value={manualZoneIds[order.id] || ""}
                                  onChange={(val) =>
                                    setManualZoneIds((prev) => ({
                                      ...prev,
                                      [order.id]: val,
                                    }))
                                  }
                                  autoComplete="off"
                                />
                              </InlineStack>
                              <Button
                                variant="plain"
                                size="slim"
                                onClick={() =>
                                  setShowLocationOverride((prev) => ({
                                    ...prev,
                                    [order.id]: false,
                                  }))
                                }
                              >
                                ✕ Close
                              </Button>
                            </BlockStack>
                          )}
                        </Box>
                      )}

                      {selectedCourier === "redx" && (
                        <Box>
                          {!showLocationOverride[order.id] ? (
                            <Button
                              variant="plain"
                              size="slim"
                              onClick={() =>
                                setShowLocationOverride((prev) => ({
                                  ...prev,
                                  [order.id]: true,
                                }))
                              }
                            >
                              📍 Edit Area
                            </Button>
                          ) : (
                            <BlockStack gap="050">
                              <InlineStack gap="100">
                                <TextField
                                  label="Area ID"
                                  labelHidden
                                  placeholder="Area ID"
                                  size="slim"
                                  value={manualAreaIds[order.id] || ""}
                                  onChange={(val) =>
                                    setManualAreaIds((prev) => ({
                                      ...prev,
                                      [order.id]: val,
                                    }))
                                  }
                                  autoComplete="off"
                                />
                                <TextField
                                  label="Area Name"
                                  labelHidden
                                  placeholder="Area Name"
                                  size="slim"
                                  value={manualAreaNames[order.id] || ""}
                                  onChange={(val) =>
                                    setManualAreaNames((prev) => ({
                                      ...prev,
                                      [order.id]: val,
                                    }))
                                  }
                                  autoComplete="off"
                                />
                              </InlineStack>
                              <Button
                                variant="plain"
                                size="slim"
                                onClick={() =>
                                  setShowLocationOverride((prev) => ({
                                    ...prev,
                                    [order.id]: false,
                                  }))
                                }
                              >
                                ✕ Close
                              </Button>
                            </BlockStack>
                          )}
                        </Box>
                      )}
                    </>
                  )
                )}
              </BlockStack>
            </div>
          </Box>
        </div>
      </IndexTable.Cell>

        {/* Column 7: Warehouse Packaging Note */}
        <IndexTable.Cell>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            <Box minWidth="140px" maxWidth="180px">
              <TextField
                label="Warehouse Packaging Note"
                labelHidden
                value={currentNote}
                disabled={isRowProcessing || Boolean(dispatchedInfo)}
                onChange={(val) =>
                  setWarehouseNotesByOrder((prev) => ({
                    ...prev,
                    [order.id]: val,
                  }))
                }
                placeholder="Packaging note..."
                autoComplete="off"
              />
            </Box>
          </div>
        </IndexTable.Cell>

        {/* Column 8: Action Execution */}
        <IndexTable.Cell>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            {isRowProcessing ? (
              <Badge tone="info" status="info">
                <InlineStack gap="100" blockAlign="center">
                  <Spinner size="small" />
                  <span>⚡ Sending...</span>
                </InlineStack>
              </Badge>
            ) : dispatchedInfo && !isHistoricalCancelledOrReturned ? (
              <Badge tone="success" status="success">
                ✓ Dispatched
              </Badge>
            ) : isLockedBySafetyNet ? (
              <Button
                size="slim"
                variant="secondary"
                onClick={() =>
                  setManuallyUnlockedOrders((prev) => ({
                    ...prev,
                    [order.id]: true,
                  }))
                }
              >
                Unlock Review
              </Button>
            ) : (
              <Button
                variant={isHistoricalCancelledOrReturned ? "secondary" : "primary"}
                size="slim"
                loading={isRowSubmitting}
                disabled={isRowCodOverflow}
                onClick={() => handleSendSingleOrder(order)}
              >
                {isHistoricalCancelledOrReturned ? "🔄 Re-dispatch" : "Confirm & Dispatch"}
              </Button>
            )}
          </div>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: auto;
            margin: 0mm;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            overflow: visible !important;
            background: #ffffff !important;
          }
          body * {
            visibility: hidden;
          }
          #printable-packing-slips-zone,
          #printable-packing-slips-zone * {
            visibility: visible;
          }
          #printable-packing-slips-zone {
            position: static !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            display: block !important;
          }
          #printable-packing-slips-zone .Polaris-BlockStack,
          #printable-packing-slips-zone [class*="BlockStack"] {
            gap: 0 !important;
          }
          .Polaris-Page,
          .Polaris-Page__Content,
          .Polaris-Layout,
          .Polaris-Layout__Section,
          .Polaris-Card,
          .Polaris-Box {
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: transparent !important;
          }
          .no-print {
            display: none !important;
          }
          .cancelled-order-watermark-sheet {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
        .orders-tabs-nowrap-container [role="tablist"],
        .orders-tabs-nowrap-container ul {
          flex-wrap: nowrap !important;
          white-space: nowrap !important;
        }
        /* Force-unlock Polaris Popover width constraints for DatePicker */
        .date-picker-popover-viewport {
          min-width: 750px !important;
          max-width: 800px !important;
        }
        .Polaris-Popover__PopoverOverlay:has(.date-picker-popover-viewport),
        .Polaris-Popover__ContentContainer:has(.date-picker-popover-viewport),
        .Polaris-Popover__Content:has(.date-picker-popover-viewport),
        .Polaris-Popover__Pane:has(.date-picker-popover-viewport),
        div[class*="Polaris-Popover"]:has(.date-picker-popover-viewport),
        div[class*="Polaris-PositionedOverlay"]:has(.date-picker-popover-viewport) {
          max-width: none !important;
          max-height: none !important;
          width: auto !important;
          overflow-x: visible !important;
        }
        .date-picker-dual-pane .Polaris-DatePicker {
          width: 100% !important;
          overflow-x: visible !important;
        }
        .date-picker-dual-pane .Polaris-DatePicker__MonthContainer {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: nowrap !important;
          gap: 16px !important;
          width: 100% !important;
          overflow-x: visible !important;
          justify-content: space-between !important;
        }
        .date-picker-dual-pane .Polaris-DatePicker__Month {
          flex: 1 1 240px !important;
          min-width: 230px !important;
          max-width: 260px !important;
          margin: 0 !important;
        }
        .customer-action-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          transition: all 0.15s ease-in-out;
          text-decoration: none;
          flex-shrink: 0;
          cursor: pointer;
        }
        .customer-action-icon-btn:hover {
          transform: scale(1.1);
        }
        .customer-action-call-btn {
          background-color: #eff6ff;
          color: #2563eb;
          border: 1px solid #bfdbfe;
        }
        .customer-action-call-btn:hover {
          background-color: #dbeafe;
          border-color: #93c5fd;
          color: #1d4ed8;
        }
        .customer-action-wa-btn {
          background-color: #f0fdf4;
          color: #16a34a;
          border: 1px solid #bbf7d0;
        }
        .customer-action-wa-btn:hover {
          background-color: #dcfce7;
          border-color: #86efac;
          color: #15803d;
        }
        .compact-courier-select-box {
          max-width: 150px !important;
          width: 100% !important;
        }
        .compact-courier-select-box .Polaris-Select {
          max-width: 150px !important;
          width: 100% !important;
          height: 32px !important;
          min-height: 32px !important;
        }
        .compact-courier-select-box .Polaris-Select select {
          max-width: 150px !important;
          width: 100% !important;
          height: 32px !important;
          min-height: 32px !important;
          padding: 4px 8px !important;
          border-radius: 6px !important;
          font-size: 12px !important;
        }
        .compact-courier-select-box .Polaris-Select__Content {
          height: 32px !important;
          min-height: 32px !important;
          padding: 4px 8px !important;
          border-radius: 6px !important;
          font-size: 12px !important;
          box-sizing: border-box !important;
        }
        .compact-courier-select-box .Polaris-Select__Backdrop {
          border-radius: 6px !important;
        }
        /* Table Cell Vertical Spacing (py-4) and Alignment */
        .Polaris-IndexTable__TableRow .Polaris-IndexTable__TableCell {
          padding-top: 16px !important;
          padding-bottom: 16px !important;
          vertical-align: middle !important;
        }
        /* Badge Unification (rounded-md: 6px border-radius) */
        .Polaris-Badge,
        .Polaris-Badge::before,
        .Polaris-Badge::after {
          border-radius: 6px !important;
        }
        /* Top Layout Alignment Adjustment */
        .Polaris-Page-Header {
          display: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .Polaris-Page--fullWidth {
          padding-top: 12px !important;
        }
        .Polaris-Page__Content {
          padding-top: 0 !important;
        }
        .Polaris-Page__Content > .Polaris-Layout {
          margin-top: 0 !important;
        }
        .Polaris-Page__Content > .Polaris-Layout > .Polaris-Layout__Section:first-child {
          margin-top: 0 !important;
        }
      `}</style>

      <Page fullWidth>
        <TitleBar title="Orders" />

        <Layout>
          {showCancelledOrdersPrintWarning && (
            <Layout.Section>
              <Banner
                title="Cancelled Orders Detected in Selection"
                tone="warning"
                onDismiss={() => setShowCancelledOrdersPrintWarning(false)}
              >
                <p>
                  Warning: Cancelled orders detected in your selection and blocked from normal processing.
                </p>
              </Banner>
            </Layout.Section>
          )}

          {showLabelConfigError && (
            <Layout.Section>
              <Banner
                title="Courier Assignment Required"
                tone="critical"
                onDismiss={() => setShowLabelConfigError(false)}
              >
                <p>অনুগ্রহ করে আগে এই অর্ডারে কুরিয়ার অ্যাসাইন করুন। অর্ডারটি 'Shipping' ট্যাবে চলে যাওয়ার পর সেখান থেকে লেবেল প্রিন্ট করা যাবে।</p>
              </Banner>
            </Layout.Section>
          )}

          {showInvoiceConfigError && (
            <Layout.Section>
              <Banner
                title="Invoice Configuration Required"
                tone="critical"
                onDismiss={() => setShowInvoiceConfigError(false)}
              >
                <p>Invalid or missing invoice settings. Go to settings and configure your invoice template and brand details.</p>
              </Banner>
            </Layout.Section>
          )}

          {showBanner && actionData?.message && (
            <Layout.Section>
              <Banner
                title={
                  actionData.success
                    ? "Courier Fulfillment Completed"
                    : actionData.message.includes("Pathao") &&
                      (actionData.message.includes("credentials") ||
                        actionData.message.includes("Auth Token") ||
                        actionData.message.includes("expired") ||
                        actionData.message.includes("revoked"))
                    ? "Pathao Authentication Alert"
                    : "Fulfillment Validation Alert"
                }
                tone={actionData.success ? "success" : "critical"}
                action={
                  actionData.limitReached
                    ? { content: "Upgrade Plan", url: "/app/pricing" }
                    : actionData.message.includes("Pathao") &&
                      (actionData.message.includes("credentials") ||
                        actionData.message.includes("Auth Token") ||
                        actionData.message.includes("expired") ||
                        actionData.message.includes("revoked"))
                    ? { content: "Verify Courier Settings", url: "/app/courier-settings" }
                    : undefined
                }
                onDismiss={() => setShowBanner(false)}
              >
                <p>{actionData.message}</p>
              </Banner>
            </Layout.Section>
          )}

          {clientBatchError && (
            <Layout.Section>
              <Banner
                title="Bulk Selection Limit Reached"
                tone="critical"
                action={{ content: "Upgrade Plan", url: "/app/pricing" }}
                onDismiss={() => setClientBatchError(null)}
              >
                <p>{clientBatchError}</p>
              </Banner>
            </Layout.Section>
          )}

          {graphqlWarning && (
            <Layout.Section>
              <Banner title="Shopify Order Query Notice" tone="info">
                <p>{graphqlWarning}</p>
              </Banner>
            </Layout.Section>
          )}

          {/* VISUAL ANCHORS: Amber Fraud Alert Notice for High-Risk Orders */}
          {riskyOrdersCount > 0 && (
            <Layout.Section>
              <Banner
                title={`Fraud Risk Notice: ${riskyOrdersCount} Flagged Order${
                  riskyOrdersCount === 1 ? "" : "s"
                } Require Review`}
                tone="warning"
              >
                <p>
                  Customer fraud scoring detected delivery success rates below your {routingConfig.minSuccessRate ?? 70}% safety threshold. These orders are highlighted in amber and locked to protect against courier return fees (RTO). Verify customer details or manually approve before booking.
                </p>
              </Banner>
            </Layout.Section>
          )}

          {/* ==================== TASK 3: TIER-GATED PRINTABLE PACKING SLIPS VIEW ==================== */}
          {showPackingSlipView && bookedSlipsList.length > 0 && (
            <Layout.Section>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          Dynamic Printable Packing Slips ({bookedSlipsList.length} Ready)
                        </Text>
                        <Badge tone={isFreePlan ? "attention" : "success"}>
                          {isFreePlan
                            ? "Free Tier: Locked to Standard Layout"
                            : `${usageSummary.currentPlan} Tier: Premium Layouts Unlocked`}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {isFreePlan
                          ? "You are on the Free plan (Standard B&W layout). Upgrade to Growth/Pro for Custom Branded Slips or Enterprise for the Tailored Dual-Column Warehouse Layout."
                          : "Use the Template Controller dropdown to switch between your unlocked packing slip layouts before printing."}
                      </Text>
                    </BlockStack>

                    <InlineStack gap="200">
                      <Button variant="primary" onClick={() => window.print()}>
                        🖨️ Print Batch Documents
                      </Button>
                      <Button
                        onClick={() => {
                          setShowPackingSlipView(false);
                          setBatchPrintSlips([]);
                        }}
                      >
                        Close Preview
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  <Grid>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                      <Select
                        label="Document Print Mode"
                        options={[
                          {
                            label: "📄 A4 Customer Invoices & Slips",
                            value: "invoices_a4",
                          },
                          {
                            label: "🏷️ 4x6 Thermal Shipping Labels",
                            value: "labels_4x6",
                          },
                        ]}
                        value={printDocumentMode}
                        onChange={(val) =>
                          setPrintDocumentMode(val as "labels_4x6" | "invoices_a4")
                        }
                      />
                    </Grid.Cell>
                    {printDocumentMode === "invoices_a4" && (
                      <Grid.Cell
                        columnSpan={{
                          xs: 6,
                          sm: 6,
                          md: selectedSlipTemplate === "modern" ? 4 : 8,
                          lg: selectedSlipTemplate === "modern" ? 4 : 8,
                          xl: selectedSlipTemplate === "modern" ? 4 : 8,
                        }}
                      >
                        <Select
                          label="Packing Slip Template Controller"
                          options={templateSelectorOptions}
                          value={selectedSlipTemplate}
                          disabled={isFreePlan}
                          onChange={(val) => setSelectedSlipTemplate(val)}
                          helpText={
                            isFreePlan
                              ? "Locked to Classic Minimalist on Free Plan."
                              : "Instantly switch printable slip layouts."
                          }
                        />
                      </Grid.Cell>
                    )}
                    {printDocumentMode === "invoices_a4" &&
                      selectedSlipTemplate === "modern" && (
                        <Grid.Cell
                          columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}
                        >
                          <TextField
                            label="Custom Brand Slogan (Growth & Pro Slot)"
                            value={customShopSlogan}
                            onChange={(val) => setCustomShopSlogan(val)}
                            autoComplete="off"
                            helpText="Printed inside the Branded Header Grid."
                          />
                        </Grid.Cell>
                      )}
                  </Grid>

                  <Divider />

                  <div id="printable-packing-slips-zone">
                    <BlockStack gap="400">
                      {bookedSlipsList.map((slip, index) => {
                        const isLastSlip = index === bookedSlipsList.length - 1;
                        const matchingOrder =
                          displayedOrders.find((o) => o.id === slip.orderId) ||
                          orders.find((o) => o.id === slip.orderId);

                        const isCancelledOrder = Boolean(
                          slip.isCancelled ||
                          slip.cancelledAt ||
                          slip.cancelReason ||
                          matchingOrder?.cancelReason ||
                          matchingOrder?.cancelledAt ||
                          matchingOrder?.isCancelled ||
                          matchingOrder?.fulfillmentStatus === "CANCELLED" ||
                          (matchingOrder as any)?.displayFulfillmentStatus === "CANCELLED" ||
                          matchingOrder?.status?.toLowerCase() === "cancelled"
                        );

                        // Master Audit Point 7: Live Cancel Intercept - render high-visibility security watermark placeholder
                        if (isCancelledOrder) {
                          const cancelReasonText =
                            slip.cancelReason ||
                            (matchingOrder as any)?.cancelReason ||
                            "Customer / Merchant Cancelled";
                          const cancelDateText =
                            slip.cancelledAt ||
                            matchingOrder?.cancelledAt ||
                            new Date().toISOString();

                          if (printDocumentMode === "labels_4x6") {
                            const dimensions = getPrintLabelDimensions(
                              shippingLabelConfig?.labelSize || "4in x 6in"
                            );
                            const isCompact = [
                              "4in x 2in",
                              "3in x 2in",
                              "2in x 1.5in",
                              "1.5in x 1in",
                              "2in x 1in",
                              "2in x 1.15in",
                              "2.2in x 1.4in",
                            ].includes(shippingLabelConfig?.labelSize || "4in x 6in");

                            return (
                              <div
                                key={`${slip.orderId}-${index}-cancelled-label`}
                                className="cancelled-order-watermark-sheet"
                                style={{
                                  width: dimensions.width,
                                  maxHeight: dimensions.maxHeight,
                                  minHeight: isCompact ? "auto" : "135mm",
                                  height: "auto",
                                  boxSizing: "border-box",
                                  border: "3px dashed #dc2626",
                                  borderRadius: "6px",
                                  padding: dimensions.padding || "12px",
                                  margin: "0 auto",
                                  backgroundColor: "#fff5f5",
                                  color: "#991b1b",
                                  fontFamily: "system-ui, -apple-system, sans-serif",
                                  pageBreakAfter: isLastSlip ? "auto" : "always",
                                  breakAfter: isLastSlip ? "auto" : "page",
                                  pageBreakInside: "avoid",
                                  breakInside: "avoid",
                                  display: "flex",
                                  flexDirection: "column",
                                  justifyContent: "space-between",
                                  textAlign: "center",
                                  overflow: "hidden",
                                }}
                              >
                                <div style={{ padding: "8px 4px" }}>
                                  <div
                                    style={{
                                      display: "inline-block",
                                      backgroundColor: "#dc2626",
                                      color: "#ffffff",
                                      fontWeight: 900,
                                      fontSize: isCompact ? "10px" : "12px",
                                      letterSpacing: "0.5px",
                                      padding: "3px 8px",
                                      borderRadius: "4px",
                                      marginBottom: "6px",
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    SECURITY INTERCEPT: CANCELLED
                                  </div>
                                  <div
                                    style={{
                                      fontSize: isCompact ? "13px" : "18px",
                                      fontWeight: 900,
                                      lineHeight: 1.2,
                                      color: "#991b1b",
                                      margin: "4px 0",
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    ⛔ ORDER CANCELLED ON SHOPIFY - DO NOT PACK / SHIP
                                  </div>
                                </div>

                                <div
                                  style={{
                                    borderTop: "2px solid #f87171",
                                    borderBottom: "2px solid #f87171",
                                    padding: isCompact ? "6px 4px" : "10px 8px",
                                    backgroundColor: "#ffffff",
                                    borderRadius: "4px",
                                    textAlign: "left",
                                    fontSize: isCompact ? "9px" : "11.5px",
                                    lineHeight: 1.4,
                                    color: "#1f2937",
                                  }}
                                >
                                  <div style={{ fontWeight: 800, fontSize: isCompact ? "11px" : "13px", marginBottom: "4px", color: "#111827" }}>
                                    Order: {slip.orderName}
                                  </div>
                                  <div>
                                    <strong>Customer:</strong> {slip.customerName || matchingOrder?.customerName || "N/A"}
                                  </div>
                                  <div>
                                    <strong>Phone:</strong> {slip.customerPhone || matchingOrder?.customerPhone || "N/A"}
                                  </div>
                                  <div>
                                    <strong>Cancelled At:</strong> {cancelDateText ? new Date(cancelDateText).toLocaleString("en-GB") : "Recently"}
                                  </div>
                                  <div>
                                    <strong>Reason:</strong> {cancelReasonText}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    fontSize: isCompact ? "8px" : "9.5px",
                                    fontWeight: 700,
                                    color: "#b91c1c",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.5px",
                                    padding: "4px 0",
                                  }}
                                >
                                  DISPATCH BLOCKED • DO NOT HAND OVER TO COURIER
                                </div>
                              </div>
                            );
                          }

                          // Invoices (A4) Cancelled Sheet
                          return (
                            <div
                              key={`${slip.orderId}-${index}-cancelled-invoice`}
                              className="cancelled-order-watermark-sheet"
                              style={{
                                width: "100%",
                                maxWidth: "210mm",
                                minHeight: "270mm",
                                boxSizing: "border-box",
                                border: "3px dashed #dc2626",
                                borderRadius: "6px",
                                padding: "24mm 18mm",
                                margin: "0 auto",
                                backgroundColor: "#fffafa",
                                color: "#991b1b",
                                fontFamily: "system-ui, -apple-system, sans-serif",
                                pageBreakAfter: isLastSlip ? "auto" : "always",
                                breakAfter: isLastSlip ? "auto" : "page",
                                pageBreakInside: "avoid",
                                breakInside: "avoid",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                textAlign: "center",
                                position: "relative",
                              }}
                            >
                              <div style={{ textAlign: "center", marginTop: "18mm" }}>
                                <div
                                  style={{
                                    display: "inline-block",
                                    backgroundColor: "#dc2626",
                                    color: "#ffffff",
                                    fontWeight: 900,
                                    fontSize: "13px",
                                    letterSpacing: "1px",
                                    padding: "6px 16px",
                                    borderRadius: "4px",
                                    marginBottom: "16px",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  SECURITY VOID — INVOICE GENERATION BLOCKED
                                </div>
                                <h1
                                  style={{
                                    fontSize: "24px",
                                    fontWeight: 900,
                                    color: "#b91c1c",
                                    marginBottom: "12px",
                                    lineHeight: 1.3,
                                    textTransform: "uppercase",
                                  }}
                                >
                                  ⛔ ORDER CANCELLED ON SHOPIFY - DO NOT PACK / SHIP
                                </h1>
                                <p style={{ fontSize: "14px", color: "#4b5563", maxWidth: "520px", margin: "0 auto" }}>
                                  This order was marked as cancelled on Shopify. To prevent lost packaging materials, uncollectable courier fees, or inventory discrepancies, all document generation for this order is revoked.
                                </p>
                              </div>

                              <div
                                style={{
                                  border: "1px solid #fca5a5",
                                  backgroundColor: "#ffffff",
                                  borderRadius: "8px",
                                  padding: "20px 24px",
                                  margin: "16mm auto",
                                  maxWidth: "550px",
                                  width: "100%",
                                  textAlign: "left",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                                }}
                              >
                                <h3 style={{ fontSize: "15px", fontWeight: 800, color: "#111827", marginBottom: "12px", borderBottom: "1px solid #e5e7eb", paddingBottom: "8px" }}>
                                  Cancelled Order Manifest Details
                                </h3>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "13px", color: "#374151" }}>
                                  <div>
                                    <strong>Order Number:</strong> {slip.orderName}
                                  </div>
                                  <div>
                                    <strong>Tracking Number:</strong> {slip.trackingNumber || "None (Blocked)"}
                                  </div>
                                  <div>
                                    <strong>Customer Name:</strong> {slip.customerName || matchingOrder?.customerName || "N/A"}
                                  </div>
                                  <div>
                                    <strong>Customer Phone:</strong> {slip.customerPhone || matchingOrder?.customerPhone || "N/A"}
                                  </div>
                                  <div>
                                    <strong>Cancelled Date:</strong> {cancelDateText ? new Date(cancelDateText).toLocaleString("en-GB") : "Recently"}
                                  </div>
                                  <div>
                                    <strong>Cancellation Reason:</strong> {cancelReasonText}
                                  </div>
                                </div>
                              </div>

                              <div
                                style={{
                                  borderTop: "2px solid #ef4444",
                                  paddingTop: "12px",
                                  fontSize: "12px",
                                  color: "#6b7280",
                                  textAlign: "center",
                                }}
                              >
                                <p style={{ margin: 0, fontWeight: 700, color: "#dc2626" }}>
                                  AUDIT SAFEGUARD ACTIVE — DO NOT PROCESS GOODS FOR THIS ORDER REFERENCE
                                </p>
                              </div>
                            </div>
                          );
                        }

                        const effectiveNote = resolveEffectiveNote(slip, shippingLabelConfig);

                        if (printDocumentMode === "labels_4x6") {
                          const dimensions = getPrintLabelDimensions(
                            shippingLabelConfig?.labelSize || "4in x 6in"
                          );
                          const isCompact = [
                            "4in x 2in",
                            "3in x 2in",
                            "2in x 1.5in",
                            "1.5in x 1in",
                            "2in x 1in",
                            "2in x 1.15in",
                            "2.2in x 1.4in",
                          ].includes(shippingLabelConfig?.labelSize || "4in x 6in");
                          const activeLabelStyle =
                            shippingLabelConfig?.labelStyle || "standard";
                          const totalItemsCount = slip.lineItems.reduce(
                            (acc, it) => acc + (it.quantity || 1),
                            0
                          );

                          return (
                            <div
                              key={`${slip.orderId}-${index}-label`}
                              style={{
                                width: dimensions.width,
                                maxHeight: dimensions.maxHeight,
                                minHeight: isCompact ? "auto" : "135mm",
                                height: "auto",
                                boxSizing: "border-box",
                                border: "2px solid #000000",
                                borderRadius: "4px",
                                padding: dimensions.padding,
                                margin: "0 auto",
                                background: "#ffffff",
                                color: "#000000",
                                fontFamily: "system-ui, -apple-system, sans-serif",
                                pageBreakAfter: isLastSlip ? "auto" : "always",
                                breakAfter: isLastSlip ? "auto" : "page",
                                pageBreakInside: "avoid",
                                breakInside: "avoid",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                overflow: "hidden",
                              }}
                            >
                              {/* Header */}
                              <div
                                style={{
                                  borderBottom: "1.5px solid #000000",
                                  paddingBottom: isCompact ? "3px" : "6px",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    {brandLogo ? (
                                      <img
                                        src={brandLogo}
                                        alt={brandName || "Logo"}
                                        style={{
                                          maxHeight: isCompact ? "18px" : "28px",
                                          maxWidth: "100px",
                                          objectFit: "contain",
                                        }}
                                      />
                                    ) : brandName ? (
                                      <span
                                        style={{
                                          fontSize: isCompact ? "11px" : "13px",
                                          fontWeight: "900",
                                          textTransform: "uppercase",
                                        }}
                                      >
                                        {brandName}
                                      </span>
                                    ) : (
                                      <span
                                        style={{
                                          fontSize: isCompact ? "11px" : "14px",
                                          fontWeight: "900",
                                          letterSpacing: "0.5px",
                                        }}
                                      >
                                        {slip.courierName.toUpperCase()}
                                      </span>
                                    )}
                                    {brandLogo && brandName && (
                                      <span
                                        style={{
                                          fontSize: isCompact ? "10px" : "12px",
                                          fontWeight: "800",
                                          textTransform: "uppercase",
                                        }}
                                      >
                                        {brandName}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <span
                                      style={{
                                        fontSize: isCompact ? "11px" : "13px",
                                        fontWeight: "900",
                                      }}
                                    >
                                      {slip.orderName}
                                    </span>
                                    {brandLogo && (
                                      <div
                                        style={{
                                          fontSize: "9px",
                                          fontWeight: "700",
                                          color: "#374151",
                                        }}
                                      >
                                        {slip.courierName.toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    fontSize: isCompact ? "9px" : "10px",
                                    color: "#4b5563",
                                    marginTop: "2px",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                  }}
                                >
                                  <span>Date: {slip.bookingDate}</span>
                                  <span>
                                    {Number(slip.codAmount) === 0
                                      ? "PREPAID"
                                      : "Mode: COD"}
                                  </span>
                                </div>

                                {activeLabelStyle === "brand_centric" &&
                                  shippingLabelConfig?.socialHandle && (
                                    <div
                                      style={{
                                        fontSize: "9px",
                                        fontWeight: 700,
                                        color: "#1d4ed8",
                                        textAlign: "center",
                                        marginTop: "2px",
                                      }}
                                    >
                                      📱{" "}
                                      {shippingLabelConfig.socialHandle.startsWith(
                                        "@"
                                      )
                                        ? shippingLabelConfig.socialHandle
                                        : `@${shippingLabelConfig.socialHandle}`}
                                    </div>
                                  )}
                              </div>

                              {/* Barcode & Tracking */}
                              <div
                                style={{
                                  textAlign: "center",
                                  padding: isCompact ? "3px 0" : "5px 0",
                                  borderBottom: "1px solid #000000",
                                }}
                              >
                                <DynamicBarcodeGraphic
                                  code={slip.trackingNumber}
                                  height={isCompact ? 28 : 40}
                                />
                                <div
                                  style={{
                                    fontSize: isCompact ? "10px" : "12px",
                                    fontWeight: "800",
                                    letterSpacing: "1.5px",
                                    marginTop: "2px",
                                  }}
                                >
                                  {slip.trackingNumber || "PENDING BOOKING"}
                                </div>
                              </div>

                              {/* Customer Address */}
                              <div
                                style={{
                                  borderBottom: "1.5px solid #000000",
                                  padding: isCompact ? "3px 0" : "5px 0",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "8.5px",
                                    fontWeight: "700",
                                    textTransform: "uppercase",
                                    color: "#555555",
                                  }}
                                >
                                  Deliver To Customer:
                                </div>
                                <div
                                  style={{
                                    fontSize: isCompact ? "11px" : "13px",
                                    fontWeight: "800",
                                    marginTop: "1px",
                                  }}
                                >
                                  {slip.customerName}
                                </div>
                                <div
                                  style={{
                                    fontSize: isCompact ? "10px" : "12px",
                                    fontWeight: "700",
                                    marginTop: "1px",
                                  }}
                                >
                                  📞 {slip.customerPhone}
                                </div>
                                <div
                                  style={{
                                    fontSize: isCompact ? "9.5px" : "11px",
                                    marginTop: "2px",
                                    lineHeight: "1.2",
                                  }}
                                >
                                  {slip.shippingAddress}
                                </div>
                              </div>

                              {/* COD & Items */}
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  padding: isCompact ? "2px 0" : "4px 0",
                                  borderBottom: "1px solid #000000",
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      fontSize: "8.5px",
                                      fontWeight: "700",
                                      textTransform: "uppercase",
                                      color: "#555555",
                                    }}
                                  >
                                    Total COD Amount
                                  </div>
                                  <div
                                    style={{
                                      fontSize: isCompact ? "13px" : "17px",
                                      fontWeight: "900",
                                      color:
                                        Number(slip.codAmount) === 0
                                          ? "#047857"
                                          : "#000000",
                                    }}
                                  >
                                    {Number(slip.codAmount) === 0
                                      ? "PREPAID (৳0 COD)"
                                      : `${slip.currencyCode} ৳${slip.codAmount}`}
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div
                                    style={{
                                      fontSize: "8.5px",
                                      fontWeight: "700",
                                      textTransform: "uppercase",
                                      color: "#555555",
                                    }}
                                  >
                                    Items Total
                                  </div>
                                  <div
                                    style={{
                                      fontSize: isCompact ? "12px" : "14px",
                                      fontWeight: "800",
                                    }}
                                  >
                                    {totalItemsCount} Pcs
                                  </div>
                                </div>
                              </div>

                              {/* Tier-Specific Footer Section */}
                              {activeLabelStyle === "brand_centric" && (
                                <div style={{ marginTop: "2px" }}>
                                  <div
                                    style={{
                                      backgroundColor: "#111827",
                                      color: "#ffffff",
                                      padding: isCompact ? "2px 4px" : "4px 6px",
                                      borderRadius: "2px",
                                      fontWeight: 800,
                                      fontSize: isCompact ? "8px" : "9px",
                                      textAlign: "center",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.5px",
                                    }}
                                  >
                                    Thank you for shopping with us!
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "8.5px",
                                      color: "#444444",
                                      marginTop: "2px",
                                    }}
                                  >
                                    <strong>Note:</strong> {effectiveNote}
                                  </div>
                                </div>
                              )}

                              {activeLabelStyle === "smart_warehouse" && (
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "2px",
                                    marginTop: "2px",
                                  }}
                                >
                                  <div
                                    style={{
                                      border: "1px solid #000000",
                                      backgroundColor: "#fef3c7",
                                      color: "#92400e",
                                      padding: "1px 4px",
                                      borderRadius: "2px",
                                      fontSize: "8px",
                                      fontWeight: 800,
                                      textAlign: "center",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.5px",
                                    }}
                                  >
                                    ⚠️{" "}
                                    {shippingLabelConfig?.warehouseWarning ||
                                      "FRAGILE / HANDLE WITH CARE"}
                                  </div>
                                  <div
                                    style={{
                                      borderTop: "1px dashed #000000",
                                      paddingTop: "1px",
                                      display: "flex",
                                      justifyContent: "space-between",
                                      fontSize: "8px",
                                      fontWeight: 800,
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    <span>FULFILLMENT MANIFEST</span>
                                    <span>ITEMS: {totalItemsCount}</span>
                                  </div>
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: "1px",
                                      fontSize: "8px",
                                    }}
                                  >
                                    {slip.lineItems
                                      .slice(0, isCompact ? 2 : 3)
                                      .map((it, idx) => (
                                        <div
                                          key={idx}
                                          style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            borderBottom: "1px dotted #ccc",
                                            paddingBottom: "1px",
                                          }}
                                        >
                                          <div>
                                            <span style={{ fontWeight: 700 }}>
                                              {it.title}
                                            </span>
                                            {it.variantTitle && (
                                              <span
                                                style={{
                                                  color: "#4b5563",
                                                  marginLeft: "3px",
                                                }}
                                              >
                                                ({it.variantTitle})
                                              </span>
                                            )}
                                            {it.sku && (
                                              <span
                                                style={{
                                                  fontFamily: "monospace",
                                                  fontSize: "7px",
                                                  color: "#6b7280",
                                                  marginLeft: "3px",
                                                }}
                                              >
                                                SKU: {it.sku}
                                              </span>
                                            )}
                                          </div>
                                          <span style={{ fontWeight: 800 }}>
                                            x{it.quantity || 1}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "8px",
                                      color: "#444444",
                                      paddingTop: "1px",
                                    }}
                                  >
                                    <strong>Instruction:</strong> {effectiveNote}
                                  </div>
                                </div>
                              )}

                              {activeLabelStyle === "standard" && (
                                <div
                                  style={{
                                    fontSize: isCompact ? "8.5px" : "9.5px",
                                    color: "#444444",
                                    paddingTop: "2px",
                                  }}
                                >
                                  <strong>Note:</strong> {effectiveNote}
                                </div>
                              )}
                            </div>
                          );
                        }

                        // INVOICE PRINTING TIERS (A4)
                        const activeInvoiceTemplate = (
                          selectedSlipTemplate ||
                          invoiceConfig?.invoiceTemplate ||
                          "classic"
                        ).toLowerCase();

                        // A. CLASSIC MINIMALIST INVOICE
                        if (
                          activeInvoiceTemplate === "classic" ||
                          activeInvoiceTemplate === "standard"
                        ) {
                          return (
                            <div
                              key={`${slip.orderId}-${index}-classic`}
                              style={{
                                width: "100%",
                                maxWidth: "210mm",
                                minHeight: "270mm",
                                boxSizing: "border-box",
                                border: "1px solid #d1d5db",
                                borderRadius: "4px",
                                padding: "16mm 14mm",
                                margin: "0 auto",
                                background: "#ffffff",
                                color: "#111827",
                                fontFamily: "system-ui, -apple-system, sans-serif",
                                pageBreakAfter: isLastSlip ? "auto" : "always",
                                breakAfter: isLastSlip ? "auto" : "page",
                                pageBreakInside: "avoid",
                                breakInside: "avoid",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                              }}
                            >
                              <div>
                                {/* Header */}
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                    borderBottom: "1.5px solid #111827",
                                    paddingBottom: "12px",
                                    marginBottom: "16px",
                                  }}
                                >
                                  <div>
                                    {invoiceConfig?.invoiceBrandLogo ? (
                                      <img
                                        src={invoiceConfig.invoiceBrandLogo}
                                        alt={
                                          invoiceConfig.invoiceBrandName ||
                                          "Brand Logo"
                                        }
                                        style={{
                                          maxHeight: "44px",
                                          maxWidth: "160px",
                                          objectFit: "contain",
                                          marginBottom: "4px",
                                        }}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          fontSize: "20px",
                                          fontWeight: 800,
                                          textTransform: "uppercase",
                                        }}
                                      >
                                        {invoiceConfig?.invoiceBrandName ||
                                          brandName ||
                                          shopDomain}
                                      </div>
                                    )}
                                    <div
                                      style={{
                                        fontSize: "11px",
                                        color: "#4b5563",
                                        lineHeight: 1.4,
                                      }}
                                    >
                                      {invoiceConfig?.invoiceBrandAddress && (
                                        <div>
                                          {invoiceConfig.invoiceBrandAddress}
                                        </div>
                                      )}
                                      {invoiceConfig?.invoiceBrandPhone && (
                                        <div>
                                          Phone: {invoiceConfig.invoiceBrandPhone}
                                        </div>
                                      )}
                                      {invoiceConfig?.invoiceBrandEmail && (
                                        <div>
                                          Email: {invoiceConfig.invoiceBrandEmail}
                                        </div>
                                      )}
                                      {invoiceConfig?.invoiceBrandWebsite && (
                                        <div>
                                          Web: {invoiceConfig.invoiceBrandWebsite}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <div
                                      style={{
                                        fontSize: "24px",
                                        fontWeight: 900,
                                        letterSpacing: "1px",
                                      }}
                                    >
                                      INVOICE
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "11px",
                                        color: "#4b5563",
                                        marginTop: "4px",
                                        lineHeight: 1.4,
                                      }}
                                    >
                                      <div>
                                        <strong>Order:</strong> {slip.orderName}
                                      </div>
                                      <div>
                                        <strong>Date:</strong> {slip.bookingDate}
                                      </div>
                                      <div>
                                        <strong>Courier:</strong>{" "}
                                        {slip.courierName}
                                      </div>
                                      {slip.trackingNumber && (
                                        <div>
                                          <strong>Consignment:</strong>{" "}
                                          {slip.trackingNumber}
                                        </div>
                                      )}
                                      <div>
                                        <strong>Payment:</strong>{" "}
                                        {Number(slip.codAmount) === 0
                                          ? "PREPAID"
                                          : "Cash On Delivery (COD)"}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Bill From / Bill To */}
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: "16px",
                                    padding: "12px 0",
                                    borderBottom: "1px solid #e5e7eb",
                                    fontSize: "12px",
                                  }}
                                >
                                  <div>
                                    <div
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        color: "#6b7280",
                                        marginBottom: "3px",
                                      }}
                                    >
                                      Bill From
                                    </div>
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        fontSize: "13px",
                                      }}
                                    >
                                      {invoiceConfig?.invoiceBrandName ||
                                        brandName ||
                                        shopDomain}
                                    </div>
                                    <div
                                      style={{
                                        color: "#4b5563",
                                        marginTop: "2px",
                                        lineHeight: 1.3,
                                      }}
                                    >
                                      {invoiceConfig?.invoiceBrandAddress ||
                                        "Dhaka, Bangladesh"}
                                      <br />
                                      Phone:{" "}
                                      {invoiceConfig?.invoiceBrandPhone ||
                                        "+880 1711-000000"}
                                    </div>
                                  </div>
                                  <div>
                                    <div
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        color: "#6b7280",
                                        marginBottom: "3px",
                                      }}
                                    >
                                      Bill To (Recipient)
                                    </div>
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        fontSize: "13px",
                                      }}
                                    >
                                      {slip.customerName}
                                    </div>
                                    <div
                                      style={{
                                        color: "#4b5563",
                                        marginTop: "2px",
                                        lineHeight: 1.3,
                                      }}
                                    >
                                      {slip.shippingAddress}
                                      <br />
                                      Phone: {slip.customerPhone}
                                    </div>
                                  </div>
                                </div>

                                {/* Line Items Table */}
                                <div style={{ marginTop: "16px" }}>
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      fontSize: "12px",
                                    }}
                                  >
                                    <thead>
                                      <tr
                                        style={{
                                          backgroundColor: "#111827",
                                          color: "#ffffff",
                                          textAlign: "left",
                                        }}
                                      >
                                        <th style={{ padding: "8px 10px" }}>
                                          Item Description
                                        </th>
                                        <th style={{ padding: "8px 10px" }}>SKU</th>
                                        <th
                                          style={{
                                            padding: "8px 10px",
                                            textAlign: "center",
                                          }}
                                        >
                                          Qty
                                        </th>
                                        <th
                                          style={{
                                            padding: "8px 10px",
                                            textAlign: "right",
                                          }}
                                        >
                                          Price
                                        </th>
                                        <th
                                          style={{
                                            padding: "8px 10px",
                                            textAlign: "right",
                                          }}
                                        >
                                          Total
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {slip.lineItems.map((item, i) => {
                                        const itemQty = item.quantity || 1;
                                        const itemUnitPrice =
                                          Number(item.unitPrice) || 0;
                                        const itemTotal =
                                          itemUnitPrice * itemQty;
                                        return (
                                          <tr
                                            key={`${slip.orderId}-classic-item-${i}`}
                                            style={{
                                              borderBottom:
                                                "1px solid #e5e7eb",
                                            }}
                                          >
                                            <td
                                              style={{
                                                padding: "8px 10px",
                                                fontWeight: 600,
                                              }}
                                            >
                                              {item.title}
                                              {item.variantTitle && (
                                                <span
                                                  style={{
                                                    color: "#6b7280",
                                                    fontWeight: 400,
                                                    marginLeft: "4px",
                                                  }}
                                                >
                                                  ({item.variantTitle})
                                                </span>
                                              )}
                                            </td>
                                            <td
                                              style={{
                                                padding: "8px 10px",
                                                fontFamily: "monospace",
                                                color: "#4b5563",
                                              }}
                                            >
                                              {item.sku || "N/A"}
                                            </td>
                                            <td
                                              style={{
                                                padding: "8px 10px",
                                                textAlign: "center",
                                                fontWeight: 700,
                                              }}
                                            >
                                              {itemQty}
                                            </td>
                                            <td
                                              style={{
                                                padding: "8px 10px",
                                                textAlign: "right",
                                              }}
                                            >
                                              ৳{itemUnitPrice.toLocaleString()}
                                            </td>
                                            <td
                                              style={{
                                                padding: "8px 10px",
                                                textAlign: "right",
                                                fontWeight: 700,
                                              }}
                                            >
                                              ৳{itemTotal.toLocaleString()}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {/* Totals & Notes */}
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                    marginTop: "16px",
                                  }}
                                >
                                  <div
                                    style={{
                                      maxWidth: "55%",
                                      fontSize: "11px",
                                      color: "#4b5563",
                                    }}
                                  >
                                    <strong>Note / Instructions:</strong>{" "}
                                    {effectiveNote}
                                  </div>
                                  <div style={{ width: "220px", fontSize: "12px" }}>
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        padding: "3px 0",
                                        color: "#4b5563",
                                      }}
                                    >
                                      <span>Items Total:</span>
                                      <span>
                                        {slip.lineItems.reduce(
                                          (acc, it) =>
                                            acc + (it.quantity || 1),
                                          0
                                        )}{" "}
                                        Pcs
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        padding: "6px 0",
                                        borderTop: "2px solid #111827",
                                        fontSize: "14px",
                                        fontWeight: 800,
                                      }}
                                    >
                                      <span>Total Collectible:</span>
                                      <span>
                                        {Number(slip.codAmount) === 0
                                          ? "৳0 (PREPAID)"
                                          : `${slip.currencyCode} ৳${slip.codAmount}`}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Footer */}
                              <div
                                style={{
                                  borderTop: "1px solid #e5e7eb",
                                  paddingTop: "12px",
                                  marginTop: "20px",
                                  textAlign: "center",
                                  fontSize: "10px",
                                  color: "#6b7280",
                                }}
                              >
                                <p
                                  style={{
                                    fontWeight: 700,
                                    color: "#111827",
                                    marginBottom: "2px",
                                  }}
                                >
                                  Thank you for shopping with{" "}
                                  {invoiceConfig?.invoiceBrandName ||
                                    brandName ||
                                    shopDomain}
                                  !
                                </p>
                                <p>
                                  For inquiries or order support, please contact{" "}
                                  {invoiceConfig?.invoiceBrandPhone ||
                                    brandPhone ||
                                    "+880 1711-000000"}
                                  .
                                </p>
                              </div>
                            </div>
                          );
                        }

                        // B. MODERN PRO INVOICE
                        if (
                          activeInvoiceTemplate === "modern" ||
                          activeInvoiceTemplate === "branded"
                        ) {
                          const accent =
                            invoiceConfig?.invoiceAccentColor || "#2563eb";
                          return (
                            <div
                              key={`${slip.orderId}-${index}-modern`}
                              style={{
                                width: "100%",
                                maxWidth: "210mm",
                                minHeight: "270mm",
                                boxSizing: "border-box",
                                border: `1px solid ${accent}33`,
                                borderRadius: "6px",
                                padding: "0",
                                margin: "0 auto",
                                background: "#ffffff",
                                color: "#111827",
                                fontFamily: "system-ui, -apple-system, sans-serif",
                                pageBreakAfter: isLastSlip ? "auto" : "always",
                                breakAfter: isLastSlip ? "auto" : "page",
                                pageBreakInside: "avoid",
                                breakInside: "avoid",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                overflow: "hidden",
                              }}
                            >
                              {/* Top Accent Color Bar */}
                              <div
                                style={{
                                  width: "100%",
                                  height: "6px",
                                  backgroundColor: accent,
                                }}
                              />

                              <div
                                style={{
                                  padding: "16mm 14mm",
                                  flex: 1,
                                  display: "flex",
                                  flexDirection: "column",
                                  justifyContent: "space-between",
                                }}
                              >
                                <div>
                                  {/* Header */}
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "flex-start",
                                      borderBottom: `2px solid ${accent}`,
                                      paddingBottom: "14px",
                                      marginBottom: "16px",
                                    }}
                                  >
                                    <div>
                                      <div
                                        style={{
                                          fontSize: "28px",
                                          fontWeight: 900,
                                          color: accent,
                                          letterSpacing: "0.5px",
                                        }}
                                      >
                                        INVOICE
                                      </div>
                                      <div
                                        style={{
                                          fontSize: "11px",
                                          color: "#4b5563",
                                          marginTop: "4px",
                                          lineHeight: 1.4,
                                        }}
                                      >
                                        <div>
                                          <strong>Order ID:</strong>{" "}
                                          {slip.orderName}
                                        </div>
                                        <div>
                                          <strong>Date:</strong>{" "}
                                          {slip.bookingDate}
                                        </div>
                                        <div style={{ marginTop: "4px" }}>
                                          <span
                                            style={{
                                              display: "inline-block",
                                              backgroundColor: accent,
                                              color: "#ffffff",
                                              padding: "2px 8px",
                                              borderRadius: "4px",
                                              fontSize: "10px",
                                              fontWeight: 700,
                                              textTransform: "uppercase",
                                              letterSpacing: "0.5px",
                                            }}
                                          >
                                            {Number(slip.codAmount) === 0
                                              ? "PREPAID · ৳0 COD"
                                              : "COD · Due on Delivery"}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    <div style={{ textAlign: "center" }}>
                                      <DynamicBarcodeGraphic
                                        code={slip.trackingNumber}
                                        height={36}
                                      />
                                      {slip.trackingNumber && (
                                        <div
                                          style={{
                                            fontSize: "10px",
                                            fontWeight: 700,
                                            fontFamily: "monospace",
                                            color: "#4b5563",
                                          }}
                                        >
                                          {slip.courierName} • {slip.trackingNumber}
                                        </div>
                                      )}
                                    </div>

                                    <div style={{ textAlign: "right" }}>
                                      {invoiceConfig?.invoiceBrandLogo ? (
                                        <img
                                          src={invoiceConfig.invoiceBrandLogo}
                                          alt={
                                            invoiceConfig.invoiceBrandName ||
                                            "Brand Logo"
                                          }
                                          style={{
                                            maxHeight: "44px",
                                            maxWidth: "150px",
                                            objectFit: "contain",
                                            marginLeft: "auto",
                                            marginBottom: "4px",
                                          }}
                                        />
                                      ) : (
                                        <div
                                          style={{
                                            fontSize: "18px",
                                            fontWeight: 800,
                                            color: "#111827",
                                          }}
                                        >
                                          {invoiceConfig?.invoiceBrandName ||
                                            brandName ||
                                            shopDomain}
                                        </div>
                                      )}
                                      <div
                                        style={{
                                          fontSize: "11px",
                                          color: "#4b5563",
                                          lineHeight: 1.35,
                                        }}
                                      >
                                        {invoiceConfig?.invoiceBrandAddress && (
                                          <div>
                                            {invoiceConfig.invoiceBrandAddress}
                                          </div>
                                        )}
                                        {invoiceConfig?.invoiceBrandPhone && (
                                          <div>
                                            Tel: {invoiceConfig.invoiceBrandPhone}
                                          </div>
                                        )}
                                        {invoiceConfig?.invoiceBrandEmail && (
                                          <div>
                                            {invoiceConfig.invoiceBrandEmail}
                                          </div>
                                        )}
                                        {invoiceConfig?.invoiceBrandWebsite && (
                                          <div
                                            style={{
                                              color: accent,
                                              fontWeight: 600,
                                            }}
                                          >
                                            {invoiceConfig.invoiceBrandWebsite}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Dual-Box Container Layout */}
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "1fr 1fr",
                                      gap: "14px",
                                      marginBottom: "16px",
                                    }}
                                  >
                                    {/* Box 1: Bill From */}
                                    <div
                                      style={{
                                        padding: "10px 14px",
                                        borderRadius: "6px",
                                        border: "1px solid #e5e7eb",
                                        backgroundColor: "#f9fafb",
                                        fontSize: "11px",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "6px",
                                          fontWeight: 800,
                                          fontSize: "10px",
                                          textTransform: "uppercase",
                                          color: "#4b5563",
                                          marginBottom: "4px",
                                        }}
                                      >
                                        <span
                                          style={{
                                            width: "7px",
                                            height: "7px",
                                            borderRadius: "50%",
                                            backgroundColor: accent,
                                            display: "inline-block",
                                          }}
                                        />
                                        Bill From
                                      </div>
                                      <div
                                        style={{
                                          fontWeight: 700,
                                          fontSize: "12px",
                                          color: "#111827",
                                        }}
                                      >
                                        {invoiceConfig?.invoiceBrandName ||
                                          brandName ||
                                          shopDomain}
                                      </div>
                                      <div
                                        style={{
                                          color: "#4b5563",
                                          marginTop: "2px",
                                          lineHeight: 1.35,
                                        }}
                                      >
                                        {invoiceConfig?.invoiceBrandAddress ||
                                          "Dhaka, Bangladesh"}
                                        <br />
                                        Tel:{" "}
                                        {invoiceConfig?.invoiceBrandPhone ||
                                          "+880 1711-000000"}
                                      </div>
                                    </div>

                                    {/* Box 2: Bill To */}
                                    <div
                                      style={{
                                        padding: "10px 14px",
                                        borderRadius: "6px",
                                        border: "1px solid #e5e7eb",
                                        backgroundColor: "#f9fafb",
                                        fontSize: "11px",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          marginBottom: "4px",
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            fontWeight: 800,
                                            fontSize: "10px",
                                            textTransform: "uppercase",
                                            color: "#4b5563",
                                          }}
                                        >
                                          <span
                                            style={{
                                              width: "7px",
                                              height: "7px",
                                              borderRadius: "50%",
                                              backgroundColor: "#10b981",
                                              display: "inline-block",
                                            }}
                                          />
                                          Bill To (Customer)
                                        </div>
                                        <span
                                          style={{
                                            fontSize: "9px",
                                            fontWeight: 700,
                                            color: "#047857",
                                            backgroundColor: "#d1fae5",
                                            padding: "1px 5px",
                                            borderRadius: "3px",
                                          }}
                                        >
                                          Verified Delivery
                                        </span>
                                      </div>
                                      <div
                                        style={{
                                          fontWeight: 700,
                                          fontSize: "12px",
                                          color: "#111827",
                                        }}
                                      >
                                        {slip.customerName}
                                      </div>
                                      <div
                                        style={{
                                          color: "#4b5563",
                                          marginTop: "2px",
                                          lineHeight: 1.35,
                                        }}
                                      >
                                        {slip.shippingAddress}
                                        <br />
                                        Phone: {slip.customerPhone}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Table */}
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      fontSize: "12px",
                                    }}
                                  >
                                    <thead>
                                      <tr
                                        style={{
                                          borderBottom: `2px solid ${accent}`,
                                          color: "#111827",
                                          textAlign: "left",
                                          fontSize: "11px",
                                          textTransform: "uppercase",
                                          letterSpacing: "0.5px",
                                        }}
                                      >
                                        <th style={{ padding: "8px 6px" }}>
                                          Product Description
                                        </th>
                                        <th style={{ padding: "8px 6px" }}>
                                          Internal SKU
                                        </th>
                                        <th
                                          style={{
                                            padding: "8px 6px",
                                            textAlign: "center",
                                          }}
                                        >
                                          Qty
                                        </th>
                                        <th
                                          style={{
                                            padding: "8px 6px",
                                            textAlign: "right",
                                          }}
                                        >
                                          Price
                                        </th>
                                        <th
                                          style={{
                                            padding: "8px 6px",
                                            textAlign: "right",
                                          }}
                                        >
                                          Total
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {slip.lineItems.map((item, i) => {
                                        const itemQty = item.quantity || 1;
                                        const itemUnitPrice =
                                          Number(item.unitPrice) || 0;
                                        const itemTotal =
                                          itemUnitPrice * itemQty;
                                        return (
                                          <tr
                                            key={`${slip.orderId}-modern-item-${i}`}
                                            style={{
                                              borderBottom:
                                                "1px solid #f3f4f6",
                                            }}
                                          >
                                            <td
                                              style={{
                                                padding: "8px 6px",
                                                fontWeight: 600,
                                              }}
                                            >
                                              {item.title}
                                              {item.variantTitle && (
                                                <span
                                                  style={{
                                                    display: "inline-block",
                                                    backgroundColor: `${accent}15`,
                                                    color: accent,
                                                    padding: "1px 6px",
                                                    borderRadius: "3px",
                                                    fontSize: "10px",
                                                    fontWeight: 700,
                                                    marginLeft: "6px",
                                                  }}
                                                >
                                                  {item.variantTitle}
                                                </span>
                                              )}
                                            </td>
                                            <td
                                              style={{
                                                padding: "8px 6px",
                                                fontFamily: "monospace",
                                                fontWeight: 700,
                                                color: "#4b5563",
                                              }}
                                            >
                                              {item.sku || "N/A"}
                                            </td>
                                            <td
                                              style={{
                                                padding: "8px 6px",
                                                textAlign: "center",
                                                fontWeight: 700,
                                              }}
                                            >
                                              {itemQty}
                                            </td>
                                            <td
                                              style={{
                                                padding: "8px 6px",
                                                textAlign: "right",
                                              }}
                                            >
                                              ৳{itemUnitPrice.toLocaleString()}
                                            </td>
                                            <td
                                              style={{
                                                padding: "8px 6px",
                                                textAlign: "right",
                                                fontWeight: 800,
                                              }}
                                            >
                                              ৳{itemTotal.toLocaleString()}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>

                                  {/* Financial Summary */}
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "flex-start",
                                      marginTop: "16px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        maxWidth: "50%",
                                        fontSize: "11px",
                                        color: "#4b5563",
                                      }}
                                    >
                                      <strong>Note:</strong> {effectiveNote}
                                    </div>
                                    <div
                                      style={{
                                        width: "230px",
                                        padding: "10px 14px",
                                        borderRadius: "6px",
                                        border: "1px solid #e5e7eb",
                                        backgroundColor: "#f9fafb",
                                        fontSize: "11px",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          padding: "3px 0",
                                          color: "#4b5563",
                                        }}
                                      >
                                        <span>Total Items:</span>
                                        <span>
                                          {slip.lineItems.reduce(
                                            (acc, it) =>
                                              acc + (it.quantity || 1),
                                            0
                                          )}{" "}
                                          Pcs
                                        </span>
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          padding: "6px 0",
                                          borderTop: `2px solid ${accent}`,
                                          fontSize: "14px",
                                          fontWeight: 900,
                                          color: accent,
                                        }}
                                      >
                                        <span>Total Payable:</span>
                                        <span>
                                          {Number(slip.codAmount) === 0
                                            ? "৳0 (PREPAID)"
                                            : `${slip.currencyCode} ৳${slip.codAmount}`}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Modern Footer */}
                                <div
                                  style={{
                                    borderTop: "1px solid #f3f4f6",
                                    paddingTop: "12px",
                                    marginTop: "20px",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    fontSize: "10px",
                                    color: "#6b7280",
                                  }}
                                >
                                  <div>
                                    <span
                                      style={{
                                        fontWeight: 700,
                                        color: "#111827",
                                      }}
                                    >
                                      {invoiceConfig?.invoiceBrandName ||
                                        brandName ||
                                        shopDomain}
                                    </span>{" "}
                                    • Official Store Invoice
                                  </div>
                                  <div
                                    style={{
                                      fontWeight: 700,
                                      color: accent,
                                    }}
                                  >
                                    Verified E-Commerce Dispatch
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // C. WAREHOUSE FULFILLMENT (ENTERPRISE) MANIFEST INVOICE
                        return (
                          <div
                            key={`${slip.orderId}-${index}-warehouse`}
                            style={{
                              width: "100%",
                              maxWidth: "210mm",
                              minHeight: "270mm",
                              boxSizing: "border-box",
                              border: "2px solid #111827",
                              borderRadius: "6px",
                              padding: "16mm 14mm",
                              margin: "0 auto",
                              background: "#ffffff",
                              color: "#111827",
                              fontFamily: "system-ui, -apple-system, sans-serif",
                              pageBreakAfter: isLastSlip ? "auto" : "always",
                              breakAfter: isLastSlip ? "auto" : "page",
                              pageBreakInside: "avoid",
                              breakInside: "avoid",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "space-between",
                            }}
                          >
                            <div>
                              {/* Warehouse Dual-Identity Banner Header */}
                              <div
                                style={{
                                  border: "2px solid #111827",
                                  padding: "10px 14px",
                                  borderRadius: "4px",
                                  backgroundColor: "#f8fafc",
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: "16px",
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      fontSize: "18px",
                                      fontWeight: 900,
                                      letterSpacing: "1.5px",
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    INVOICE / PACKING MANIFEST
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: 700,
                                      color: "#4b5563",
                                      letterSpacing: "0.5px",
                                    }}
                                  >
                                    ENTERPRISE WAREHOUSE DISPATCH • HUB:
                                    DAC-NORTH
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div
                                    style={{
                                      fontSize: "16px",
                                      fontWeight: 900,
                                    }}
                                  >
                                    ORDER {slip.orderName}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "10px",
                                      color: "#6b7280",
                                    }}
                                  >
                                    {slip.bookingDate}
                                  </div>
                                </div>
                              </div>

                              {/* Brand & Warehouse Dispatch Row */}
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "flex-start",
                                  paddingBottom: "12px",
                                  borderBottom: "1.5px solid #d1d5db",
                                  fontSize: "11px",
                                }}
                              >
                                <div>
                                  {invoiceConfig?.invoiceBrandLogo ? (
                                    <img
                                      src={invoiceConfig.invoiceBrandLogo}
                                      alt={
                                        invoiceConfig.invoiceBrandName ||
                                        "Brand Logo"
                                      }
                                      style={{
                                        maxHeight: "36px",
                                        maxWidth: "140px",
                                        objectFit: "contain",
                                        marginBottom: "4px",
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        fontSize: "16px",
                                        fontWeight: 800,
                                      }}
                                    >
                                      {invoiceConfig?.invoiceBrandName ||
                                        brandName ||
                                        shopDomain}
                                    </div>
                                  )}
                                  <div
                                    style={{
                                      color: "#4b5563",
                                      lineHeight: 1.35,
                                    }}
                                  >
                                    {invoiceConfig?.invoiceBrandAddress && (
                                      <div>
                                        {invoiceConfig.invoiceBrandAddress}
                                      </div>
                                    )}
                                    <div>
                                      Dispatch Hotline:{" "}
                                      {invoiceConfig?.invoiceBrandPhone ||
                                        brandPhone ||
                                        "+880 1711-000000"}
                                    </div>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    textAlign: "right",
                                    color: "#4b5563",
                                    lineHeight: 1.4,
                                  }}
                                >
                                  <div>
                                    <strong>Fulfillment:</strong> Auto-Routing
                                  </div>
                                  <div>
                                    <strong>Courier Partner:</strong>{" "}
                                    {slip.courierName}
                                  </div>
                                  <div>
                                    <strong>Consignment:</strong>{" "}
                                    {slip.trackingNumber || "PENDING"}
                                  </div>
                                </div>
                              </div>

                              {/* Consignee Recipient Block */}
                              <div
                                style={{
                                  margin: "12px 0",
                                  padding: "10px 14px",
                                  backgroundColor: "#f3f4f6",
                                  borderRadius: "4px",
                                  border: "1px solid #d1d5db",
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: "14px",
                                  fontSize: "11px",
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: 800,
                                      textTransform: "uppercase",
                                      color: "#4b5563",
                                    }}
                                  >
                                    Ship To (Consignee)
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "13px",
                                      fontWeight: 800,
                                      marginTop: "2px",
                                    }}
                                  >
                                    {slip.customerName}
                                  </div>
                                  <div
                                    style={{
                                      color: "#374151",
                                      marginTop: "2px",
                                      lineHeight: 1.3,
                                    }}
                                  >
                                    {slip.shippingAddress}
                                    <br />
                                    Phone: {slip.customerPhone}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    borderLeft: "1px solid #d1d5db",
                                    paddingLeft: "14px",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: 800,
                                      textTransform: "uppercase",
                                      color: "#4b5563",
                                    }}
                                  >
                                    Payment Instructions
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "14px",
                                      fontWeight: 900,
                                      color:
                                        Number(slip.codAmount) === 0
                                          ? "#047857"
                                          : "#dc2626",
                                      marginTop: "2px",
                                    }}
                                  >
                                    {Number(slip.codAmount) === 0
                                      ? "PREPAID (৳0 COD)"
                                      : `COLLECT CASH: ${slip.currencyCode} ৳${slip.codAmount}`}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "10px",
                                      color: "#6b7280",
                                      marginTop: "2px",
                                    }}
                                  >
                                    Courier: {slip.courierName}
                                  </div>
                                </div>
                              </div>

                              {/* Packaging Staff Instruction Banner */}
                              <div
                                style={{
                                  border: "1.5px solid #dc2626",
                                  backgroundColor: "#fef2f2",
                                  color: "#991b1b",
                                  padding: "8px 12px",
                                  borderRadius: "4px",
                                  fontWeight: 800,
                                  fontSize: "12px",
                                  marginBottom: "12px",
                                }}
                              >
                                ⚠️ PACKAGING STAFF INSTRUCTION: {effectiveNote}
                              </div>

                              {/* Order Table with Barcoding Metadata */}
                              <table
                                style={{
                                  width: "100%",
                                  borderCollapse: "collapse",
                                  fontSize: "12px",
                                }}
                              >
                                <thead>
                                  <tr
                                    style={{
                                      backgroundColor: "#1f2937",
                                      color: "#ffffff",
                                      textAlign: "left",
                                      fontSize: "10px",
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    <th style={{ padding: "8px 10px" }}>
                                      Internal SKU & Barcode
                                    </th>
                                    <th style={{ padding: "8px 10px" }}>
                                      Item & Variant Description
                                    </th>
                                    <th
                                      style={{
                                        padding: "8px 10px",
                                        textAlign: "center",
                                      }}
                                    >
                                      Pick Qty
                                    </th>
                                    <th
                                      style={{
                                        padding: "8px 10px",
                                        textAlign: "right",
                                      }}
                                    >
                                      Price
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {slip.lineItems.map((item, i) => (
                                    <tr
                                      key={`${slip.orderId}-warehouse-item-${i}`}
                                      style={{
                                        borderBottom: "1px solid #e5e7eb",
                                      }}
                                    >
                                      <td
                                        style={{
                                          padding: "8px 10px",
                                          fontFamily: "monospace",
                                          fontWeight: 800,
                                          fontSize: "13px",
                                        }}
                                      >
                                        <div>{item.sku || "N/A"}</div>
                                        <div
                                          style={{
                                            fontSize: "8px",
                                            color: "#6b7280",
                                            marginTop: "1px",
                                          }}
                                        >
                                          BIN: A-04
                                        </div>
                                      </td>
                                      <td style={{ padding: "8px 10px" }}>
                                        <div style={{ fontWeight: 700 }}>
                                          {item.title}
                                        </div>
                                        {item.variantTitle && (
                                          <div
                                            style={{
                                              display: "inline-block",
                                              marginTop: "2px",
                                              backgroundColor: "#fef3c7",
                                              border: "1px solid #f59e0b",
                                              padding: "1px 6px",
                                              fontWeight: 700,
                                              fontSize: "10px",
                                            }}
                                          >
                                            {item.variantTitle}
                                          </div>
                                        )}
                                      </td>
                                      <td
                                        style={{
                                          padding: "8px 10px",
                                          textAlign: "center",
                                          fontWeight: 800,
                                          fontSize: "14px",
                                        }}
                                      >
                                        x{item.quantity || 1}
                                      </td>
                                      <td
                                        style={{
                                          padding: "8px 10px",
                                          textAlign: "right",
                                          fontWeight: 700,
                                        }}
                                      >
                                        ৳
                                        {(
                                          Number(item.unitPrice) || 0
                                        ).toLocaleString()}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Manifest Bottom Barcode */}
                            <div
                              style={{
                                textAlign: "center",
                                borderTop: "2px dashed #111827",
                                paddingTop: "12px",
                                marginTop: "16px",
                              }}
                            >
                              <DynamicBarcodeGraphic
                                code={slip.trackingNumber}
                                height={38}
                              />
                              <div
                                style={{
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  color: "#6b7280",
                                  marginTop: "2px",
                                }}
                              >
                                TRACKING MANIFEST REF: {slip.trackingNumber || "PENDING"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </BlockStack>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ==================== BULK COURIER FULFILLMENT QUEUE OVERVIEW ==================== */}
          <Layout.Section>
            <div
              className="bg-slate-50 rounded-xl p-4"
              style={{
                backgroundColor: "#f8fafc",
                borderRadius: "12px",
                padding: "16px",
                border: "none",
                boxShadow: "none",
              }}
            >
              <BlockStack gap="150">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <Text as="h2" variant="headingMd">
                      Bulk Order Booking
                    </Text>
                    <Badge tone="info">
                      {usageSummary.isUnlimitedBulk
                        ? `${usageSummary.currentPlan} Plan: Unlimited Bulk Booking`
                        : `${usageSummary.currentPlan} Plan Cap: Max ${usageSummary.bulkBatchLimit} Orders / Batch`}
                    </Badge>
                    {isProOrEnterprise && (
                      <Badge tone="success">
                        Live Status Sync &amp; Cash Verification: Active
                      </Badge>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                      marginLeft: "auto",
                    }}
                  >
                    <Badge tone={activeCouriers.pathao ? "success" : undefined}>
                      {`Pathao: ${activeCouriers.pathao ? "Ready" : "Off"}`}
                    </Badge>
                    <Badge tone={activeCouriers.steadfast ? "success" : undefined}>
                      {`Steadfast: ${activeCouriers.steadfast ? "Ready" : "Off"}`}
                    </Badge>
                    <Badge tone={activeCouriers.redx ? "success" : undefined}>
                      {`RedX: ${activeCouriers.redx ? "Ready" : "Off"}`}
                    </Badge>
                    <Badge tone={activeCouriers.carrybee ? "success" : undefined}>
                      {`CarryBee: ${activeCouriers.carrybee ? "Ready" : "Off"}`}
                    </Badge>
                    <Badge tone={activeCouriers.bahok ? "success" : undefined}>
                      {`Bahok: ${activeCouriers.bahok ? "Ready" : "Off"}`}
                    </Badge>
                  </div>
                </div>

                <Text as="p" variant="bodySm" tone="subdued">
                  Tick row checkboxes to select orders. Once selected, book parcels with one click and print thermal shipping labels or invoices.
                </Text>
              </BlockStack>
            </div>
          </Layout.Section>

          {/* ==================== SMART AI ADDRESS SETTINGS BANNER ==================== */}
          <Layout.Section>
            <div
              className="bg-blue-50/50 rounded-lg"
              style={{
                backgroundColor: "rgba(239, 246, 255, 0.5)",
                border: "1px solid rgba(191, 219, 254, 0.5)",
                borderRadius: "8px",
                padding: "8px 14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "14px", lineHeight: 1 }}>✨</span>
                  <span style={{ fontSize: "12px", color: "#1e40af", fontWeight: 500 }}>
                    To clean, verify, and correct customer addresses automatically using Smart Gemini AI, please make sure the feature is turned on in your app settings.
                  </span>
                </div>
                <Link url="/app/courier-settings" removeUnderline>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#2563eb",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "2px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Courier Settings ↗
                  </span>
                </Link>
              </div>
            </div>
          </Layout.Section>

          {/* ==================== MULTI-SELECT ORDERS INDEXTABLE ==================== */}
          <Layout.Section>
            <Card padding="0">
              {/* 1. Exactly 11 Functional Tabs */}
              <div
                className="orders-tabs-nowrap-container"
                style={{
                  whiteSpace: "nowrap",
                  overflowX: "auto",
                  maxWidth: "100%",
                  paddingBottom: "6px",
                }}
              >
                <Tabs
                  tabs={tabsList}
                  selected={selectedTabIndex}
                  onSelect={handleTabSelect}
                />
              </div>

              {/* 2. Wide Search Box & Date Picker Popover */}
              <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Search orders"
                      labelHidden
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="Search orders by phone, ID, customer, parcel..."
                      clearButton
                      onClearButtonClick={() => {
                        setSearchQuery("");
                        if (searchParams.has("q")) {
                          const nextParams = new URLSearchParams(searchParams);
                          nextParams.delete("q");
                          setSearchParams(nextParams, { replace: true });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const nextParams = new URLSearchParams(searchParams);
                          if (searchQuery.trim()) {
                            nextParams.set("q", searchQuery.trim());
                          } else {
                            nextParams.delete("q");
                          }
                          setSearchParams(nextParams, { replace: true });
                        }
                      }}
                      autoComplete="off"
                      prefix={<span style={{ color: "#9CA3AF" }}>🔍</span>}
                    />
                  </div>
                  <Popover
                    active={isDatePopoverActive}
                    activator={
                      <Button
                        disclosure
                        onClick={() => {
                          if (!isDatePopoverActive) {
                            setTempRange(dateRange);
                            setStartDateInput(formatDateToYMD(dateRange?.start ?? null));
                            setEndDateInput(formatDateToYMD(dateRange?.end ?? null));
                          }
                          setIsDatePopoverActive((prev) => !prev);
                        }}
                      >
                        {dateRangeLabel}
                      </Button>
                    }
                    onClose={() => setIsDatePopoverActive(false)}
                    preferredAlignment="right"
                    fluidContent
                  >
                    <div
                      className="date-picker-popover-viewport"
                      style={{
                        minWidth: "750px",
                        maxWidth: "800px",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      {/* Main Body Container: Strict Inline Row Presentation */}
                      <div
                        className="date-picker-dual-pane"
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          width: "100%",
                          overflow: "hidden",
                        }}
                      >
                        {/* Left Sidebar (Presets Column) */}
                        <div
                          style={{
                            width: "180px",
                            minWidth: "180px",
                            borderRight: "1px solid #e1e3e5",
                            padding: "12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <Text variant="headingXs" as="h6" tone="subdued">
                            PRESETS
                          </Text>
                          {DATE_PRESET_ITEMS.map((p) => {
                            const isSelected = selectedPresetId === p.id;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => handlePresetClick(p.id)}
                                style={{
                                  textAlign: "left",
                                  width: "100%",
                                  padding: "8px 10px",
                                  borderRadius: "6px",
                                  fontSize: "13px",
                                  fontWeight: isSelected ? 600 : 400,
                                  color: isSelected ? "#2563EB" : "#374151",
                                  backgroundColor: isSelected ? "#EFF6FF" : "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  transition: "background-color 0.15s ease",
                                }}
                              >
                                {p.title}
                              </button>
                            );
                          })}
                        </div>

                        {/* Right Sidebar (Dual Month Panel) */}
                        <div
                          style={{
                            width: "540px",
                            minWidth: "540px",
                            padding: "16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "12px",
                            flex: 1,
                          }}
                        >
                          {/* Inputs Top Bar: [ YYYY-MM-DD ] ➔ [ YYYY-MM-DD ] */}
                          <InlineStack gap="200" blockAlign="center">
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="Start Date"
                                labelHidden
                                value={startDateInput}
                                onChange={handleStartDateInputChange}
                                placeholder="YYYY-MM-DD"
                                autoComplete="off"
                                prefix={<span style={{ color: "#9CA3AF" }}>📅</span>}
                              />
                            </div>
                            <Text as="span" variant="bodyMd" tone="subdued">
                              ➔
                            </Text>
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="End Date"
                                labelHidden
                                value={endDateInput}
                                onChange={handleEndDateInputChange}
                                placeholder="YYYY-MM-DD"
                                autoComplete="off"
                                prefix={<span style={{ color: "#9CA3AF" }}>📅</span>}
                              />
                            </div>
                          </InlineStack>

                          {/* Dual Month Calendar */}
                          <div style={{ overflowX: "visible", width: "100%" }}>
                            <Box border="border" borderRadius="200" padding="200">
                              <DatePicker
                                month={pickerMonth}
                                year={pickerYear}
                                onChange={handleDatePickerChange}
                                onMonthChange={handleMonthChange}
                                selected={
                                  tempRange && tempRange.start && tempRange.end
                                    ? { start: tempRange.start, end: tempRange.end }
                                    : tempRange && tempRange.start
                                    ? { start: tempRange.start, end: tempRange.start }
                                    : undefined
                                }
                                multiMonth
                                allowRange
                              />
                            </Box>
                          </div>

                          {/* Anchor the Competitor Action Footer */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "flex-end",
                              gap: "8px",
                              borderTop: "1px solid #e1e3e5",
                              padding: "12px 16px",
                              marginTop: "auto",
                              marginLeft: "-16px",
                              marginRight: "-16px",
                              marginBottom: "-16px",
                            }}
                          >
                            <Button onClick={handleCancelDatePopover}>Cancel</Button>
                            <Button variant="primary" onClick={handleApplyDatePopover}>
                              Apply
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Popover>
                </InlineStack>
              </Box>

              {/* Batch Limit Exceeded Alert (Rendered above table if plan cap is breached) */}
              {selectedResources.length > 0 && isBatchOverPlanCap && (
                <Box paddingBlock="200" paddingInline="400">
                  <Banner
                    title="Bulk Selection Limit Exceeded"
                    tone="critical"
                    action={{ content: "Upgrade Plan", url: "/app/pricing" }}
                  >
                    <p>
                      You have selected {selectedResources.length} orders. Your plan (
                      {usageSummary.currentPlan}) allows a maximum of{" "}
                      {usageSummary.bulkBatchLimit} orders per bulk batch.
                    </p>
                  </Banner>
                </Box>
              )}

              {displayedOrders.length === 0 ? (
                <Box paddingBlock="600" paddingInline="500">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="h3" variant="headingMd" alignment="center">
                      No Orders Found
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                      No orders match the selected filter, status tab, or date range.
                    </Text>
                    {(searchQuery || selectedTabId !== "all" || dateRange) && (
                      <Button
                        variant="plain"
                        onClick={() => {
                          setSearchQuery("");
                          setSelectedTabId("all");
                          handleClearAllDates();
                          if (
                            searchParams.has("q") ||
                            searchParams.has("tab") ||
                            searchParams.has("startDate") ||
                            searchParams.has("endDate")
                          ) {
                            const nextParams = new URLSearchParams();
                            setSearchParams(nextParams, { replace: true });
                          }
                        }}
                      >
                        Clear All Filters
                      </Button>
                    )}
                  </BlockStack>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "order", plural: "orders" }}
                  itemCount={displayedOrders.length}
                  selectedItemsCount={
                    selectedResources.length === displayedOrders.length
                      ? "All"
                      : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  selectable={true}
                  headings={tableHeadings as any}
                  promotedBulkActions={promotedBulkActions}
                  bulkActions={bulkActions}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
      {phoneCopiedToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#303132",
            color: "#ffffff",
            padding: "6px 16px",
            borderRadius: "100px",
            fontSize: "13px",
            fontWeight: "500",
            zIndex: 9999,
            boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.15)",
            pointerEvents: "none",
          }}
        >
          Phone number copied
        </div>
      )}
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
