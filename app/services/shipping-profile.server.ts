import { CourierConfig } from "../db.server";

export interface SyncAppProfileResult {
  success: boolean;
  message: string;
  carrierServiceId?: string;
  appDeliveryProfileId?: string;
}

/**
 * Synchronizes or initializes CarrierService and Delivery Profile rate attachments.
 * - Checks existing CarrierServices before firing any mutation.
 * - Skips carrierServiceUpdate if callbackUrl and active: true already match.
 * - Passes only valid schema fields in DeliveryCarrierServiceUpdateInput (callbackUrl, active).
 * - Attaches the CarrierService to the profile's zones using DeliveryProfileUpdate.
 * - Eliminates invalid coversAllItems, GetShopLocations, and failing CreateAppDeliveryProfile calls.
 */
export async function syncAppDeliveryProfileWithShopify(
  admin: any,
  request: Request,
  shopDomain: string
): Promise<SyncAppProfileResult> {
  const appBaseUrl =
    process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const callbackUrl = `${appBaseUrl.replace(/\/$/, "")}/api/shipping-rates?shop=${encodeURIComponent(shopDomain)}`;

  try {
    // =========================================================================
    // STEP 1: RESOLVE OR REGISTER CARRIER SERVICE
    // =========================================================================
    let carrierServiceId: string | undefined;

    const GET_CARRIER_SERVICES = `#graphql
      query GetCarrierServices {
        carrierServices(first: 10) {
          edges {
            node {
              id
              name
              callbackUrl
              active
            }
          }
        }
      }
    `;

    try {
      const existingRes = await admin.graphql(GET_CARRIER_SERVICES);
      const existingJson: any = await existingRes.json();
      const edges = existingJson?.data?.carrierServices?.edges || [];
      const found = edges.find(
        ({ node }: any) =>
          node.name === "SafeParcel BD Shipping Rates" ||
          node.name === "SafeParcel BD" ||
          node.name === "BD Dynamic Courier Shipping Rates" ||
          node.name === "Delivery1" ||
          node.name === "Delivery1 Shipping Rates" ||
          node.callbackUrl === callbackUrl ||
          (node.callbackUrl && node.callbackUrl.includes("/api/shipping-rates"))
      );

      if (found?.node?.id) {
        carrierServiceId = found.node.id;

        const isCallbackMatch = found.node.callbackUrl === callbackUrl;
        const isActive = Boolean(found.node.active);

        // ONLY update if callbackUrl changed or service is inactive
        if (!isCallbackMatch || !isActive) {
          const UPDATE_CARRIER_MUTATION = `#graphql
            mutation UpdateBDCarrierService($id: ID!, $input: DeliveryCarrierServiceUpdateInput!) {
              carrierServiceUpdate(id: $id, input: $input) {
                carrierService {
                  id
                  callbackUrl
                  active
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          await admin.graphql(UPDATE_CARRIER_MUTATION, {
            variables: {
              id: carrierServiceId,
              input: {
                callbackUrl,
                active: true,
              },
            },
          });
        }
      }
    } catch (err) {
      console.warn("Notice: Querying existing CarrierServices encountered an error, falling back to create:", err);
    }

    // If not found, create new CarrierService
    if (!carrierServiceId) {
      const CREATE_CARRIER_MUTATION = `#graphql
        mutation RegisterBDCarrierService($input: DeliveryCarrierServiceCreateInput!) {
          carrierServiceCreate(input: $input) {
            carrierService {
              id
              name
              callbackUrl
              active
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const response = await admin.graphql(CREATE_CARRIER_MUTATION, {
        variables: {
          input: {
            name: "SafeParcel BD Shipping Rates",
            callbackUrl,
            supportsServiceDiscovery: true,
            active: true,
          },
        },
      });
      const result: any = await response.json();
      const userErrors = result?.data?.carrierServiceCreate?.userErrors || [];
      carrierServiceId = result?.data?.carrierServiceCreate?.carrierService?.id;

      if (!carrierServiceId && userErrors.length > 0) {
        // Retry query in case of duplicate name collision
        const fallbackRes = await admin.graphql(GET_CARRIER_SERVICES);
        const fallbackJson: any = await fallbackRes.json();
        const foundFallback = (fallbackJson?.data?.carrierServices?.edges || []).find(
          ({ node }: any) =>
            node.name === "SafeParcel BD Shipping Rates" ||
            node.name === "SafeParcel BD" ||
            node.name === "BD Dynamic Courier Shipping Rates" ||
            node.name === "Delivery1" ||
            (node.callbackUrl && node.callbackUrl.includes("/api/shipping-rates"))
        );
        if (foundFallback?.node?.id) {
          carrierServiceId = foundFallback.node.id;
        } else {
          return {
            success: false,
            message: `CarrierService Registration Error: ${userErrors[0].message}`,
          };
        }
      }
    }

    if (!carrierServiceId) {
      return {
        success: false,
        message: "Unable to establish active CarrierService ID for rate calculation.",
      };
    }

    // =========================================================================
    // STEP 2: DELIVERY PROFILE RATE ATTACHMENT (Attach Carrier to Profile Zones)
    // =========================================================================
    const storeConfig = await CourierConfig.findOne({ shopDomain })
      .select("appDeliveryProfileId carrierServiceId")
      .lean();

    let targetProfileId = storeConfig?.appDeliveryProfileId;
    let targetProfileNode: any = null;

    // Check existing delivery profiles (General or Custom profile) with valid schema fields
    const GET_PROFILES = `#graphql
      query GetAppDeliveryProfiles {
        deliveryProfiles(first: 10) {
          edges {
            node {
              id
              name
              default
              profileLocationGroups {
                locationGroup {
                  id
                }
                locationGroupZones(first: 25) {
                  edges {
                    node {
                      zone {
                        id
                        name
                      }
                      methodDefinitions(first: 25) {
                        edges {
                          node {
                            id
                            rateProvider {
                              ... on DeliveryParticipant {
                                carrierService {
                                  id
                                }
                              }
                            }
                          }
                        }
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
      const profilesRes = await admin.graphql(GET_PROFILES);
      const profilesJson: any = await profilesRes.json();
      const profileEdges = profilesJson?.data?.deliveryProfiles?.edges || [];

      // Match custom app profile or default General profile
      const matched = profileEdges.find(({ node }: any) => {
        if (targetProfileId && node.id === targetProfileId) return true;
        if (node.name === "SafeParcel BD Delivery Profile") return true;
        if (node.name === "BD Dynamic Courier Delivery Profile") return true;
        if (node.name === "Delivery1 Delivery Profile") return true;
        if (node.default === true) return true;
        return false;
      });

      if (matched?.node) {
        targetProfileNode = matched.node;
        targetProfileId = matched.node.id;
      }
    } catch (profileQueryErr) {
      console.warn("Notice: Querying existing delivery profiles notice:", profileQueryErr);
    }

    // If profile found, ensure carrier participant is attached to its zones
    if (targetProfileNode && targetProfileId) {
      let needsZoneAttachment = false;
      const locationGroupsToUpdate: any[] = [];

      for (const group of targetProfileNode.profileLocationGroups || []) {
        const locationGroupId = group.locationGroup?.id;
        const zones = group.locationGroupZones?.edges || [];
        const zonesToUpdate: any[] = [];

        for (const zoneEdge of zones) {
          const zoneNode = zoneEdge.node;
          const zoneId = zoneNode?.zone?.id;
          if (!zoneId) continue;

          const hasCarrier = (zoneNode.methodDefinitions?.edges || []).some(
            ({ node: mNode }: any) =>
              mNode?.rateProvider?.carrierService?.id === carrierServiceId
          );

          if (!hasCarrier) {
            needsZoneAttachment = true;
            zonesToUpdate.push({
              id: zoneId,
              methodDefinitionsToCreate: [
                {
                  name: "SafeParcel BD Shipping Rates",
                  active: true,
                  participant: {
                    carrierServiceId,
                    adaptToNewServicesFlag: true,
                  },
                },
              ],
            });
          }
        }

        if (zonesToUpdate.length > 0) {
          locationGroupsToUpdate.push({
            id: locationGroupId,
            zonesToUpdate,
          });
        }
      }

      if (needsZoneAttachment && locationGroupsToUpdate.length > 0) {
        const UPDATE_PROFILE_MUTATION = `#graphql
          mutation UpdateAppDeliveryProfile($id: ID!, $profile: DeliveryProfileInput!) {
            deliveryProfileUpdate(id: $id, profile: $profile) {
              profile {
                id
                name
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        await admin.graphql(UPDATE_PROFILE_MUTATION, {
          variables: {
            id: targetProfileId,
            profile: {
              locationGroupsToUpdate,
            },
          },
        });
      }
    }

    // Persist active state to MongoDB CourierConfig
    await CourierConfig.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          appDeliveryProfileId: targetProfileId || "active",
          carrierServiceId,
          shippingRatesSynced: true,
          shippingRatesLastSyncedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return {
      success: true,
      message: `SafeParcel BD Shipping Rates successfully registered and connected to Shopify Checkout!`,
      carrierServiceId,
      appDeliveryProfileId: targetProfileId,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to configure Shipping Rates: ${err?.message || "Unknown error"}`,
    };
  }
}

// Backward-compatible alias
export const syncCarrierServiceWithShopify = syncAppDeliveryProfileWithShopify;
