import { unauthenticated } from "../shopify.server";
import { connectDB, ShipmentBooking } from "../db.server";

/**
 * Generates the public customer tracking URL for Pathao, Steadfast, and RedX
 */
export function getCourierTrackingUrl(
  courier?: string | null,
  trackingNumber?: string | null,
  phone?: string | null
): string {
  const trk = String(trackingNumber || "").trim();
  if (!trk) return "";

  const key = String(courier || "").toLowerCase().trim();
  if (key.includes("pathao")) {
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    return `https://pathao.com/courier/tracking/?consignment_id=${encodeURIComponent(
      trk
    )}&phone=${encodeURIComponent(cleanPhone)}`;
  }
  if (key.includes("steadfast")) {
    return `https://steadfast.com.bd/t/${encodeURIComponent(trk)}`;
  }
  if (key.includes("redx")) {
    return `https://redx.com.bd/track/${encodeURIComponent(trk)}`;
  }
  return "";
}

/**
 * Formats any Shopify Order ID (numeric or GID) into a standardized Shopify GraphQL Order GID
 */
export function formatOrderGid(orderId: string): string {
  const trimmed = String(orderId || "").trim();
  if (trimmed.startsWith("gid://shopify/Order/")) {
    return trimmed;
  }
  const numericId = trimmed.replace(/\D/g, "");
  return `gid://shopify/Order/${numericId}`;
}

/**
 * Non-blocking helper to add tags to a Shopify Order via Admin GraphQL API
 */
export async function addShopifyOrderTags(
  admin: any,
  orderId: string,
  tags: string[]
): Promise<boolean> {
  try {
    if (!admin || !orderId || !Array.isArray(tags) || tags.length === 0) {
      return false;
    }

    const orderGid = formatOrderGid(orderId);
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

    const response = await admin.graphql(TAGS_ADD_MUTATION, {
      variables: {
        id: orderGid,
        tags,
      },
    });

    const data: any = await response.json();
    if (data?.errors && data.errors.length > 0) {
      console.warn("tagsAdd GraphQL user errors:", data.errors);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(`Failed to add Shopify tags ${JSON.stringify(tags)} to ${orderId}:`, err?.message);
    return false;
  }
}

/**
 * Automatically mutates Shopify Order to Paid & Fulfilled via Admin GraphQL API
 * Attaches courier tracking number, carrier name, and public tracking URL.
 */
export async function syncOrderPaidAndFulfilledInShopify(
  admin: any,
  orderId: string,
  trackingNumber: string,
  courierName: string,
  trackingUrl?: string
): Promise<boolean> {
  try {
    if (!admin || !orderId) return false;
    const orderGid = formatOrderGid(orderId);

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
      variables: { input: { id: orderGid } },
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
    const foRes = await admin.graphql(FO_QUERY, { variables: { id: orderGid } });
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
  } catch (err: any) {
    console.warn(`syncOrderPaidAndFulfilledInShopify error on ${orderId}:`, err?.message);
    return false;
  }
}

/**
 * Webhook/Polling delivery handler:
 * Resolves Shopify Admin client for the store, marks order Paid & Fulfilled,
 * attaches tracking info, adds delivery tag, and updates MongoDB ShipmentBooking.
 */
export async function syncDeliveredBookingToShopify(booking: {
  _id?: any;
  shopDomain: string;
  orderId: string;
  orderName?: string;
  courierKey?: string;
  courierName?: string;
  trackingNumber: string;
  trackingUrl?: string;
  customerPhone?: string;
  shopifySyncedPaidFulfilled?: boolean;
}): Promise<boolean> {
  if (booking.shopifySyncedPaidFulfilled) {
    return true;
  }

  const { shopDomain, orderId, trackingNumber, courierKey, courierName, customerPhone } = booking;
  if (!shopDomain || !orderId) return false;

  await connectDB();

  const trkUrl =
    booking.trackingUrl ||
    getCourierTrackingUrl(courierKey || courierName, trackingNumber, customerPhone);

  const courierLower = (courierKey || courierName || "").toLowerCase();
  const partnerName = courierLower.includes("pathao")
    ? "Pathao"
    : courierLower.includes("steadfast")
    ? "Steadfast"
    : courierLower.includes("redx")
    ? "RedX"
    : courierName || "Courier";

  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    if (!admin) {
      console.warn(`[Shopify Sync] No offline admin session found for shop: ${shopDomain}`);
      return false;
    }

    const orderGid = formatOrderGid(orderId);

    // 1. Mark paid & fulfill
    const synced = await syncOrderPaidAndFulfilledInShopify(
      admin,
      orderGid,
      trackingNumber,
      courierName || partnerName,
      trkUrl
    );

    // 2. Add delivered tags non-blockingly
    await addShopifyOrderTags(admin, orderGid, [`${partnerName} Delivered`]);

    // 3. Mark synchronized in MongoDB ShipmentBooking
    const filter = booking._id ? { _id: booking._id } : { shopDomain, orderId };
    await ShipmentBooking.updateOne(filter, {
      $set: {
        shopifySyncedPaidFulfilled: true,
        courierStatus: "delivered",
        trackingUrl: trkUrl,
        updatedAt: new Date(),
      },
    });

    return synced;
  } catch (err: any) {
    console.warn(`[Shopify Sync] Error syncing delivered order ${orderId} (${shopDomain}):`, err?.message);
    return false;
  }
}
