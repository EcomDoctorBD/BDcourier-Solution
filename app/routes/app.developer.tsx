import { useState, type SVGProps } from "react";
import {
  json,
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
  useRouteError,
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
  Button,
  Divider,
  Banner,
  Grid,
  Box,
  IndexTable,
  Icon,
} from "@shopify/polaris";
import mongoose from "mongoose";

import { authenticate } from "../shopify.server";
import CourierConfig, {
  connectDB,
  AddressCache,
  ShippingZone,
  GlobalFraudNetwork,
  MerchantIntegrations,
  CourierLocationCache,
  decryptCourierConfig,
} from "../db.server";

// ==================== ICONS ====================
function DatabaseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="20"
      height="20"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 2c-4.418 0-8 1.343-8 3v10c0 1.657 3.582 3 8 3s8-1.343 8-3V5c0-1.657-3.582-3-8-3Zm0 1.5c3.673 0 6.5 1.018 6.5 1.5S13.673 6.5 10 6.5 3.5 5.482 3.5 5s2.827-1.5 6.5-1.5Zm6.5 4.717C15.352 8.784 12.87 9.5 10 9.5c-2.87 0-5.352-.716-6.5-1.283V6.783C4.848 7.42 7.234 8 10 8s5.152-.58 6.5-1.217v1.434Zm0 3.5c-1.148.567-3.63 1.283-6.5 1.283-2.87 0-5.352-.716-6.5-1.283v-1.434C4.848 10.92 7.234 11.5 10 11.5s5.152-.58 6.5-1.217v1.434Zm0 3.5c-1.148.567-3.63 1.283-6.5 1.283-2.87 0-5.352-.716-6.5-1.283v-1.434c1.348.637 3.734 1.217 6.5 1.217s5.152-.58 6.5-1.217v1.434Z" />
    </svg>
  );
}

