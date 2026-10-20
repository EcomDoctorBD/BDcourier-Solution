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
  Grid,
  Icon,
  Button,
  Form,
  FormLayout,
  TextField,
  InlineStack,
  Divider,
  Box,
  Banner,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import CourierConfig, { connectDB } from "../db.server";

/**
 * Custom Polaris-compatible SVG Icon source so <Icon /> works
 * without requiring extra icon packages.
 */
function CourierTruckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="20"
      height="20"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.5 5A1.5 1.5 0 0 1 4 3.5h7.5A1.5 1.5 0 0 1 13 5v1.5h2.086a1.5 1.5 0 0 1 1.06.44l1.914 1.914a1.5 1.5 0 0 1 .44 1.06V13.5A1.5 1.5 0 0 1 17 15h-.67a2.501 2.501 0 0 1-4.66 0H8.33a2.501 2.501 0 0 1-4.66 0H3.5A1.5 1.5 0 0 1 2 13.5V5.5A.5.5 0 0 1 2.5 5Zm10.5 3v4h3.586a.5.5 0 0 0 .414-.5V9.914a.5.5 0 0 0-.146-.353l-1.915-1.915A.5.5 0 0 0 14.586 7.5H13v.5ZM6 15.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
    </svg>
  );
}

/**
 * 1. SERVER LOADER: Fetches all expanded CourierConfig fields from MongoDB
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const storeConfig = await CourierConfig.findOne({ shopDomain }).lean();

  return {
    shopDomain,
    courierConfig: {
      shopDomain,
      // Pathao fields
      pathaoClientId: storeConfig?.pathaoClientId || "",
      pathaoSecret: storeConfig?.pathaoSecret || "",
      pathaoStoreId: storeConfig?.pathaoStoreId || "",
      // Steadfast fields
      steadfastApiKey: storeConfig?.steadfastApiKey || "",
      steadfastSecretKey: storeConfig?.steadfastSecretKey || "",
      // RedX fields
      redxProfileId: storeConfig?.redxProfileId || "",
      redxLocationId: storeConfig?.redxLocationId || "",
    },
  };
};

/**
 * 2. SERVER ACTION: Handles multi-field POST requests from Polaris <Form>
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "");

  let updateFields: Record<string, string> = {};
  let courierLabel = "";
  let isFullyConfigured = false;

  if (actionType === "savePathao") {
    const pathaoClientId = String(formData.get("pathaoClientId") || "").trim();
    const pathaoSecret = String(formData.get("pathaoSecret") || "").trim();
    const pathaoStoreId = String(formData.get("pathaoStoreId") || "").trim();

    updateFields = {
      pathaoClientId,
      pathaoSecret,
      pathaoStoreId,
    };
    courierLabel = "Pathao Courier";
    isFullyConfigured = Boolean(
      pathaoClientId && pathaoSecret && pathaoStoreId
    );
  } else if (actionType === "saveSteadfast") {
    const steadfastApiKey = String(
      formData.get("steadfastApiKey") || ""
    ).trim();
    const steadfastSecretKey = String(
      formData.get("steadfastSecretKey") || ""
    ).trim();

    updateFields = {
      steadfastApiKey,
      steadfastSecretKey,
    };
    courierLabel = "Steadfast Courier";
    isFullyConfigured = Boolean(steadfastApiKey && steadfastSecretKey);
  } else if (actionType === "saveRedX") {
    const redxProfileId = String(formData.get("redxProfileId") || "").trim();
    const redxLocationId = String(formData.get("redxLocationId") || "").trim();

    updateFields = {
      redxProfileId,
      redxLocationId,
    };
    courierLabel = "RedX Delivery";
    isFullyConfigured = Boolean(redxProfileId && redxLocationId);
  } else {
    return {
      success: false,
      actionType,
      message: "Invalid courier action type submitted.",
    };
  }

  // Upsert all submitted fields into the store's CourierConfig document in MongoDB
  await CourierConfig.findOneAndUpdate(
    { shopDomain },
    {
      $set: {
        shopDomain,
        ...updateFields,
      },
    },
    {
      returnDocument: "after",
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return {
    success: true,
    actionType,
    message: isFullyConfigured
      ? `${courierLabel} credentials saved and connected successfully.`
      : `${courierLabel} configuration updated (some fields were left blank).`,
  };
};

export default function CourierDashboard() {
  const { shopDomain, courierConfig } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  // Inline React states to toggle configuration forms under each card
  const [showPathaoForm, setShowPathaoForm] = useState(false);
  const [showSteadfastForm, setShowSteadfastForm] = useState(false);
  const [showRedxForm, setShowRedxForm] = useState(false);

  // Pathao Input States (3 fields: Client ID, Client Secret, Store ID)
  const [pathaoClientId, setPathaoClientId] = useState(
    courierConfig.pathaoClientId
  );
  const [pathaoSecret, setPathaoSecret] = useState(courierConfig.pathaoSecret);
  const [pathaoStoreId, setPathaoStoreId] = useState(
    courierConfig.pathaoStoreId
  );

  // Steadfast Input States (2 fields: API Key, Secret Key)
  const [steadfastApiKey, setSteadfastApiKey] = useState(
    courierConfig.steadfastApiKey
  );
  const [steadfastSecretKey, setSteadfastSecretKey] = useState(
    courierConfig.steadfastSecretKey
  );

  // RedX Input States (2 fields: Profile ID, Location ID)
  const [redxProfileId, setRedxProfileId] = useState(
    courierConfig.redxProfileId
  );
  const [redxLocationId, setRedxLocationId] = useState(
    courierConfig.redxLocationId
  );

  // Feedback Banner visibility state
  const [showBanner, setShowBanner] = useState(false);

  // Sync local input states whenever loader data updates from MongoDB
  useEffect(() => {
    setPathaoClientId(courierConfig.pathaoClientId);
    setPathaoSecret(courierConfig.pathaoSecret);
    setPathaoStoreId(courierConfig.pathaoStoreId);

    setSteadfastApiKey(courierConfig.steadfastApiKey);
    setSteadfastSecretKey(courierConfig.steadfastSecretKey);

    setRedxProfileId(courierConfig.redxProfileId);
    setRedxLocationId(courierConfig.redxLocationId);
  }, [
    courierConfig.pathaoClientId,
    courierConfig.pathaoSecret,
    courierConfig.pathaoStoreId,
    courierConfig.steadfastApiKey,
    courierConfig.steadfastSecretKey,
    courierConfig.redxProfileId,
    courierConfig.redxLocationId,
  ]);

  // Close the active form and display feedback banner when an action completes
  useEffect(() => {
    if (actionData?.success) {
      setShowBanner(true);
      if (actionData.actionType === "savePathao") {
        setShowPathaoForm(false);
      } else if (actionData.actionType === "saveSteadfast") {
        setShowSteadfastForm(false);
      } else if (actionData.actionType === "saveRedX") {
        setShowRedxForm(false);
      }
    }
  }, [actionData]);

  // Determine connection status: a courier is "Connected" when all of its required credentials are saved
  const isPathaoConnected = Boolean(
    courierConfig.pathaoClientId.trim() &&
      courierConfig.pathaoSecret.trim() &&
      courierConfig.pathaoStoreId.trim()
  );

  const isSteadfastConnected = Boolean(
    courierConfig.steadfastApiKey.trim() &&
      courierConfig.steadfastSecretKey.trim()
  );

  const isRedxConnected = Boolean(
    courierConfig.redxProfileId.trim() && courierConfig.redxLocationId.trim()
  );

  const activeCount = [
    isPathaoConnected,
    isSteadfastConnected,
    isRedxConnected,
  ].filter(Boolean).length;

  // Check which specific courier form is currently submitting
  const pendingActionType = navigation.formData?.get("actionType");
  const isSubmittingPathao =
    navigation.state === "submitting" && pendingActionType === "savePathao";
  const isSubmittingSteadfast =
    navigation.state === "submitting" && pendingActionType === "saveSteadfast";
  const isSubmittingRedx =
    navigation.state === "submitting" && pendingActionType === "saveRedX";

  // Submit handlers for each courier card
  const handleSavePathao = () => {
    const formData = new FormData();
    formData.append("actionType", "savePathao");
    formData.append("pathaoClientId", pathaoClientId);
    formData.append("pathaoSecret", pathaoSecret);
    formData.append("pathaoStoreId", pathaoStoreId);
    submit(formData, { method: "post" });
  };

  const handleSaveSteadfast = () => {
    const formData = new FormData();
    formData.append("actionType", "saveSteadfast");
    formData.append("steadfastApiKey", steadfastApiKey);
    formData.append("steadfastSecretKey", steadfastSecretKey);
    submit(formData, { method: "post" });
  };

  const handleSaveRedX = () => {
    const formData = new FormData();
    formData.append("actionType", "saveRedX");
    formData.append("redxProfileId", redxProfileId);
    formData.append("redxLocationId", redxLocationId);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Bangladesh Courier Automation"
      subtitle={`Connected Store: ${shopDomain}`}
    >
      <TitleBar title="Courier Dashboard" />

      <Layout>
        {/* Feedback Banner after saving credentials */}
        {showBanner && actionData?.message && (
          <Layout.Section>
            <Banner
              title={actionData.message}
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => setShowBanner(false)}
            />
          </Layout.Section>
        )}

        {/* Top Overview Banner Card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Box>
                    <Icon
                      source={CourierTruckIcon}
                      tone={activeCount > 0 ? "success" : "subdued"}
                    />
                  </Box>
                  <Text as="h2" variant="headingMd">
                    Delivery Partner Connection Overview
                  </Text>
                </InlineStack>

                <Badge
                  tone={activeCount > 0 ? "success" : undefined}
                  progress={activeCount > 0 ? "complete" : "incomplete"}
                >
                  {`${activeCount} of 3 Couriers Connected`}
                </Badge>
              </InlineStack>

              <Text as="p" variant="bodyMd" tone="subdued">
                Configure your official Bangladeshi courier API credentials
                below. All credentials are securely stored in MongoDB and
                used to authenticate order dispatches.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 3-Column Courier Integration Cards Grid */}
        <Layout.Section>
          <Grid>
            {/* ==================== 1. PATHAO COURIER CARD ==================== */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Box>
                        <Icon
                          source={CourierTruckIcon}
                          tone={isPathaoConnected ? "success" : "subdued"}
                        />
                      </Box>
                      <Text as="h3" variant="headingMd">
                        Pathao Courier
                      </Text>
                    </InlineStack>

                    <Badge
                      tone={isPathaoConnected ? "success" : undefined}
                      progress={
                        isPathaoConnected ? "complete" : "incomplete"
                      }
                    >
                      {isPathaoConnected ? "Connected" : "Not Configured"}
                    </Badge>
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Automated parcel booking, city & nationwide express
                      delivery, and live consignment tracking with Pathao
                      Merchant API.
                    </Text>

                    <Text as="p" variant="bodySm" tone="subdued">
                      Required Keys:{" "}
                      <strong>Client ID, Client Secret, Store ID</strong>
                    </Text>

                    <Text as="p" variant="bodySm">
                      {isPathaoConnected
                        ? "All 3 Pathao credentials are saved in MongoDB and active."
                        : "Please configure Client ID, Client Secret, and Store ID."}
                    </Text>
                  </BlockStack>

                  <InlineStack align="end">
                    <Button
                      variant={
                        showPathaoForm
                          ? "tertiary"
                          : isPathaoConnected
                          ? "secondary"
                          : "primary"
                      }
                      onClick={() => setShowPathaoForm((prev) => !prev)}
                    >
                      {showPathaoForm
                        ? "Cancel"
                        : isPathaoConnected
                        ? "Update Pathao Courier"
                        : "Configure Pathao Courier"}
                    </Button>
                  </InlineStack>

                  {/* Expandable Polaris Form for Pathao (3 TextFields) */}
                  {showPathaoForm && (
                    <>
                      <Divider />
                      <Form onSubmit={handleSavePathao}>
                        <FormLayout>
                          <TextField
                            label="Client ID"
                            value={pathaoClientId}
                            onChange={(val) => setPathaoClientId(val)}
                            placeholder="Enter Pathao Client ID..."
                            autoComplete="off"
                          />
                          <TextField
                            label="Client Secret"
                            value={pathaoSecret}
                            onChange={(val) => setPathaoSecret(val)}
                            placeholder="Enter Pathao Client Secret..."
                            autoComplete="off"
                          />
                          <TextField
                            label="Store ID"
                            value={pathaoStoreId}
                            onChange={(val) => setPathaoStoreId(val)}
                            placeholder="Enter Pathao Store ID..."
                            helpText="Found in your Pathao Merchant Developer Portal."
                            autoComplete="off"
                          />
                          <InlineStack align="end">
                            <Button
                              submit
                              variant="primary"
                              loading={isSubmittingPathao}
                            >
                              Save Credentials
                            </Button>
                          </InlineStack>
                        </FormLayout>
                      </Form>
                    </>
                  )}
                </BlockStack>
              </Card>
            </Grid.Cell>

            {/* ==================== 2. STEADFAST COURIER CARD ==================== */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Box>
                        <Icon
                          source={CourierTruckIcon}
                          tone={isSteadfastConnected ? "success" : "subdued"}
                        />
                      </Box>
                      <Text as="h3" variant="headingMd">
                        Steadfast Courier
                      </Text>
                    </InlineStack>

                    <Badge
                      tone={isSteadfastConnected ? "success" : undefined}
                      progress={
                        isSteadfastConnected ? "complete" : "incomplete"
                      }
                    >
                      {isSteadfastConnected ? "Connected" : "Not Configured"}
                    </Badge>
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Fast Cash-on-Delivery (COD) fulfillment, bulk parcel
                      creation, and automated consignment tracking across
                      Bangladesh.
                    </Text>

                    <Text as="p" variant="bodySm" tone="subdued">
                      Required Keys: <strong>API Key, Secret Key</strong>
                    </Text>

                    <Text as="p" variant="bodySm">
                      {isSteadfastConnected
                        ? "Both Steadfast credentials are saved in MongoDB and active."
                        : "Please configure both API Key and Secret Key."}
                    </Text>
                  </BlockStack>

                  <InlineStack align="end">
                    <Button
                      variant={
                        showSteadfastForm
                          ? "tertiary"
                          : isSteadfastConnected
                          ? "secondary"
                          : "primary"
                      }
                      onClick={() => setShowSteadfastForm((prev) => !prev)}
                    >
                      {showSteadfastForm
                        ? "Cancel"
                        : isSteadfastConnected
                        ? "Update Steadfast Courier"
                        : "Configure Steadfast Courier"}
                    </Button>
                  </InlineStack>

                    {/* Expandable Polaris Form for Steadfast (2 TextFields) */}
                  {showSteadfastForm && (
                    <>
                      <Divider />
                      <Form onSubmit={handleSaveSteadfast}>
                        <FormLayout>
                          <TextField
                            label="API Key"
                            value={steadfastApiKey}
                            onChange={(val) => setSteadfastApiKey(val)}
                            placeholder="Enter Steadfast API Key..."
                            autoComplete="off"
                          />
                          <TextField
                            label="Secret Key"
                            value={steadfastSecretKey}
                            onChange={(val) => setSteadfastSecretKey(val)}
                            placeholder="Enter Steadfast Secret Key..."
                            helpText="Found in your Steadfast Courier Merchant API Settings."
                            autoComplete="off"
                          />
                          <InlineStack align="end">
                            <Button
                              submit
                              variant="primary"
                              loading={isSubmittingSteadfast}
                            >
                              Save Credentials
                            </Button>
                          </InlineStack>
                        </FormLayout>
                      </Form>
                    </>
                  )}
                </BlockStack>
              </Card>
            </Grid.Cell>

            {/* ==================== 3. REDX DELIVERY CARD ==================== */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Box>
                        <Icon
                          source={CourierTruckIcon}
                          tone={isRedxConnected ? "success" : "subdued"}
                        />
                      </Box>
                      <Text as="h3" variant="headingMd">
                        RedX Delivery
                      </Text>
                    </InlineStack>

                    <Badge
                      tone={isRedxConnected ? "success" : undefined}
                      progress={isRedxConnected ? "complete" : "incomplete"}
                    >
                      {isRedxConnected ? "Connected" : "Not Configured"}
                    </Badge>
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      64-district doorstep delivery network with automated
                      pickup scheduling and shipping label generation.
                    </Text>

                    <Text as="p" variant="bodySm" tone="subdued">
                      Required Keys: <strong>Profile ID, Location ID</strong>
                    </Text>

                    <Text as="p" variant="bodySm">
                      {isRedxConnected
                        ? "Both RedX credentials are saved in MongoDB and active."
                        : "Please configure both Profile ID and Location ID."}
                    </Text>
                  </BlockStack>

                  <InlineStack align="end">
                    <Button
                      variant={
                        showRedxForm
                          ? "tertiary"
                          : isRedxConnected
                          ? "secondary"
                          : "primary"
                      }
                      onClick={() => setShowRedxForm((prev) => !prev)}
                    >
                      {showRedxForm
                        ? "Cancel"
                        : isRedxConnected
                        ? "Update RedX Delivery"
                        : "Configure RedX Delivery"}
                    </Button>
                  </InlineStack>

                  {/* Expandable Polaris Form for RedX (2 TextFields) */}
                  {showRedxForm && (
                    <>
                      <Divider />
                      <Form onSubmit={handleSaveRedX}>
                        <FormLayout>
                          <TextField
                            label="Profile ID"
                            value={redxProfileId}
                            onChange={(val) => setRedxProfileId(val)}
                            placeholder="Enter RedX Profile ID / Access Token..."
                            autoComplete="off"
                          />
                          <TextField
                            label="Location ID"
                            value={redxLocationId}
                            onChange={(val) => setRedxLocationId(val)}
                            placeholder="Enter RedX Pickup Location ID..."
                            helpText="Found in your RedX Open API Portal."
                            autoComplete="off"
                          />
                          <InlineStack align="end">
                            <Button
                              submit
                              variant="primary"
                              loading={isSubmittingRedx}
                            >
                              Save Credentials
                            </Button>
                          </InlineStack>
                        </FormLayout>
                      </Form>
                    </>
                  )}
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
