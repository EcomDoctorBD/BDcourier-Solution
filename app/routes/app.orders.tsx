import { useState, useEffect, useCallback, useMemo, type SVGProps } from "react";
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

export interface OrderLineItem {
  title: string;
  variantTitle: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  imageUrl?: string;
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
  const financialStatus = String(order.displayFinancialStatus || "").toUpperCase().trim();
  if (financialStatus === "PAID" || financialStatus === "REFUNDED") {
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
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  city: string;
  province: string;
  totalPrice: string;
  currencyCode: string;
  fulfillmentStatus: string;
  displayFinancialStatus: string;
  totalOutstanding: string;
  codAmount: number;
  warehouseNote: string;
  lineItems: OrderLineItem[];
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
}

export interface DispatchedSlipRecord {
  orderId: string;
  orderName: string;
  trackingNumber: string;
  trackingUrl?: string;
  courierName: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  isInsideDhaka: boolean;
  codAmount: string;
  currencyCode: string;
  warehouseNote: string;
  lineItems: OrderLineItem[];
  bookedAt: string;
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

    // 2. Fetch open FulfillmentOrder IDs and mark Fulfilled with tracking info
    const FO_QUERY = `#graphql
      query GetOrderFulfillmentOrders($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 5) {
            edges {
              node {
                id
                status
              }
            }
          }
        }
      }
    `;
    const foRes = await admin.graphql(FO_QUERY, { variables: { id: formattedOrderId } });
    const foJson: any = await foRes.json();
    const foEdges = foJson?.data?.order?.fulfillmentOrders?.edges || [];
    const openFo = foEdges.find(
      ({ node }: any) => node.status === "OPEN" || node.status === "IN_PROGRESS"
    );

