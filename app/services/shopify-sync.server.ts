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
  if (key.includes("carrybee")) {
    return `https://carrybee.com/track/${encodeURIComponent(trk)}`;
  }
  if (key.includes("bahok")) {
    return `https://bahok.com.bd/track/${encodeURIComponent(trk)}`;
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
    const foRes = await admin.graphql(FO_QUERY, { variables: { id: orderGid } });
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
  const { shopDomain, orderId, trackingNumber, courierKey, courierName, customerPhone } = booking;
  if (!shopDomain || !orderId || !trackingNumber || !trackingNumber.trim()) {
    console.warn(`[Shopify Sync] Rejected sync for ${orderId}: missing shopDomain or trackingNumber`);
    return false;
  }

  await connectDB();

  // 1. Atomic idempotency claim: verify booking is not already synced
  const filter = booking._id
    ? { _id: booking._id, shopDomain }
    : { shopDomain, orderId };

  const currentBooking = await ShipmentBooking.findOne(filter);
  if (!currentBooking) {
    return false;
  }

  if (currentBooking.shopifySyncedPaidFulfilled) {
    return true; // Already synced successfully
  }

  const trkUrl =
    booking.trackingUrl ||
    currentBooking.trackingUrl ||
    getCourierTrackingUrl(
      courierKey || courierName || currentBooking.courierKey,
      trackingNumber,
      customerPhone || currentBooking.customerPhone
    );

  const courierLower = (
    courierKey ||
    courierName ||
    currentBooking.courierKey ||
    currentBooking.courierName ||
    ""
  ).toLowerCase();
  const partnerName = courierLower.includes("pathao")
    ? "Pathao"
    : courierLower.includes("steadfast")
    ? "Steadfast"
    : courierLower.includes("redx")
    ? "RedX"
    : courierName || currentBooking.courierName || "Courier";

  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    if (!admin) {
      console.warn(`[Shopify Sync] No offline admin session found for shop: ${shopDomain}`);
      return false;
    }

    const orderGid = formatOrderGid(orderId);

    // 2. Mark order Paid & Fulfill in Shopify Admin GraphQL
    const synced = await syncOrderPaidAndFulfilledInShopify(
      admin,
      orderGid,
      trackingNumber,
      courierName || partnerName,
      trkUrl
    );

    // 3. Add delivered tags non-blockingly
    await addShopifyOrderTags(admin, orderGid, [`${partnerName} Delivered`]);

    // 4. ONLY AFTER the GraphQL operations succeed, persist shopifySyncedPaidFulfilled: true
    if (synced) {
      await ShipmentBooking.updateOne(filter, {
        $set: {
          shopifySyncedPaidFulfilled: true,
          shopifySyncedAt: new Date(),
          courierStatus: "delivered",
          deliveryStatus: "delivered",
          trackingUrl: trkUrl,
          updatedAt: new Date(),
        },
      });
    }

    return synced;
  } catch (err: any) {
    console.warn(`[Shopify Sync] Error syncing delivered order ${orderId} (${shopDomain}):`, err?.message);
    return false;
  }
}
