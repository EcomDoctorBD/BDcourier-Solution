import { useState, useEffect, type SVGProps } from "react";
import {
  json,
  type HeadersFunction,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
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
  InlineStack,
  Button,
  TextField,
  Checkbox,
  Divider,
  Banner,
  Grid,
  Box,
  Modal,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { connectDB, getSystemConfig } from "../db.server";
import {
  getMerchantIntegration,
  updateSpreadsheetSettings,
  disconnectGoogleAccount,
  syncOrderToGoogleSheet,
  getGoogleAuthUrl,
} from "../google-sheets.server";

export const GOOGLE_SHEETS_COLUMNS = [
  "Order ID",
  "Timestamp",
  "Customer Name",
  "Phone Number",
  "Raw Shopify Address",
  "Cleaned District",
  "Cleaned Thana",
  "Courier Partner Assigned",
  "Official Courier Tracking ID",
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const [rawGoogleIntegration, systemConfig]: any[] = await Promise.all([
    getMerchantIntegration(shopDomain),
    getSystemConfig(),
  ]);

  // Strip raw access/refresh tokens to prevent sensitive credential exposure in HTML/client-state
  const googleIntegration = rawGoogleIntegration
    ? {
        merchantId: rawGoogleIntegration.merchantId,
        isConnected: Boolean(rawGoogleIntegration.googleRefreshToken),
        googleUserEmail: rawGoogleIntegration.googleUserEmail || "",
        googleUserName: rawGoogleIntegration.googleUserName || "",
        spreadsheetId: rawGoogleIntegration.spreadsheetId || "",
        spreadsheetName: rawGoogleIntegration.spreadsheetName || "Delivery1 Orders",
        sheetName: rawGoogleIntegration.sheetName || "Orders",
        spreadsheetUrl: rawGoogleIntegration.spreadsheetUrl || "",
        autoSyncEnabled: rawGoogleIntegration.autoSyncEnabled ?? true,
        lastSyncAt: rawGoogleIntegration.lastSyncAt || null,
        lastSyncStatus: rawGoogleIntegration.lastSyncStatus || "IDLE",
        lastSyncError: rawGoogleIntegration.lastSyncError || "",
        totalOrdersSynced: rawGoogleIntegration.totalOrdersSynced || 0,
      }
    : null;

  const googleAuthUrl = getGoogleAuthUrl(shopDomain);

  return json({
    shopDomain,
    googleIntegration,
    googleAuthUrl,
    supportEmail: String(systemConfig?.supportEmail || "ecomdoctorbd@gmail.com"),
    whatsappHelpline: String(systemConfig?.whatsappHelpline || "01346851322"),
    whatsappNumber: String(systemConfig?.whatsappNumber || "+8801346851322"),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "");

  if (actionType === "saveGoogleSettings") {
    const spreadsheetId = String(formData.get("spreadsheetId") || "").trim();
    const sheetName = String(formData.get("sheetName") || "Orders").trim();
    const autoSyncEnabled = String(formData.get("autoSyncEnabled")) === "true";

    await updateSpreadsheetSettings(shopDomain, {
      spreadsheetId,
      sheetName,
      autoSyncEnabled,
    });

    return json({
      success: true,
      actionType: "saveGoogleSettings",
      message: "Google Sheets integration preferences saved successfully.",
    });
  }

  if (actionType === "disconnectGoogle") {
    await disconnectGoogleAccount(shopDomain);
    return json({
      success: true,
      actionType: "disconnectGoogle",
      message: "Google Account disconnected from Delivery1.",
    });
  }

  if (actionType === "testGoogleSync") {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const testResult = await syncOrderToGoogleSheet(shopDomain, {
      orderId: `#TEST-${randomSuffix}`,
      timestamp: new Date(),
      customerName: "Mohammad Rahman (Test Order)",
      phoneNumber: "01712345678",
      rawAddress: "House 14, Road 5, Block C, Banani, Dhaka-1213",
      cleanedDistrict: "Dhaka",
      cleanedThana: "Banani",
      courierPartner: "Pathao Courier",
      courierTrackingId: `TRK-TEST-${randomSuffix}`,
    });

    if (testResult.success) {
      return json({
        success: true,
        actionType: "testGoogleSync",
        message: "Test order row appended to your Google Sheet successfully!",
      });
    } else {
      return json({
        success: false,
        actionType: "testGoogleSync",
        message: `Test order sync failed: ${testResult.error}`,
      });
    }
  }

  return json({
    success: false,
    actionType: "",
    message: "Unknown action submitted.",
  });
};

export default function IntegrationsPage() {
  const {
    shopDomain,
    googleIntegration,
    googleAuthUrl,
    supportEmail,
    whatsappHelpline,
    whatsappNumber,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const digitsOnly = (whatsappNumber || whatsappHelpline).replace(/[^0-9]/g, "");
  const normalizedWhatsAppDigits = digitsOnly.startsWith("0")
    ? `88${digitsOnly}`
    : digitsOnly;

  const [googleSpreadsheetId, setGoogleSpreadsheetId] = useState<string>(
    googleIntegration?.spreadsheetId || ""
  );
  const [googleSheetName, setGoogleSheetName] = useState<string>(
    googleIntegration?.sheetName || "Orders"
  );
  const [googleAutoSyncEnabled, setGoogleAutoSyncEnabled] = useState<boolean>(
    googleIntegration?.autoSyncEnabled ?? true
  );

  const [showBanner, setShowBanner] = useState(false);
  const [oauthBanner, setOauthBanner] = useState<string | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const isGoogleConnected = Boolean(googleIntegration?.isConnected);
  const googleSpreadsheetUrl =
    googleIntegration?.spreadsheetUrl ||
    (googleSpreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${googleSpreadsheetId}`
      : "");

  useEffect(() => {
    if (googleIntegration) {
      setGoogleSpreadsheetId(googleIntegration.spreadsheetId || "");
      setGoogleSheetName(googleIntegration.sheetName || "Orders");
      setGoogleAutoSyncEnabled(googleIntegration.autoSyncEnabled ?? true);
    }
  }, [googleIntegration]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("google") === "connected") {
        setOauthBanner(
          "Google Account connected successfully! Real-time auto-sync is ready."
        );
      }
    }
  }, []);

  useEffect(() => {
    if (actionData?.message) {
      setShowBanner(true);
    }
  }, [actionData]);

  const isSavingSettings =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "saveGoogleSettings";
  const isDisconnecting =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "disconnectGoogle";
  const isTestingSync =
    navigation.state === "submitting" &&
    navigation.formData?.get("actionType") === "testGoogleSync";

  const handleConnectGoogle = () => {
    setIsWizardOpen(true);
  };

  const handleLaunchOAuthPopup = () => {
    if (typeof window !== "undefined") {
      const authUrl = googleAuthUrl || `/api/google/auth?shop=${encodeURIComponent(shopDomain)}`;
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      const popup = window.open(
        authUrl,
        "GoogleOAuthWindow",
        `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=no`
      );
      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        const topTarget = window.top || window;
        topTarget.location.href = authUrl;
      }
    }
  };

  const handleDisconnectGoogle = () => {
    if (
      confirm(
        "Are you sure you want to disconnect Google Sheets? Real-time order sync will be paused."
      )
    ) {
      const formData = new FormData();
      formData.append("actionType", "disconnectGoogle");
      submit(formData, { method: "post" });
    }
  };

  const handleSaveSettings = () => {
    const formData = new FormData();
    formData.append("actionType", "saveGoogleSettings");
    formData.append("spreadsheetId", googleSpreadsheetId.trim());
    formData.append("sheetName", googleSheetName.trim() || "Orders");
    formData.append("autoSyncEnabled", String(googleAutoSyncEnabled));
    submit(formData, { method: "post" });
  };

  const handleTestSync = () => {
    const formData = new FormData();
    formData.append("actionType", "testGoogleSync");
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Integrations"
      subtitle="Connect third-party productivity and automated spreadsheet tools."
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <TitleBar title="Integrations" />

      <BlockStack gap="400">
        {oauthBanner && (
          <Banner
            title="Google Sheets Connected"
            tone="success"
            onDismiss={() => setOauthBanner(null)}
          >
            <p>{oauthBanner}</p>
          </Banner>
        )}

        {showBanner && actionData?.message && (
          <Banner
            title={
              actionData.success ? "Settings Saved" : "Action Incomplete"
            }
            tone={actionData.success ? "success" : "critical"}
            onDismiss={() => setShowBanner(false)}
          >
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card padding="500">
              <BlockStack gap="500">
                {/* Header & Logo */}
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <InlineStack gap="400" blockAlign="center">
                    <GoogleSheetsIcon glowing={isGoogleConnected} />
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="headingMd" as="h2">
                          Google Sheets Auto-Sync
                        </Text>
                        {isGoogleConnected ? (
                          <Badge tone="success">● Connected &amp; Syncing</Badge>
                        ) : (
                          <Badge tone="neutral">Disconnected</Badge>
                        )}
                      </InlineStack>
                      <Text variant="bodyMd" tone="subdued">
                        Automatically export your orders to a Google Sheet in real time.
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  {!isGoogleConnected ? (
                    <Button
                      variant="primary"
                      size="large"
                      onClick={handleConnectGoogle}
                    >
                      Connect Google Account
                    </Button>
                  ) : (
                    <InlineStack gap="200">
                      {googleSpreadsheetUrl && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            window.open(googleSpreadsheetUrl, "_blank")
                          }
                        >
                          Open Google Sheet ↗
                        </Button>
                      )}
                      <Button
                        tone="critical"
                        variant="plain"
                        loading={isDisconnecting}
                        onClick={handleDisconnectGoogle}
                      >
                        Disconnect
                      </Button>
                    </InlineStack>
                  )}
                </InlineStack>

                <Divider />

                {!isGoogleConnected ? (
                  <BlockStack gap="400">
                    <Banner
                      title="Real-Time Order Logistics Export"
                      tone="info"
                    >
                      <p>
                        Connect your Google Account to automatically stream every new Shopify order
                        and booked courier parcel directly into your spreadsheet without manual data entry.
                      </p>
                    </Banner>

                    <Card background="bg-surface-secondary">
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3">
                          Standard Exported Columns (9 Logistics Attributes):
                        </Text>
                        <InlineStack gap="200" wrap>
                          {GOOGLE_SHEETS_COLUMNS.map((col) => (
                            <Badge key={col} tone="info">
                              {col}
                            </Badge>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                ) : (
                  <BlockStack gap="400">
                    {/* Account Overview Cards */}
                    <Grid>
                      <Grid.Cell
                        columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}
                      >
                        <Card background="bg-surface-secondary">
                          <BlockStack gap="100">
                            <Text variant="bodySm" tone="subdued">
                              Connected Google Account
                            </Text>
                            <Text variant="bodyMd" fontWeight="semibold">
                              {googleIntegration?.googleUserEmail ||
                                "Google Account Linked"}
                            </Text>
                            {googleIntegration?.googleUserName && (
                              <Text variant="bodyXs" tone="subdued">
                                {googleIntegration.googleUserName}
                              </Text>
                            )}
                          </BlockStack>
                        </Card>
                      </Grid.Cell>

                      <Grid.Cell
                        columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}
                      >
                        <Card background="bg-surface-secondary">
                          <BlockStack gap="100">
                            <Text variant="bodySm" tone="subdued">
                              Active Connected Sheet
                            </Text>
                            <Text variant="bodyMd" fontWeight="semibold">
                              {googleIntegration?.spreadsheetName ||
                                "Delivery1 Orders"}
                            </Text>
                            <Text variant="bodyXs" tone="subdued">
                              Tab: {googleSheetName} • Total Synced:{" "}
                              {googleIntegration?.totalOrdersSynced || 0}
                            </Text>
                          </BlockStack>
                        </Card>
                      </Grid.Cell>
                    </Grid>

                    {/* Spreadsheet Settings Form */}
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3">
                        Spreadsheet Settings
                      </Text>
                      <TextField
                        label="Google Spreadsheet ID"
                        value={googleSpreadsheetId}
                        onChange={setGoogleSpreadsheetId}
                        autoComplete="off"
                        helpText="Found in your sheet URL: https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit"
                      />
                      <TextField
                        label="Target Sheet (Tab) Name"
                        value={googleSheetName}
                        onChange={setGoogleSheetName}
                        autoComplete="off"
                        helpText="Default is 'Orders'. If the tab does not exist, Delivery1 will auto-create it."
                      />
                      <Checkbox
                        label="Enable Real-Time Auto-Sync on Order Dispatch"
                        checked={googleAutoSyncEnabled}
                        onChange={setGoogleAutoSyncEnabled}
                        helpText="Whenever an order is sent to Pathao or Steadfast, append it instantly as a new row."
                      />
                    </BlockStack>

                    {/* Actions and Telemetry */}
                    <InlineStack
                      align="space-between"
                      blockAlign="center"
                      wrap
                    >
                      <InlineStack gap="300" blockAlign="center">
                        <Button
                          variant="primary"
                          loading={isSavingSettings}
                          onClick={handleSaveSettings}
                        >
                          Save Sheet Settings
                        </Button>
                        <Button
                          loading={isTestingSync}
                          onClick={handleTestSync}
                        >
                          Sync Test Order
                        </Button>
                      </InlineStack>

                      {googleIntegration?.lastSyncAt && (
                        <Text variant="bodyXs" tone="subdued">
                          Last Synced:{" "}
                          {new Date(
                            googleIntegration.lastSyncAt
                          ).toLocaleString("en-GB", {
                            timeZone: "Asia/Dhaka",
                          })}
                        </Text>
                      )}
                    </InlineStack>

                    {googleIntegration?.lastSyncError && (
                      <Banner tone="critical" title="Recent Sync Notice">
                        <p>{googleIntegration.lastSyncError}</p>
                      </Banner>
                    )}

                    <Divider />

                    <BlockStack gap="200">
                      <Text variant="headingXs" as="h4">
                        Exported Columns Reference:
                      </Text>
                      <InlineStack gap="150" wrap>
                        {GOOGLE_SHEETS_COLUMNS.map((col) => (
                          <Badge key={col}>{col}</Badge>
                        ))}
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Dynamic Technical Assistance & Helpline Card */}
          <Layout.Section>
            <Card padding="500">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="050">
                  <Text variant="headingSm" as="h4">
                    Need Custom Spreadsheet or API Assistance?
                  </Text>
                </BlockStack>
                <InlineStack gap="200" blockAlign="center">
                  <Button
                    url={`mailto:${supportEmail}?subject=Delivery1%20Integration%20Assistance%20-${encodeURIComponent(shopDomain)}`}
                  >
                    Contact Email Support
                  </Button>
                  <Button
                    variant="primary"
                    url={`https://api.whatsapp.com/send?phone=${normalizedWhatsAppDigits}&text=${encodeURIComponent(`Hello Delivery1 Support! I need technical assistance with Google Sheets Integrations for ${shopDomain}.`)}`}
                    target="_blank"
                  >
                    WhatsApp Helpline
                  </Button>
                </InlineStack>
              </InlineStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Google Sheets OAuth Pop-up Setup Wizard Modal */}
      <Modal
        open={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        title="Google Sheets Auto-Sync Setup Wizard"
        size="large"
        primaryAction={{
          content: "Connect with Google Account →",
          onAction: handleLaunchOAuthPopup,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setIsWizardOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Box
              padding="400"
              background="bg-surface-secondary"
              borderRadius="300"
            >
              <InlineStack gap="300" blockAlign="center">
                <GoogleSheetsIcon glowing />
                <BlockStack gap="050">
                  <Text variant="headingMd" as="h3">
                    Connect Your Spreadsheet in 3 Simple Steps
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Delivery1 securely connects via Google OAuth 2.0 to stream booked courier parcels in real time.
                  </Text>
                </BlockStack>
              </InlineStack>
            </Box>

            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Box
                  padding="400"
                  background="bg-surface"
                  borderRadius="200"
                  borderColor="border-subdued"
                  borderWidth="025"
                >
                  <BlockStack gap="200">
                    <Badge tone="info">Step 1</Badge>
                    <Text variant="headingSm" as="h4">
                      1. Authorize Google
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Click the button below to open Google&apos;s secure OAuth window and select your Google account.
                    </Text>
                  </BlockStack>
                </Box>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Box
                  padding="400"
                  background="bg-surface"
                  borderRadius="200"
                  borderColor="border-subdued"
                  borderWidth="025"
                >
                  <BlockStack gap="200">
                    <Badge tone="info">Step 2</Badge>
                    <Text variant="headingSm" as="h4">
                      2. Paste Spreadsheet ID
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Paste your Google Sheet URL or ID. We will automatically initialize the 9 courier export columns.
                    </Text>
                  </BlockStack>
                </Box>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Box
                  padding="400"
                  background="bg-surface"
                  borderRadius="200"
                  borderColor="border-subdued"
                  borderWidth="025"
                >
                  <BlockStack gap="200">
                    <Badge tone="info">Step 3</Badge>
                    <Text variant="headingSm" as="h4">
                      3. Real-Time Auto-Sync
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Every time you book an order with Pathao, Steadfast, or REDX, it automatically appends to your sheet.
                    </Text>
                  </BlockStack>
                </Box>
              </Grid.Cell>
            </Grid>

            <Banner tone="info">
              <p>
                <strong>Zero Password Storage:</strong> Delivery1 uses official Google OAuth refresh tokens. You can disconnect or revoke access at any time.
              </p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function GoogleSheetsIcon({
  glowing = false,
  ...props
}: SVGProps<SVGSVGElement> & { glowing?: boolean }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "12px",
        boxShadow: glowing
          ? "0 0 16px rgba(15, 157, 88, 0.45)"
          : undefined,
        transition: "box-shadow 0.3s ease",
      }}
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <rect width="44" height="44" rx="10" fill="#0F9D58" />
        <path
          d="M28 13H16C14.3431 13 13 14.3431 13 16V28C13 29.6569 14.3431 31 16 31H28C29.6569 31 31 29.6569 31 28V16C31 14.3431 29.6569 13 28 13Z"
          fill="white"
        />
        <path
          d="M16 17H28V19.5H16V17ZM16 20.75H28V23.25H16V20.75ZM16 24.5H28V27H16V24.5Z"
          fill="#0F9D58"
        />
      </svg>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