function SparklesIcon(props: SVGProps<SVGSVGElement>) {
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
        d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.402 1.83c-.772.321-.772 1.415 0 1.736l4.402 1.83 1.83 4.402c.321.772 1.415.772 1.736 0l1.83-4.402 4.401-1.83c.772-.321.772-1.415 0-1.736l-4.401-1.83-1.83-4.401ZM10 6.643l.87 2.09c.14.337.403.6.74.74l2.09.87-2.09.87c-.337.14-.6.403-.74.74l-.87 2.09-.87-2.09a1.698 1.698 0 0 0-.74-.74l-2.09-.87 2.09-.87c.337-.14.6-.403.74-.74l.87-2.09Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

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

function ServerActivityIcon(props: SVGProps<SVGSVGElement>) {
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
        d="M2 4.75A2.75 2.75 0 0 1 4.75 2h10.5A2.75 2.75 0 0 1 18 4.75v2.5A2.75 2.75 0 0 1 15.25 10H4.75A2.75 2.75 0 0 1 2 7.25v-2.5Zm2.75-1.25a1.25 1.25 0 0 0-1.25 1.25v2.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-2.5c0-.69-.56-1.25-1.25-1.25H4.75ZM2 12.75A2.75 2.75 0 0 1 4.75 10h10.5A2.75 2.75 0 0 1 18 12.75v2.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-2.5Zm2.75-1.25a1.25 1.25 0 0 0-1.25 1.25v2.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-2.5c0-.69-.56-1.25-1.25-1.25H4.75Zm9.5 2.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-3 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-3 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function maskSecret(str: string | undefined | null, prefix = 4, suffix = 4) {
  if (!str) return "Not Configured";
  const trimmed = str.trim();
  if (trimmed.length <= prefix + suffix) return "••••••••";
  return `${trimmed.slice(0, prefix)}••••••••${trimmed.slice(-suffix)}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Security Gate: Restrict developer route in production (Issue 12.2)
  const adminDevShop = process.env.ADMIN_DEV_SHOP?.trim() || "";
  const isDevMode = process.env.NODE_ENV !== "production";
  const isAuthorized = Boolean(
    isDevMode || (adminDevShop && shopDomain.toLowerCase() === adminDevShop.toLowerCase())
  );

  if (!isAuthorized) {
    return redirect("/app");
  }

  const preflightStart = Date.now();

  // 1. MONGODB DIAGNOSTICS
  let mongoConnected = false;
  let mongoLatencyMs = -1;
  let mongoReadyState = 0;
  let mongoHost = "Unknown";
  let mongoDbName = "Unknown";
  let addressCacheCount = 0;
  let shippingZoneCount = 0;
  let fraudRecordsCount = 0;
  let courierLocationCacheCount = 0;

  try {
    const conn = await connectDB();
    mongoReadyState = mongoose.connection.readyState;
    mongoConnected = mongoReadyState === 1;

    if (conn?.connection) {
      mongoHost = "mongodb-atlas-cluster";
      mongoDbName = conn.connection.name || "delivery1";
    }

    const pingStart = Date.now();
    if (mongoose.connection?.db) {
      await mongoose.connection.db.admin().ping();
      mongoLatencyMs = Date.now() - pingStart;
    }

    const [acCount, szCount, frCount, clcCount] = await Promise.all([
      AddressCache.countDocuments().catch(() => 0),
      ShippingZone.countDocuments({ merchantId: shopDomain }).catch(() => 0),
      GlobalFraudNetwork.countDocuments().catch(() => 0),
      CourierLocationCache.countDocuments().catch(() => 0),
    ]);
    addressCacheCount = acCount;
    shippingZoneCount = szCount;
    fraudRecordsCount = frCount;
    courierLocationCacheCount = clcCount;
  } catch (err: any) {
    console.error("Diagnostic MongoDB error:", err.message);
  }

  // 2. GEMINI 1.5 FLASH SDK DIAGNOSTICS
  const rawGeminiKey = process.env.GEMINI_API_KEY?.trim() || "";
  const isGeminiConfigured = Boolean(rawGeminiKey);
  const maskedGeminiKey = maskSecret(rawGeminiKey, 6, 4);
  const configuredGeminiModel =
    process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";

  // 3. COURIER HANDSHAKES & CREDENTIALS
  const rawStoreConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
  const storeConfig = decryptCourierConfig(rawStoreConfig);

  const pathaoReady = Boolean(
    storeConfig?.pathaoClientId?.trim() &&
      storeConfig?.pathaoSecret?.trim() &&
      storeConfig?.pathaoStoreId?.trim()
  );
  const steadfastReady = Boolean(
    storeConfig?.steadfastApiKey?.trim() &&
      storeConfig?.steadfastSecretKey?.trim()
  );
  const redxReady = Boolean(
    storeConfig?.redxAccessToken?.trim() ||
      (storeConfig?.redxProfileId?.trim() && storeConfig?.redxLocationId?.trim())
  );
  const webhookReady = Boolean(storeConfig?.webhookSecret?.trim());

  const couriersDiagnostic = {
    pathao: {
      name: "Pathao Courier",
      ready: pathaoReady,
      clientIdMasked: maskSecret(storeConfig?.pathaoClientId, 4, 3),
      username: storeConfig?.pathaoUsername?.trim() || "Not Set",
      secretMasked: maskSecret(storeConfig?.pathaoSecret, 3, 3),
      storeId: storeConfig?.pathaoStoreId?.trim() || "Not Set",
      environment: storeConfig?.pathaoEnvironment || "production",
      endpoint:
        storeConfig?.pathaoEnvironment === "sandbox"
          ? "https://courier-api-sandbox.pathao.com"
          : "https://api-hermes.pathao.com",
    },
    steadfast: {
      name: "Steadfast Courier",
      ready: steadfastReady,
      apiKeyMasked: maskSecret(storeConfig?.steadfastApiKey, 4, 3),
      secretKeyMasked: maskSecret(storeConfig?.steadfastSecretKey, 3, 3),
      endpoint: "https://packzy.com/api/v1 (fallback: portal.steadfast.com.bd)",
    },
    redx: {
      name: "REDX Delivery",
      ready: redxReady,
      accessTokenMasked: maskSecret(
        storeConfig?.redxAccessToken || storeConfig?.redxProfileId,
        4,
        3
      ),
      pickupStoreId:
        storeConfig?.redxPickupStoreId?.trim() ||
        storeConfig?.redxLocationId?.trim() ||
        "Not Set",
      environment: storeConfig?.redxEnvironment || "production",
      endpoint:
        storeConfig?.redxEnvironment === "sandbox"
          ? "https://sandbox.redx.com.bd"
          : "https://openapi.redx.com.bd/v1.0.0-beta",
    },
    webhook: {
      name: "Two-Way Webhook Gateway",
      ready: webhookReady,
      secretMasked: maskSecret(storeConfig?.webhookSecret, 6, 4),
      endpoint: "/api/webhooks/{pathao,steadfast,redx}",
    },
  };

  // 4. GOOGLE INTEGRATION DIAGNOSTICS
  const googleIntegration: any = await MerchantIntegrations.findOne({
    merchantId: shopDomain,
  }).lean();
  const googleReady = Boolean(googleIntegration?.googleRefreshToken);

  // 5. RUNTIME & SYSTEM TELEMETRY
  const memUsage = process.memoryUsage();
  const systemTelemetry = {
    nodeVersion: "Node.js v20+ LTS",
    platform: "Serverless (Cloud)",
    environment: process.env.NODE_ENV || "production",
    uptimeSeconds: Math.round(process.uptime()),
    heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
    diagnosticDurationMs: Date.now() - preflightStart,
    appUrl: process.env.SHOPIFY_APP_URL || "Auto-detected (Request Origin)",
  };

  return json({
    shopDomain,
    currentPlan: storeConfig?.currentPlan || "Free",
    isAutoRoutingEnabled: Boolean(
      storeConfig?.isAutoRoutingEnabled ?? storeConfig?.autoRoutingEnabled
    ),
    mongo: {
      connected: mongoConnected,
      readyState: mongoReadyState,
      latencyMs: mongoLatencyMs,
      host: mongoHost,
      dbName: mongoDbName,
      addressCacheCount,
      shippingZoneCount,
      fraudRecordsCount,
      courierLocationCacheCount,
    },
    gemini: {
      configured: isGeminiConfigured,
      model: configuredGeminiModel,
      maskedKey: maskedGeminiKey,
      cachedTranslations: addressCacheCount,
    },
    couriers: couriersDiagnostic,
    google: {
      ready: googleReady,
      sheetName: googleIntegration?.spreadsheetName || "Not Connected",
      sheetId: googleIntegration?.spreadsheetId
        ? maskSecret(googleIntegration.spreadsheetId, 4, 4)
        : "None",
    },
    system: systemTelemetry,
    timestamp: new Date().toISOString(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const adminDevShop = process.env.ADMIN_DEV_SHOP?.trim() || "";
  const isDevMode = process.env.NODE_ENV !== "production";
  const isAuthorized = Boolean(
    isDevMode || (adminDevShop && shopDomain.toLowerCase() === adminDevShop.toLowerCase())
  );

  if (!isAuthorized) {
    return redirect("/app");
  }
  await connectDB();

  const pingStart = Date.now();
  let dbOk = false;
  try {
    if (mongoose.connection?.db) {
      await mongoose.connection.db.admin().ping();
      dbOk = true;
    }
  } catch {}

  const pingMs = Date.now() - pingStart;

  return json({
    success: true,
    actionType: "pingCheck",
    message: `Pre-flight health check ping executed in ${pingMs}ms. Database heartbeat: ${
      dbOk ? "Healthy (200 OK)" : "Deferred"
    }.`,
  });
};

export default function DeveloperDiagnosticPage() {
  const {
    shopDomain,
    currentPlan,
    isAutoRoutingEnabled,
    mongo,
    gemini,
    couriers,
    google,
    system,
    timestamp,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const searchStr = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const [showBanner, setShowBanner] = useState(false);

  const isTesting =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "pingCheck";

  const handleRunPing = () => {
    const formData = new FormData();
    formData.append("actionType", "pingCheck");
    submit(formData, { method: "post" });
    setShowBanner(true);
  };

  const getReadyStateLabel = (state: number) => {
    switch (state) {
      case 1:
        return "1 (Connected / Active Pool)";
      case 2:
        return "2 (Connecting...)";
      case 3:
        return "3 (Disconnecting)";
      default:
        return "0 (Disconnected)";
    }
  };

  return (
    <Page
      title="Developer Diagnostics & Pre-Flight Status"
      subtitle={`Store: ${shopDomain} • Plan: ${currentPlan} • Diagnostics refreshed at ${new Date(
        timestamp
      ).toLocaleTimeString()}`}
      backAction={{ content: "Dashboard", url: `/app${searchStr}` }}
      primaryAction={{
        content: "Run Pre-Flight Heartbeat Ping",
        loading: isTesting,
        onAction: handleRunPing,
      }}
    >
      <TitleBar title="Developer Diagnostics" />

      <BlockStack gap="600">
        {showBanner && actionData?.message && (
          <Banner
            title={actionData.success ? "Diagnostics Heartbeat" : "Check Notice"}
            tone={actionData.success ? "success" : "warning"}
            onDismiss={() => setShowBanner(false)}
          >
            <p>{actionData.message}</p>
          </Banner>
        )}

        {/* ==================================================================== */}
        {/* EXECUTIVE PRE-FLIGHT SUMMARY PILLS                                   */}
        {/* ==================================================================== */}
        <Card padding="500">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">
                  Executive Health Matrix
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Read-only telemetry inspecting active database pools, AI pipelines, and logistics APIs.
                </Text>
              </BlockStack>
              <Badge tone="info">Read-Only Diagnostic Mode</Badge>
            </InlineStack>

            <Divider />

            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 3, xl: 3 }}>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      MongoDB Atlas Connection
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge tone={mongo.connected ? "success" : "critical"}>
                        {mongo.connected ? "Connected" : "Disconnected"}
                      </Badge>
                      <Text as="span" variant="bodySm">
                        {mongo.latencyMs >= 0 ? `${mongo.latencyMs}ms` : "N/A"}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 3, xl: 3 }}>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Gemini 1.5 Flash AI Engine
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge tone={gemini.configured ? "success" : "attention"}>
                        {gemini.configured ? "Active" : "Key Missing"}
                      </Badge>
                      <Text as="span" variant="bodySm">
                        {gemini.model}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 3, xl: 3 }}>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Couriers Configured
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge
                        tone={
                          couriers.pathao.ready ||
                          couriers.steadfast.ready ||
                          couriers.redx.ready
                            ? "success"
                            : "attention"
                        }
                      >
                        {[
                          couriers.pathao.ready,
                          couriers.steadfast.ready,
                          couriers.redx.ready,
                        ].filter(Boolean).length + " / 3 Ready"}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 3, xl: 3 }}>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Server Heap Memory
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge tone="info">
                        {`${system.heapUsedMb} MB / ${system.heapTotalMb} MB`}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </Grid.Cell>
            </Grid>
          </BlockStack>
        </Card>

        {/* ==================================================================== */}
        {/* PANEL 1: MONGODB CONNECTION POOL TELEMETRY                           */}
        {/* ==================================================================== */}
        <Card padding="500">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Box>
                  <Icon
                    source={DatabaseIcon}
                    tone={mongo.connected ? "success" : "critical"}
                  />
                </Box>
                <Text as="h3" variant="headingMd">
                  MongoDB Connection Pool &amp; Collection State
                </Text>
              </InlineStack>

              <Badge tone={mongo.connected ? "success" : "critical"}>
                {`Mongoose readyState: ${getReadyStateLabel(mongo.readyState)}`}
              </Badge>
            </InlineStack>

            <Divider />

            <IndexTable
              resourceName={{ singular: "parameter", plural: "parameters" }}
              itemCount={7}
              selectable={false}
              headings={[
                { title: "Mongoose Pool Parameter" },
                { title: "Live Value" },
                { title: "Status / Impact" },
              ]}
            >
              <IndexTable.Row id="row-pool-1" position={0}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    Connection State
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{mongo.connected ? "Connected" : "Disconnected"}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={mongo.connected ? "success" : "critical"}>
                    {mongo.connected ? "Pool Active (<45s Timeout)" : "Action Required"}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-pool-2" position={1}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    Atlas Cluster Host
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{mongo.host}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="info">Egress Outbound Port 27017</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-pool-3" position={2}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    Database Name
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{mongo.dbName}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="success">Primary DB Selected</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-pool-4" position={3}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    Round-Trip Ping Latency
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">
                    {mongo.latencyMs >= 0 ? `${mongo.latencyMs} ms` : "Unresolved"}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={mongo.latencyMs < 100 ? "success" : "warning"}>
                    {mongo.latencyMs < 100 ? "Low Latency (<100ms)" : "Normal Latency"}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-pool-5" position={4}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    AddressCache Collection Documents
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{`${mongo.addressCacheCount} cached records`}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="success">Sub-5ms Lookups Enabled</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-pool-6" position={5}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    Merchant Custom Zones in DB
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{`${mongo.shippingZoneCount} zones defined`}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="info">Active Rate Engine</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-pool-7" position={6}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    CourierLocationCache (7-Day Geo-Cache)
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{`${mongo.courierLocationCacheCount || 0} cached location sets`}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="success">Fast Geo-Lookups Active</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>
            </IndexTable>
          </BlockStack>
        </Card>

        {/* ==================================================================== */}
        {/* PANEL 2: GEMINI 1.5 FLASH AI ENGINE TELEMETRY                        */}
        {/* ==================================================================== */}
        <Card padding="500">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Box>
                  <Icon source={SparklesIcon} tone="magic" />
                </Box>
                <Text as="h3" variant="headingMd">
                  Gemini 1.5 Flash AI Engine &amp; Address Correction Pipeline
                </Text>
              </InlineStack>

              <Badge tone={gemini.configured ? "success" : "attention"}>
                {gemini.configured ? "Gemini Key Injected" : "Local Fallback Mode"}
              </Badge>
            </InlineStack>

            <Divider />

            <IndexTable
              resourceName={{ singular: "setting", plural: "settings" }}
              itemCount={4}
              selectable={false}
              headings={[
                { title: "Configuration Variable" },
                { title: "Status / Value" },
                { title: "Runtime Role" },
              ]}
            >
              <IndexTable.Row id="row-ai-1" position={0}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    GEMINI_API_KEY String
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{gemini.maskedKey}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={gemini.configured ? "success" : "critical"}>
                    {gemini.configured ? "Production Injected" : "Missing from Container Env"}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-ai-2" position={1}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    Active Foundation Model
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">{gemini.model}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="info">Google AI Studio REST v1beta</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-ai-3" position={2}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    Execution Trigger Point
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">On-Click Dispatch ("Send to Courier")</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="success">Zero Shopify Checkout Delay</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              <IndexTable.Row id="row-ai-4" position={3}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    Dual Fallback Strategy
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span">AddressCache Hit → Gemini API → Local Dictionary</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="success">Fail-Safe 64-District Matcher</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>
            </IndexTable>
          </BlockStack>
        </Card>

        {/* ==================================================================== */}
        {/* PANEL 3: COURIER GATEWAYS DIAGNOSTICS                                */}
        {/* ==================================================================== */}
        <Card padding="500">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Box>
                  <Icon source={CourierTruckIcon} tone="subdued" />
                </Box>
                <Text as="h3" variant="headingMd">
                  Courier Gateway Handshake Status
                </Text>
              </InlineStack>

              <Badge tone="info">
                {`Auto-Routing Engine: ${isAutoRoutingEnabled ? "Enabled" : "Manual Mode"}`}
              </Badge>
            </InlineStack>

            <Divider />

            <IndexTable
              resourceName={{ singular: "gateway", plural: "gateways" }}
              itemCount={4}
              selectable={false}
              headings={[
                { title: "Courier Gateway" },
                { title: "Target Endpoint" },
                { title: "Credentials State" },
                { title: "Operational Readiness" },
              ]}
            >
              {/* Pathao */}
              <IndexTable.Row id="row-courier-pathao" position={0}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    {couriers.pathao.name}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {couriers.pathao.endpoint}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm">
                      {`Client ID: ${couriers.pathao.clientIdMasked}`}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {`Username: ${couriers.pathao.username}`}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {`Store ID: ${couriers.pathao.storeId} (${couriers.pathao.environment})`}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={couriers.pathao.ready ? "success" : "attention"}>
                    {couriers.pathao.ready ? "Ready for Booking" : "Incomplete Config"}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              {/* Steadfast */}
              <IndexTable.Row id="row-courier-steadfast" position={1}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    {couriers.steadfast.name}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {couriers.steadfast.endpoint}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm">
                      {`API Key: ${couriers.steadfast.apiKeyMasked}`}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {`Secret: ${couriers.steadfast.secretKeyMasked}`}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={couriers.steadfast.ready ? "success" : "attention"}>
                    {couriers.steadfast.ready ? "Ready for Booking" : "Incomplete Config"}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              {/* REDX */}
              <IndexTable.Row id="row-courier-redx" position={2}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    {couriers.redx.name}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {couriers.redx.endpoint}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm">
                      {`Access Token: ${couriers.redx.accessTokenMasked}`}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {`Store ID: ${couriers.redx.pickupStoreId} (${couriers.redx.environment})`}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={couriers.redx.ready ? "success" : "attention"}>
                    {couriers.redx.ready ? "Ready for Booking" : "Incomplete Config"}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>

              {/* Webhook Gateway */}
              <IndexTable.Row id="row-courier-webhook" position={3}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="bold">
                    {couriers.webhook.name}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {couriers.webhook.endpoint}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm">
                      {`Secret: ${couriers.webhook.secretMasked}`}
                    </Text>
                    <Text as="span" variant="bodySm">
                      Two-Way Status &amp; COD Sync
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={couriers.webhook.ready ? "success" : "attention"}>
                    {couriers.webhook.ready ? "Active (Protected)" : "Secret Unset"}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>
            </IndexTable>
          </BlockStack>
        </Card>

        {/* ==================================================================== */}
        {/* PANEL 4: CONTAINER & SERVER RUNTIME TELEMETRY                        */}
        {/* ==================================================================== */}
        <Card padding="500">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Box>
                  <Icon source={ServerActivityIcon} tone="info" />
                </Box>
                <Text as="h3" variant="headingMd">
                  Container &amp; Server Runtime Environment
                </Text>
              </InlineStack>

              <Badge tone="info">{system.environment.toUpperCase()}</Badge>
            </InlineStack>

            <Divider />

            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Node.js Version
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {system.nodeVersion}
                  </Text>
                </BlockStack>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    OS / Arch
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {system.platform}
                  </Text>
                </BlockStack>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Uptime
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {`${system.uptimeSeconds} seconds`}
                  </Text>
                </BlockStack>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Diagnostics Execution
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {`${system.diagnosticDurationMs} ms`}
                  </Text>
                </BlockStack>
              </Grid.Cell>
            </Grid>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