    if (openFo?.node?.id) {
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

      await admin.graphql(FULFILL_MUTATION, {
        variables: {
          fulfillment: {
            notifyCustomer: false,
            trackingInfo,
            lineItemsByFulfillmentOrder: [
              { fulfillmentOrderId: openFo.node.id },
            ],
          },
        },
      });
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
  trackingNumber?: string | null
): NormalizedOrder {
  const locationString =
    `${order.city} ${order.province} ${order.shippingAddress}`.toLowerCase();
  const isInsideDhaka = locationString.includes("dhaka");
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

  if (isEnabled) {
    if (isBelowThreshold) {
      return {
        ...order,
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
    const normalizedCity = orderCity.toLowerCase();
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
  } = params;

  // 1. Pre-Flight Double-Booking Atomic Check (Issue 8.1 & Extra Trap #5)
  const existingBooking: any = await ShipmentBooking.findOne({ shopDomain, orderId }).lean();
  if (existingBooking) {
    const hasTracking = Boolean(existingBooking.trackingNumber && String(existingBooking.trackingNumber).trim());
    const isBookedStatus = ["booked", "in_transit", "delivered", "disbursed"].includes(
      String(existingBooking.courierStatus || "").toLowerCase()
    );
    const isRecentInProgress =
      String(existingBooking.courierStatus || "").toLowerCase() === "booking_in_progress" &&
      existingBooking.updatedAt &&
      Date.now() - new Date(existingBooking.updatedAt).getTime() < 60000;

    if (hasTracking || isBookedStatus || isRecentInProgress) {
      return {
        success: false,
        orderId,
        orderName,
        courierName: existingBooking.courierName || "",
        trackingNumber: existingBooking.trackingNumber || "",
        message: `Order ${orderName} is already booked or currently being dispatched to a courier.`,
      };
    }
  }

  // 2. AI Address Correction & Caching Pipeline
  const addressResolution = await cleanAndCacheAddress(shippingAddress);

  if (addressResolution.confidence === "LOW" || !addressResolution.district) {
    return {
      success: false,
      isRiskyLocked: true,
      orderId,
      orderName,
      courierName: "",
      trackingNumber: "",
      message: `Address Quality Alert for ${orderName}: AI Confidence is LOW or district unidentifiable. Automated dispatch aborted and order locked for manual review.`,
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

  // 4. Atomic Booking In-Progress Lock in MongoDB
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

  // Helper to cleanly rollback quota reservation and in-progress lock on courier failure
  const rollbackBooking = async (errorMessage: string) => {
    if (quotaReserved) {
      await CourierConfig.updateOne(
        { shopDomain, monthlyOrderCount: { $gt: 0 } },
        { $inc: { monthlyOrderCount: -1 } }
      );
    }
    await ShipmentBooking.deleteOne({
      shopDomain,
      orderId,
      courierStatus: "booking_in_progress",
    });
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

  const cleanPhone = formatBangladeshPhone(customerPhone);
  const cleanAddress =
    addressResolution.cleanAddress ||
    shippingAddress ||
    "";
  const amountToCollect = Math.max(0, Math.round(Number(codAmount) || 0));

  let courierDisplayName = "";
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
      const orderResponse = await fetch(
        `${baseUrl}/aladdin/api/v1/orders`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${sharedPathaoTokenRef.token}`,
          },
          body: JSON.stringify({
            store_id: Number(storeId) || storeId,
            merchant_order_id: orderName.replace("#", ""),
            recipient_name: customerName,
            recipient_phone: cleanPhone,
            recipient_address: cleanAddress,
            recipient_city: recipientCity,
            recipient_zone: recipientZone,
            delivery_type: 48,
            item_type: 2,
            special_instruction: warehouseNote || `Shopify Order ${orderName}`,
            item_quantity: 1,
            item_weight: 0.5,
            amount_to_collect: amountToCollect,
            item_description: `Order ${orderName} from ${shopDomain}`,
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

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
      const payload = {
        invoice: sanitizedInvoice,
        recipient_name: customerName,
        recipient_phone: cleanPhone,
        recipient_address: cleanAddress,
        cod_amount: amountToCollect,
        note: warehouseNote || `Shopify Order ${orderName}`,
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
        merchant_invoice_id: String(orderName || orderId).replace("#", ""),
        cash_collection_amount: String(amountToCollect),
        parcel_weight: 500,
        instruction: warehouseNote || `Shopify Order ${orderName}`,
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
        merchant_order_id: String(orderName || orderId).replace("#", ""),
        recipient_name: customerName,
        recipient_phone: cleanPhone,
        recipient_address: cleanAddress,
        collectable_amount: amountToCollect,
        notes: warehouseNote || `Shopify Order ${orderName}`,
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
        merchant_order_id: String(orderName || orderId).replace("#", ""),
        recipient_name: customerName,
        recipient_phone: cleanPhone,
        recipient_address: cleanAddress,
        cod_amount: amountToCollect,
        instructions: warehouseNote || `Shopify Order ${orderName}`,
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
        codAmount,
        courierCashCollected: codAmount,
        courierStatus: "in_transit",
        currencyCode,
        warehouseNote,
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
      customerName,
      customerPhone: cleanPhone,
      shippingAddress: cleanAddress,
      isInsideDhaka: isInsideDhakaResolved,
      codAmount,
      currencyCode,
      warehouseNote,
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
        };
      });

      return {
        id: node.id,
        name: node.name,
        createdAt: node.createdAt,
        customerName,
        customerPhone,
        shippingAddress,
        city,
        province,
        totalPrice: node.totalPriceSet?.shopMoney?.amount || "0.00",
        currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "BDT",
        fulfillmentStatus: node.displayFulfillmentStatus || "UNFULFILLED",
        displayFinancialStatus,
        totalOutstanding,
        codAmount,
        warehouseNote: node.note || "",
        lineItems,
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
          customerName: "",
          customerPhone: "",
          shippingAddress: "",
          city: "",
          province: "",
          totalPrice: node.totalPriceSet?.shopMoney?.amount || "0.00",
          currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "BDT",
          fulfillmentStatus: node.displayFulfillmentStatus || "UNFULFILLED",
          displayFinancialStatus,
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

      const isAiCleaned = cleanedMap.has(
        (order.shippingAddress || "").trim().toLowerCase()
      );

      return applyRoutingAndSafetyLogic(
        order,
        fraudStats,
        routingConfig,
        defaultCourierFallback,
        reconciliation,
        isAiCleaned,
        trackingNumber
      );
    })
  );

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
  const [showPackingSlipView, setShowPackingSlipView] = useState(false);

  const planNormalized = usageSummary.currentPlan.toLowerCase();
  const isFreePlan = planNormalized === "free";
  const isEnterprisePlan = planNormalized === "enterprise";
  const isProOrEnterprise = usageSummary.isProOrEnterprise;

  const defaultTemplateByPlan = isEnterprisePlan
    ? "tailored"
    : isFreePlan
    ? "standard"
    : "branded";

  const [selectedSlipTemplate, setSelectedSlipTemplate] = useState<
    "standard" | "branded" | "tailored"
  >(defaultTemplateByPlan);
  const [customShopSlogan, setCustomShopSlogan] = useState(
    "100% Authentic Bangladeshi Products • Fast Nationwide Delivery"
  );

  // Secondary dropdown for batch document printing (4x6 Shipping Labels vs A4 Invoices)
  const [isPrintPopoverActive, setIsPrintPopoverActive] = useState(false);
  const [printDocumentMode, setPrintDocumentMode] = useState<
    "labels_4x6" | "invoices_a4"
  >("invoices_a4");

  const [showBanner, setShowBanner] = useState(false);
  const [clientBatchError, setClientBatchError] = useState<string | null>(null);

  useEffect(() => {
    if (isFreePlan) {
      setSelectedSlipTemplate("standard");
    } else if (!isEnterprisePlan && selectedSlipTemplate === "tailored") {
      setSelectedSlipTemplate("branded");
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
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null } | null>(() => {
    if (activeFilters?.startDate || activeFilters?.endDate) {
      return {
        start: activeFilters.startDate ? new Date(activeFilters.startDate) : null,
        end: activeFilters.endDate ? new Date(activeFilters.endDate) : null,
      };
    }
    return null;
  });
  const [dateRangeLabel, setDateRangeLabel] = useState(() => {
    if (activeFilters?.startDate || activeFilters?.endDate) {
      return "📅 Custom Range";
    }
    return "📅 All time";
  });

  useEffect(() => {
    if (urlTab && urlTab !== selectedTabId) {
      setSelectedTabId(urlTab);
    }
  }, [urlTab]);

  const handleSelectDatePreset = useCallback(
    (preset: string) => {
      const now = new Date();
      let start: Date | null = null;
      let end: Date | null = null;
      let label = "📅 All time";

      if (preset === "all") {
        start = null;
        end = null;
        label = "📅 All time";
      } else if (preset === "today") {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
          999
        );
        label = "📅 Today";
      } else if (preset === "yesterday") {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        start = new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate()
        );
        end = new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          23,
          59,
          59,
          999
        );
        label = "📅 Yesterday";
      } else if (preset === "last7") {
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        end = now;
        label = "📅 Last 7 Days";
      } else if (preset === "last30") {
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        end = now;
        label = "📅 Last 30 Days";
      } else if (preset === "thisMonth") {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
        label = "📅 This Month";
      }

      setDateRange(start ? { start, end } : null);
      setDateRangeLabel(label);
      setIsDatePopoverActive(false);

      if (
        searchParams.get("tab") === "old_orders" ||
        searchParams.has("startDate")
      ) {
        const nextParams = new URLSearchParams(searchParams);
        if (start) {
          nextParams.set("startDate", start.toISOString().split("T")[0]);
        } else {
          nextParams.delete("startDate");
        }
        if (end) {
          nextParams.set("endDate", end.toISOString().split("T")[0]);
        } else {
          nextParams.delete("endDate");
        }
        setSearchParams(nextParams, { replace: true });
      }
    },
    [searchParams, setSearchParams]
  );

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

      switch (tabId) {
        case "all":
          return true;
        case "new":
          return (
            !dispatched &&
            (order.fulfillmentStatus?.toUpperCase() === "UNFULFILLED" ||
              !order.fulfillmentStatus)
          );
        case "accepted":
          return (
            Boolean(dispatched) &&
            (courierStatus === "accepted" ||
              courierStatus === "in_review" ||
              courierStatus === "processing" ||
              courierStatus === "pending")
          );
        case "pending":
          return isLocked || courierStatus === "pending" || courierStatus === "hold";
        case "shipping":
          return (
            Boolean(dispatched) &&
            courierStatus !== "delivered" &&
            courierStatus !== "returned" &&
            courierStatus !== "cancelled"
          );
        case "delivered":
          return (
            Boolean(dispatched) &&
            (courierStatus === "delivered" ||
              Boolean(order.reconciliation?.autoSyncedPaidFulfilled))
          );
        case "cancelled":
          return (
            courierStatus === "cancelled" ||
            order.fulfillmentStatus?.toUpperCase() === "CANCELLED"
          );
        case "returned":
          return courierStatus === "returned";
        case "partially_delivered":
          return (
            courierStatus === "partially_delivered" ||
            courierStatus.includes("partial")
          );
        case "paid_returned":
          return (
            courierStatus === "paid_returned" ||
            (courierStatus === "returned" &&
              Boolean(order.reconciliation?.courierCashCollected) &&
              order.reconciliation?.courierCashCollected !== "0.00")
          );
        case "old_orders":
          return (
            order.fulfillmentStatus?.toUpperCase() === "FULFILLED" ||
            order.fulfillmentStatus?.toUpperCase() === "CLOSED" ||
            order.fulfillmentStatus?.toUpperCase() === "CANCELLED" ||
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

  const courierSelectOptions = [
    {
      label: activeCouriers.pathao
        ? "Pathao Courier (Connected)"
        : "Pathao Courier (Not Configured)",
      value: "pathao",
    },
    {
      label: activeCouriers.steadfast
        ? "Steadfast Courier (Connected)"
        : "Steadfast Courier (Not Configured)",
      value: "steadfast",
    },
    {
      label: activeCouriers.redx
        ? "RedX Delivery (Connected)"
        : "RedX Delivery (Not Configured)",
      value: "redx",
    },
    {
      label: activeCouriers.carrybee
        ? "CarryBee (Connected)"
        : "CarryBee (Not Configured)",
      value: "carrybee",
    },
    {
      label: activeCouriers.bahok
        ? "Bahok Courier (Connected)"
        : "Bahok Courier (Not Configured)",
      value: "bahok",
    },
  ];

  const fallbackCourierOptions = [
    { label: "Pathao Courier", value: "pathao" },
    { label: "Steadfast Courier", value: "steadfast" },
    { label: "RedX Delivery", value: "redx" },
    { label: "CarryBee", value: "carrybee" },
    { label: "Bahok Courier", value: "bahok" },
  ];

  const templateSelectorOptions = [
    {
      label: "1. Standard Layout (Free Tier Mode — Minimalist B&W)",
      value: "standard",
    },
    {
      label: isFreePlan
        ? "2. Custom Branded Layout (🔒 Upgrade to Growth / Pro)"
        : "2. Custom Branded Layout (Growth & Pro Mode — Logo & Slogan Grid)",
      value: "branded",
      disabled: isFreePlan,
    },
    {
      label: isEnterprisePlan
        ? "3. Tailored Warehouse Layout (Enterprise Mode — Dual-Column Industrial)"
        : "3. Tailored Warehouse Layout (🔒 Upgrade to Enterprise)",
      value: "tailored",
      disabled: !isEnterprisePlan,
    },
  ];

  const handleSendSingleOrder = (order: NormalizedOrder) => {
    const chosenCourier =
      selectedCouriersByOrder[order.id] || order.assignedCourier;
    const isUnlocked = Boolean(manuallyUnlockedOrders[order.id]);
    const customNote = warehouseNotesByOrder[order.id] ?? order.warehouseNote;

    const formData = new FormData();
    formData.append("actionType", "dispatchOrder");
    formData.append("orderId", order.id);
    formData.append("orderName", order.name);
    formData.append("selectedCourier", chosenCourier);
    formData.append("customerName", order.customerName);
    formData.append("customerPhone", order.customerPhone);
    formData.append("shippingAddress", order.shippingAddress);
    formData.append("isInsideDhaka", String(order.isInsideDhaka));
    formData.append("codAmount", String(order.codAmount));
    formData.append("currencyCode", order.currencyCode);
    formData.append("warehouseNote", customNote);
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
      .map((order) => ({
        orderId: order.id,
        orderName: order.name,
        selectedCourier:
          selectedCouriersByOrder[order.id] || order.assignedCourier,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        shippingAddress: order.shippingAddress,
        isInsideDhaka: order.isInsideDhaka,
        codAmount: String(order.codAmount),
        currencyCode: order.currencyCode,
        warehouseNote: warehouseNotesByOrder[order.id] ?? order.warehouseNote,
        lineItems: order.lineItems,
        isRiskyLocked: order.isRiskyLocked,
        manualOverrideConfirmed: Boolean(manuallyUnlockedOrders[order.id]),
        manualCityId: manualCityIds[order.id] || null,
        manualZoneId: manualZoneIds[order.id] || null,
        manualAreaId: manualAreaIds[order.id] || null,
        manualAreaName: manualAreaNames[order.id] || null,
      }));

    const formData = new FormData();
    formData.append("actionType", "bulkBookCouriers");
    formData.append("ordersPayload", JSON.stringify(selectedOrderObjects));
    submit(formData, { method: "post" });
  };

  const handlePrintBatchDocuments = (mode: "labels_4x6" | "invoices_a4") => {
    setIsPrintPopoverActive(false);
    setPrintDocumentMode(mode);

    const selectedOrdersList = displayedOrders.filter((o) =>
      selectedResources.includes(o.id)
    );

    if (selectedOrdersList.length === 0) return;

    setDispatchedOrders((prev) => {
      const updated = { ...prev };
      for (const order of selectedOrdersList) {
        if (!updated[order.id]) {
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
              : "RedX Delivery";
          updated[order.id] = {
            orderId: order.id,
            orderName: order.name,
            courierName,
            trackingNumber: "",
            bookingDate: new Date().toLocaleDateString("en-GB"),
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            shippingAddress: order.shippingAddress,
            codAmount: String(order.codAmount),
            currencyCode: order.currencyCode,
            warehouseNote:
              warehouseNotesByOrder[order.id] ?? order.warehouseNote,
            lineItems: order.lineItems,
          };
        }
      }
      return updated;
    });

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

  const bookedSlipsList = Object.values(dispatchedOrders);
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

  const rowMarkup = displayedOrders.map((order, index) => {
    const selectedCourier =
      selectedCouriersByOrder[order.id] || order.assignedCourier;
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
    const sentBadgeText = dispatchedInfo
      ? `✅ Sent: ${partnerName}${dispatchedInfo.trackingNumber ? ` [${dispatchedInfo.trackingNumber}]` : ""}`
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
      >
        {/* Column 1: Order Info & Destination */}
        <IndexTable.Cell>
          <div onClick={(e) => e.stopPropagation()}>
            <BlockStack gap="100">
              <InlineStack gap="150" blockAlign="center">
                <Checkbox
                  label=""
                  labelHidden
                  checked={isRowSelected}
                  disabled={isRowProcessing || isLockedBySafetyNet}
                  onChange={(checked) =>
                    toggleSingleRowCheckbox(order.id, checked)
                  }
                />
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
              </InlineStack>

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
                        style={{
                          height: "22px",
                          padding: "0 8px",
                          borderRadius: "11px",
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
        </IndexTable.Cell>

        {/* Column 3: Customer Information */}
        <IndexTable.Cell>
          <Box minWidth="160px" maxWidth="220px">
            <BlockStack gap="100">
              <Text variant="bodySm" fontWeight="semibold" as="span" truncate>
                {order.customerName || "Customer"}
              </Text>
              {order.customerPhone ? (
                <InlineStack gap="150" blockAlign="center">
                  <Text variant="bodySm" as="span">
                    {order.customerPhone}
                  </Text>
                  <Link url={`tel:${order.customerPhone.replace(/\D/g, "")}`} removeUnderline>
                    <span style={{ fontSize: "11px", color: "#2563EB", cursor: "pointer" }}>📞 Call</span>
                  </Link>
                  <span style={{ color: "#D1D5DB" }}>•</span>
                  <Link
                    url={`https://wa.me/${order.customerPhone.replace(/\D/g, "").replace(/^0/, "880")}`}
                    target="_blank"
                    removeUnderline
                  >
                    <span style={{ fontSize: "11px", color: "#16A34A", cursor: "pointer" }}>💬 WA</span>
                  </Link>
                </InlineStack>
              ) : (
                <Text variant="bodyXs" tone="subdued">No phone</Text>
              )}
              <div style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                <Text variant="bodyXs" tone="subdued" as="span">
                  {order.shippingAddress || "No address provided"}
                </Text>
              </div>
              {order.isAiCleaned && (
                <div>
                  <Badge tone="success" size="small">
                    ✅ AI Cleaned
                  </Badge>
                </div>
              )}
            </BlockStack>
          </Box>
        </IndexTable.Cell>

        {/* Column 4: Payment Status & Collectable COD */}
        <IndexTable.Cell>
          <Box minWidth="130px" maxWidth="170px">
            <BlockStack gap="100">
              <Text variant="bodySm" fontWeight="bold" as="span">
                {`${order.currencyCode} ${order.totalPrice}`}
              </Text>
              <InlineStack gap="100" wrap>
                <Badge
                  tone={order.displayFinancialStatus?.toUpperCase() === "PAID" ? "success" : "attention"}
                  size="small"
                >
                  {order.displayFinancialStatus || "UNPAID"}
                </Badge>
                {order.codAmount === 0 ? (
                  <Badge tone="success" size="small">
                    PREPAID (৳0 COD)
                  </Badge>
                ) : (
                  <Badge tone="attention" size="small">
                    {`COD: ৳${order.codAmount}`}
                  </Badge>
                )}
              </InlineStack>
            </BlockStack>
          </Box>
        </IndexTable.Cell>

        {/* Column 5: Delivery History & Fraud Risk Metrics */}
        <IndexTable.Cell>
          <Box minWidth="140px" maxWidth="180px">
            <BlockStack gap="100">
              {order.fraudStats && order.fraudStats.totalOrders > 0 ? (
                <>
                  <InlineStack gap="100" blockAlign="center">
                    <Badge tone={rateBadgeTone} size="small">
                      {`Trust: ${order.fraudStats.successRate}%`}
                    </Badge>
                  </InlineStack>
                  <InlineStack gap="100">
                    <span style={{ fontSize: "11px", color: "#16A34A", fontWeight: 600 }}>
                      ✓ {order.fraudStats.totalDelivered}
                    </span>
                    <span style={{ fontSize: "11px", color: "#9CA3AF" }}>/</span>
                    <span style={{ fontSize: "11px", color: "#DC2626", fontWeight: 600 }}>
                      ✕ {order.fraudStats.totalReturned}
                    </span>
                  </InlineStack>
                </>
              ) : (
                <Badge tone="subdued" size="small">New Customer</Badge>
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
        </IndexTable.Cell>

        {/* Column 6: Courier Selection & Tracking Consignment */}
        <IndexTable.Cell>
          <div onClick={(e) => e.stopPropagation()}>
            <Box minWidth="150px" maxWidth="190px">
              <BlockStack gap="100">
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
                  disabled={Boolean(dispatchedInfo) || isRowProcessing || isLockedBySafetyNet}
                />

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
            </Box>
          </div>
        </IndexTable.Cell>

        {/* Column 7: Warehouse Packaging Note */}
        <IndexTable.Cell>
          <div onClick={(e) => e.stopPropagation()}>
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
          <div onClick={(e) => e.stopPropagation()}>
            {isRowProcessing ? (
              <Badge tone="info" status="info">
                <InlineStack gap="100" blockAlign="center">
                  <Spinner size="small" />
                  <span>⚡ Sending...</span>
                </InlineStack>
              </Badge>
            ) : dispatchedInfo ? (
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
                variant="primary"
                size="slim"
                loading={isRowSubmitting}
                onClick={() => handleSendSingleOrder(order)}
              >
                Send to Courier
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
          body * {
            visibility: hidden;
          }
          #printable-packing-slips-zone,
          #printable-packing-slips-zone * {
            visibility: visible;
          }
          #printable-packing-slips-zone {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>

      <Page
        fullWidth
        title="Orders"
        subtitle={`Store: ${shopDomain} • Active Plan: ${
          usageSummary.currentPlan
        } (${
          usageSummary.isUnlimited
            ? `${usageSummary.monthlyOrderCount} / Unlimited`
            : `${usageSummary.monthlyOrderCount} / ${usageSummary.planLimit}`
        } monthly orders)`}
        backAction={{ content: "Dashboard", url: "/app" }}
        secondaryActions={
          bookedSlipsList.length > 0
            ? [
                {
                  content: showPackingSlipView
                    ? "Hide Documents Preview"
                    : `View Printable Documents (${bookedSlipsList.length})`,
                  onAction: () => setShowPackingSlipView((prev) => !prev),
                },
              ]
            : []
        }
      >
        <TitleBar title="Orders" />

        <Layout>
          {showBanner && actionData?.message && (
            <Layout.Section>
              <Banner
                title={
                  actionData.success
                    ? "Courier Fulfillment Completed"
                    : "Fulfillment Validation Alert"
                }
                tone={actionData.success ? "success" : "critical"}
                action={
                  actionData.limitReached
                    ? { content: "Upgrade Plan", url: "/app/pricing" }
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
                      <Button onClick={() => setShowPackingSlipView(false)}>
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
                          md: selectedSlipTemplate === "branded" ? 4 : 8,
                          lg: selectedSlipTemplate === "branded" ? 4 : 8,
                          xl: selectedSlipTemplate === "branded" ? 4 : 8,
                        }}
                      >
                        <Select
                          label="Packing Slip Template Controller"
                          options={templateSelectorOptions}
                          value={selectedSlipTemplate}
                          disabled={isFreePlan}
                          onChange={(val) =>
                            setSelectedSlipTemplate(
                              val as "standard" | "branded" | "tailored"
                            )
                          }
                          helpText={
                            isFreePlan
                              ? "Locked to Standard Layout on Free Plan."
                              : "Instantly switch printable slip layouts."
                          }
                        />
                      </Grid.Cell>
                    )}
                    {printDocumentMode === "invoices_a4" &&
                      selectedSlipTemplate === "branded" && (
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
                      {bookedSlipsList.map((slip) => {
                        if (printDocumentMode === "labels_4x6") {
                          return (
                            <div
                              key={`${slip.orderId}-4x6`}
                              style={{
                                width: "100mm",
                                height: "150mm",
                                boxSizing: "border-box",
                                border: "2px solid #000000",
                                borderRadius: "4px",
                                padding: "8mm",
                                margin: "0 auto 8mm auto",
                                background: "#ffffff",
                                color: "#000000",
                                fontFamily: "sans-serif",
                                pageBreakAfter: "always",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                              }}
                            >
                              {/* Header */}
                              <div
                                style={{
                                  borderBottom: "2px solid #000000",
                                  paddingBottom: "6px",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: "16px",
                                      fontWeight: "900",
                                      letterSpacing: "1px",
                                    }}
                                  >
                                    {slip.courierName.toUpperCase()}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "14px",
                                      fontWeight: "800",
                                    }}
                                  >
                                    {slip.orderName}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: "11px",
                                    color: "#444444",
                                    marginTop: "2px",
                                  }}
                                >
                                  Date: {slip.bookingDate} • Mode: Cash on
                                  Delivery (COD)
                                </div>
                              </div>

                              {/* Barcode & Tracking */}
                              <div
                                style={{
                                  textAlign: "center",
                                  padding: "8px 0",
                                  borderBottom: "1px solid #000000",
                                }}
                              >
                                <DynamicBarcodeGraphic
                                  code={slip.trackingNumber}
                                  height={46}
                                />
                                <div
                                  style={{
                                    fontSize: "14px",
                                    fontWeight: "800",
                                    letterSpacing: "2px",
                                    marginTop: "4px",
                                  }}
                                >
                                  {slip.trackingNumber}
                                </div>
                              </div>

                              {/* Customer Address */}
                              <div
                                style={{
                                  borderBottom: "2px solid #000000",
                                  padding: "8px 0",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "10px",
                                    fontWeight: "700",
                                    textTransform: "uppercase",
                                    color: "#555555",
                                  }}
                                >
                                  Deliver To Customer:
                                </div>
                                <div
                                  style={{
                                    fontSize: "15px",
                                    fontWeight: "800",
                                    marginTop: "2px",
                                  }}
                                >
                                  {slip.customerName}
                                </div>
                                <div
                                  style={{
                                    fontSize: "13px",
                                    fontWeight: "700",
                                    marginTop: "2px",
                                  }}
                                >
                                  📞 {slip.customerPhone}
                                </div>
                                <div
                                  style={{
                                    fontSize: "12px",
                                    marginTop: "4px",
                                    lineHeight: "1.3",
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
                                  padding: "6px 0",
                                  borderBottom: "1px solid #000000",
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: "700",
                                      textTransform: "uppercase",
                                      color: "#555555",
                                    }}
                                  >
                                    Total COD Amount
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "20px",
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
                                      fontSize: "10px",
                                      fontWeight: "700",
                                      textTransform: "uppercase",
                                      color: "#555555",
                                    }}
                                  >
                                    Items Total
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "16px",
                                      fontWeight: "800",
                                    }}
                                  >
                                    {slip.lineItems.reduce(
                                      (acc, it) => acc + (it.quantity || 1),
                                      0
                                    )}{" "}
                                    Pcs
                                  </div>
                                </div>
                              </div>

                              {/* Instructions */}
                              <div
                                style={{
                                  fontSize: "10px",
                                  color: "#444444",
                                  paddingTop: "4px",
                                }}
                              >
                                <strong>Note:</strong>{" "}
                                {slip.warehouseNote ||
                                  "Handle with care • Fragile"}
                              </div>
                            </div>
                          );
                        }
                        if (selectedSlipTemplate === "standard") {
                          return (
                            <div
                              key={slip.orderId}
                              style={{
                                border: "1px solid #000000",
                                padding: "16px",
                                background: "#ffffff",
                                color: "#000000",
                                fontFamily: "sans-serif",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  borderBottom: "1px solid #000000",
                                  paddingBottom: "8px",
                                  marginBottom: "12px",
                                }}
                              >
                                <div>
                                  <strong>STANDARD PACKING SLIP</strong> • Order{" "}
                                  <strong>{slip.orderName}</strong>
                                </div>
                                <div>
                                  Courier: <strong>{slip.courierName}</strong> |
                                  Consignment: <strong>{slip.trackingNumber}</strong>
                                </div>
                              </div>

                              <div style={{ marginBottom: "12px" }}>
                                <div>
                                  <strong>Customer:</strong> {slip.customerName} (
                                  {slip.customerPhone})
                                </div>
                                <div>
                                  <strong>Shipping Address:</strong>{" "}
                                  {slip.shippingAddress}
                                </div>
                                <div>
                                  <strong>COD Amount:</strong>{" "}
                                  {Number(slip.codAmount) === 0
                                    ? "PREPAID (৳0 COD)"
                                    : `${slip.currencyCode} ${slip.codAmount}`}
                                </div>
                              </div>

                              <table
                                style={{
                                  width: "100%",
                                  borderCollapse: "collapse",
                                  fontSize: "13px",
                                }}
                              >
                                <thead>
                                  <tr
                                    style={{
                                      borderBottom: "1px solid #000000",
                                      textAlign: "left",
                                    }}
                                  >
                                    <th style={{ padding: "4px 0" }}>Item Title</th>
                                    <th style={{ padding: "4px 0" }}>SKU</th>
                                    <th style={{ padding: "4px 0" }}>Qty</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {slip.lineItems.map((item, i) => (
                                    <tr
                                      key={`${slip.orderId}-std-${i}`}
                                      style={{ borderBottom: "1px dotted #999999" }}
                                    >
                                      <td style={{ padding: "6px 0" }}>
                                        {item.title}
                                      </td>
                                      <td style={{ padding: "6px 0" }}>
                                        {item.sku}
                                      </td>
                                      <td style={{ padding: "6px 0" }}>
                                        {item.quantity}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        }

                        if (selectedSlipTemplate === "branded") {
                          return (
                            <div
                              key={slip.orderId}
                              style={{
                                border: "2px solid #1f2937",
                                borderRadius: "8px",
                                padding: "20px",
                                background: "#ffffff",
                                color: "#111827",
                              }}
                            >
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "140px 1fr auto",
                                  gap: "16px",
                                  alignItems: "center",
                                  borderBottom: "2px solid #111827",
                                  paddingBottom: "14px",
                                  marginBottom: "16px",
                                }}
                              >
                                <div
                                  style={{
                                    border: "2px dashed #4b5563",
                                    borderRadius: "6px",
                                    height: "64px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontWeight: 700,
                                    fontSize: "12px",
                                    background: "#f9fafb",
                                    textAlign: "center",
                                  }}
                                >
                                  [STORE LOGO]
                                  <br />
                                  {shopDomain.split(".")[0].toUpperCase()}
                                </div>

                                <div>
                                  <div style={{ fontSize: "18px", fontWeight: 800 }}>
                                    {shopDomain} — BRANDED COD INVOICE
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "12px",
                                      color: "#4b5563",
                                      fontStyle: "italic",
                                      marginTop: "4px",
                                    }}
                                  >
                                    &ldquo;{customShopSlogan}&rdquo;
                                  </div>
                                </div>

                                <div>
                                  <DynamicBarcodeGraphic
                                    code={slip.trackingNumber}
                                    height={42}
                                  />
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: "16px",
                                  marginBottom: "16px",
                                  background: "#f3f4f6",
                                  padding: "12px",
                                  borderRadius: "6px",
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      textTransform: "uppercase",
                                      color: "#6b7280",
                                    }}
                                  >
                                    Deliver To Customer
                                  </div>
                                  <div style={{ fontSize: "15px", fontWeight: 700 }}>
                                    {slip.customerName} • {slip.customerPhone}
                                  </div>
                                  <div style={{ fontSize: "13px" }}>
                                    {slip.shippingAddress}
                                  </div>
                                </div>

                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: "13px", fontWeight: 700 }}>
                                    Order: {slip.orderName} | Courier:{" "}
                                    {slip.courierName}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "16px",
                                      fontWeight: 800,
                                      color:
                                        Number(slip.codAmount) === 0
                                          ? "#047857"
                                          : "#b45309",
                                      marginTop: "4px",
                                    }}
                                  >
                                    COD Collectible:{" "}
                                    {Number(slip.codAmount) === 0
                                      ? "PREPAID (৳0 COD)"
                                      : `${slip.currencyCode} ${slip.codAmount}`}
                                  </div>
                                  <div style={{ fontSize: "12px", color: "#374151" }}>
                                    Note: {slip.warehouseNote}
                                  </div>
                                </div>
                              </div>

                              <table
                                style={{
                                  width: "100%",
                                  borderCollapse: "collapse",
                                  fontSize: "13px",
                                }}
                              >
                                <thead>
                                  <tr
                                    style={{
                                      background: "#111827",
                                      color: "#ffffff",
                                      textAlign: "left",
                                    }}
                                  >
                                    <th style={{ padding: "8px" }}>
                                      Product Description
                                    </th>
                                    <th style={{ padding: "8px" }}>
                                      Variant Breakdown (Size / Color)
                                    </th>
                                    <th style={{ padding: "8px" }}>Internal SKU</th>
                                    <th style={{ padding: "8px" }}>Qty</th>
                                    <th
                                      style={{ padding: "8px", textAlign: "right" }}
                                    >
                                      Price
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {slip.lineItems.map((item, i) => (
                                    <tr
                                      key={`${slip.orderId}-brand-${i}`}
                                      style={{ borderBottom: "1px solid #e5e7eb" }}
                                    >
                                      <td style={{ padding: "8px", fontWeight: 600 }}>
                                        {item.title}
                                      </td>
                                      <td style={{ padding: "8px" }}>
                                        <span
                                          style={{
                                            background: "#dbeafe",
                                            color: "#1e40af",
                                            padding: "3px 8px",
                                            borderRadius: "4px",
                                            fontWeight: 700,
                                            fontSize: "12px",
                                          }}
                                        >
                                          {item.variantTitle}
                                        </span>
                                      </td>
                                      <td
                                        style={{
                                          padding: "8px",
                                          fontFamily: "monospace",
                                          fontWeight: 700,
                                        }}
                                      >
                                        {item.sku}
                                      </td>
                                      <td style={{ padding: "8px", fontWeight: 700 }}>
                                        {item.quantity}
                                      </td>
                                      <td
                                        style={{ padding: "8px", textAlign: "right" }}
                                      >
                                        {slip.currencyCode} {item.unitPrice}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={slip.orderId}
                            style={{
                              border: "3px solid #111827",
                              borderRadius: "6px",
                              padding: "18px",
                              background: "#ffffff",
                              color: "#111827",
                            }}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "38% 62%",
                                gap: "18px",
                              }}
                            >
                              <div
                                style={{
                                  borderRight: "2px dashed #111827",
                                  paddingRight: "16px",
                                }}
                              >
                                <div
                                  style={{
                                    background: "#111827",
                                    color: "#ffffff",
                                    padding: "6px 10px",
                                    fontWeight: 800,
                                    fontSize: "13px",
                                    marginBottom: "10px",
                                  }}
                                >
                                  COL 1 • CARRIER ROUTING &amp; BARCODE
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                  <DynamicBarcodeGraphic
                                    code={slip.trackingNumber}
                                    height={52}
                                  />
                                </div>

                                <div
                                  style={{
                                    border: "2px solid #111827",
                                    padding: "8px",
                                    marginBottom: "10px",
                                    fontWeight: 800,
                                    fontSize: "14px",
                                    textAlign: "center",
                                    background: "#f3f4f6",
                                  }}
                                >
                                  {slip.courierName.toUpperCase()} •{" "}
                                  {slip.isInsideDhaka
                                    ? "INSIDE DHAKA HUB"
                                    : "OUTSIDE DHAKA LINEHAUL"}
                                </div>

                                <div style={{ fontSize: "13px", lineHeight: 1.4 }}>
                                  <div>
                                    <strong>Order ID:</strong> {slip.orderName}
                                  </div>
                                  <div>
                                    <strong>Recipient:</strong> {slip.customerName}
                                  </div>
                                  <div>
                                    <strong>Phone:</strong> {slip.customerPhone}
                                  </div>
                                  <div>
                                    <strong>Address:</strong> {slip.shippingAddress}
                                  </div>
                                  <div
                                    style={{
                                      marginTop: "8px",
                                      fontSize: "15px",
                                      fontWeight: 800,
                                      color:
                                        Number(slip.codAmount) === 0
                                          ? "#047857"
                                          : "#111827",
                                    }}
                                  >
                                    COD TO COLLECT:{" "}
                                    {Number(slip.codAmount) === 0
                                      ? "PREPAID (৳0 COD)"
                                      : `${slip.currencyCode} ${slip.codAmount}`}
                                  </div>
                                </div>
                              </div>

                              <div>
                                <div
                                  style={{
                                    background: "#1e293b",
                                    color: "#ffffff",
                                    padding: "6px 10px",
                                    fontWeight: 800,
                                    fontSize: "13px",
                                    marginBottom: "10px",
                                  }}
                                >
                                  COL 2 • INDUSTRIAL PICK/PACK SKU &amp; VARIANT
                                  MANIFEST
                                </div>

                                <div
                                  style={{
                                    border: "2px solid #dc2626",
                                    background: "#fef2f2",
                                    color: "#991b1b",
                                    padding: "10px 12px",
                                    borderRadius: "4px",
                                    fontWeight: 800,
                                    fontSize: "14px",
                                    marginBottom: "12px",
                                  }}
                                >
                                  PACKAGING STAFF INSTRUCTION: {slip.warehouseNote}
                                </div>

                                <table
                                  style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontSize: "13px",
                                  }}
                                >
                                  <thead>
                                    <tr
                                      style={{
                                        borderBottom: "2px solid #111827",
                                        textAlign: "left",
                                      }}
                                    >
                                      <th style={{ padding: "6px" }}>
                                        Internal SKU
                                      </th>
                                      <th style={{ padding: "6px" }}>
                                        Item &amp; Variant (Size / Color)
                                      </th>
                                      <th style={{ padding: "6px" }}>Qty</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {slip.lineItems.map((item, i) => (
                                      <tr
                                        key={`${slip.orderId}-ent-${i}`}
                                        style={{
                                          borderBottom: "1px solid #d1d5db",
                                        }}
                                      >
                                        <td
                                          style={{
                                            padding: "8px 6px",
                                            fontFamily: "monospace",
                                            fontWeight: 800,
                                            fontSize: "14px",
                                          }}
                                        >
                                          {item.sku}
                                        </td>
                                        <td style={{ padding: "8px 6px" }}>
                                          <div style={{ fontWeight: 700 }}>
                                            {item.title}
                                          </div>
                                          <div
                                            style={{
                                              display: "inline-block",
                                              marginTop: "3px",
                                              background: "#fef3c7",
                                              border: "1px solid #f59e0b",
                                              padding: "2px 6px",
                                              fontWeight: 700,
                                              fontSize: "12px",
                                            }}
                                          >
                                            {item.variantTitle}
                                          </div>
                                        </td>
                                        <td
                                          style={{
                                            padding: "8px 6px",
                                            fontWeight: 800,
                                            fontSize: "16px",
                                          }}
                                        >
                                          x{item.quantity}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
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

          {/* ==================== 1. STICKY BATCH BULK ACTION HEADER ==================== */}
          {selectedResources.length > 0 && (
            <Layout.Section>
              <div
                style={{
                  position: "sticky",
                  top: "12px",
                  zIndex: 50,
                  borderRadius: "12px",
                  boxShadow:
                    "0 6px 20px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.06)",
                  border: "1px solid var(--p-color-border, #c9cccf)",
                  background: "var(--p-color-bg-surface, #ffffff)",
                  padding: "14px 20px",
                  backdropFilter: "blur(8px)",
                }}
              >
                <InlineStack align="space-between" blockAlign="center" wrap gap="300">
                  {/* Left: Counter & Clear Selection */}
                  <InlineStack gap="300" blockAlign="center">
                    <Badge
                      tone={isBatchOverPlanCap ? "critical" : "info"}
                      size="large"
                    >
                      {`${selectedResources.length} Order${
                        selectedResources.length === 1 ? "" : "s"
                      } Selected`}
                    </Badge>
                    <Button variant="plain" onClick={() => setSelectedResources([])}>
                      Deselect All
                    </Button>
                    {isBatchOverPlanCap && (
                      <Text variant="bodySm" tone="critical">
                        ⚠️ Limit exceeded (Max {usageSummary.bulkBatchLimit} per batch)
                      </Text>
                    )}
                  </InlineStack>

                  {/* Right: Print Selector Dropdown + Send Selected Button */}
                  <InlineStack gap="300" blockAlign="center" wrap>
                    {/* Secondary dropdown resource selector: Print Batch Documents */}
                    <Popover
                      active={isPrintPopoverActive}
                      activator={
                        <Button
                          disclosure
                          onClick={() => setIsPrintPopoverActive((prev) => !prev)}
                        >
                          🖨️ Print Batch Documents
                        </Button>
                      }
                      onClose={() => setIsPrintPopoverActive(false)}
                    >
                      <ActionList
                        actionRole="menuitem"
                        items={[
                          {
                            content: "🏷️ 4x6 Shipping Labels",
                            helpText: "Compact thermal barcode labels (100x150mm)",
                            onAction: () =>
                              handlePrintBatchDocuments("labels_4x6"),
                          },
                          {
                            content: "📄 A4 Invoices",
                            helpText: "Full-page itemized packing slip invoices",
                            onAction: () =>
                              handlePrintBatchDocuments("invoices_a4"),
                          },
                        ]}
                      />
                    </Popover>

                    {/* Primary Prominent Button: Send (X) Selected to Courier */}
                    <Button
                      variant="primary"
                      size="large"
                      loading={isBulkSubmitting}
                      onClick={handleBulkSendToCourier}
                      disabled={isBatchOverPlanCap}
                    >
                      {`📦 Send (${selectedResources.length}) Selected to Courier`}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </div>
            </Layout.Section>
          )}

          {/* ==================== BULK COURIER FULFILLMENT QUEUE OVERVIEW ==================== */}
          <Layout.Section>
            <Card padding="500">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
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
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Tick row checkboxes to select orders. Once selected, book parcels with one click and print thermal shipping labels or invoices.
                  </Text>
                </BlockStack>

                <InlineStack gap="200">
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
                </InlineStack>
              </InlineStack>
            </Card>
          </Layout.Section>

          {/* ==================== MULTI-SELECT ORDERS INDEXTABLE ==================== */}
          <Layout.Section>
            <Card padding="0">
              {/* 1. Exactly 11 Functional Tabs */}
              <Tabs
                tabs={tabsList}
                selected={selectedTabIndex}
                onSelect={handleTabSelect}
              />

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
                      <Button disclosure onClick={() => setIsDatePopoverActive((prev) => !prev)}>
                        {dateRangeLabel}
                      </Button>
                    }
                    onClose={() => setIsDatePopoverActive(false)}
                  >
                    <ActionList
                      actionRole="menuitem"
                      items={[
                        { content: "📅 All time", onAction: () => handleSelectDatePreset("all") },
                        { content: "Today", onAction: () => handleSelectDatePreset("today") },
                        { content: "Yesterday", onAction: () => handleSelectDatePreset("yesterday") },
                        { content: "Last 7 Days", onAction: () => handleSelectDatePreset("last7") },
                        { content: "Last 30 Days", onAction: () => handleSelectDatePreset("last30") },
                        { content: "This Month", onAction: () => handleSelectDatePreset("thisMonth") },
                      ]}
                    />
                  </Popover>
                </InlineStack>
              </Box>

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
                          handleSelectDatePreset("all");
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
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
