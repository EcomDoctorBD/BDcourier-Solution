import {
  json,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import {
  useLoaderData,
  useSearchParams,
  Link,
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
  Box,
  Banner,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import CourierConfig, { connectDB, getSystemConfig } from "../db.server";

function WhatsAppIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67ZM8.94 7.39C8.73 7.39 8.53 7.4 8.36 7.43C8.16 7.46 7.91 7.53 7.7 7.76C7.49 7.99 6.89 8.55 6.89 9.71C6.89 10.87 7.73 11.99 7.85 12.15C7.97 12.31 9.48 14.64 11.83 15.65C12.39 15.89 12.82 16.03 13.16 16.14C13.72 16.32 14.23 16.29 14.63 16.23C15.08 16.16 16.01 15.66 16.2 15.12C16.39 14.58 16.39 14.12 16.33 14.02C16.27 13.92 16.12 13.86 15.89 13.75C15.66 13.64 14.54 13.08 14.33 13.01C14.12 12.94 13.97 12.9 13.82 13.13C13.67 13.36 13.24 13.86 13.11 14.02C12.98 14.17 12.85 14.19 12.62 14.08C12.39 13.97 11.65 13.73 10.77 12.94C10.09 12.33 9.63 11.58 9.5 11.35C9.37 11.12 9.49 10.99 9.6 10.88C9.7 10.78 9.83 10.61 9.95 10.47C10.07 10.33 10.11 10.22 10.19 10.07C10.27 9.92 10.23 9.79 10.17 9.68C10.11 9.57 9.66 8.46 9.47 8.01C9.28 7.57 9.1 7.63 8.94 7.39Z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
      <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
    </svg>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  await connectDB();

  const [storeConfig, systemConfig]: any[] = await Promise.all([
    CourierConfig.findOne({ shopDomain }).lean(),
    getSystemConfig(),
  ]);

  const currentPlan = String(storeConfig?.currentPlan || "Free");
  const supportEmail = String(systemConfig?.supportEmail || "ecomdoctorbd@gmail.com");
  const whatsappHelpline = String(systemConfig?.whatsappHelpline || "01346851322");
  const whatsappNumber = String(systemConfig?.whatsappNumber || "+8801346851322");
  const tutorialLink = String(systemConfig?.tutorialLink || "");

  return json({
    shopDomain,
    currentPlan,
    supportEmail,
    whatsappHelpline,
    whatsappNumber,
    tutorialLink,
  });
};

export default function HelpAndSupportRoute() {
  const {
    shopDomain,
    currentPlan,
    supportEmail,
    whatsappHelpline,
    whatsappNumber,
    tutorialLink,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const searchStr = searchParams.toString() ? `?${searchParams.toString()}` : "";

  const normalizedPlan = currentPlan.trim().toLowerCase();
  const isUnlimitedTier =
    normalizedPlan.includes("unlimited") ||
    normalizedPlan.includes("enterprise") ||
    normalizedPlan.includes("advanced") ||
    normalizedPlan.includes("pro");

  const digitsOnly = (whatsappNumber || whatsappHelpline).replace(/[^0-9]/g, "");
  const normalizedWhatsAppDigits = digitsOnly.startsWith("0")
    ? `88${digitsOnly}`
    : digitsOnly;

  const mailtoSubject = encodeURIComponent(
    `Delivery1 Support Request - ${shopDomain}`
  );
  const mailtoBody = encodeURIComponent(
    `Hello Delivery1 Support Team,\n\nStore: ${shopDomain}\nActive Plan: ${currentPlan}\n\nPlease describe your question or issue below:\n`
  );
  const mailtoUrl = `mailto:${supportEmail}?subject=${mailtoSubject}&body=${mailtoBody}`;

  const whatsappMessage = encodeURIComponent(
    `Hello Delivery1 Priority Support! I am contacting from store: ${shopDomain} (Active Plan: ${currentPlan}). I need assistance with...`
  );
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${normalizedWhatsAppDigits}&text=${whatsappMessage}`;

  return (
    <Page
      title="Help & Support"
      subtitle={`Store: ${shopDomain} • Active Plan: ${currentPlan}`}
      backAction={{ content: "Dashboard", url: `/app${searchStr}` }}
    >
      <TitleBar title="Help & Support" />

      <BlockStack gap="500">
        <Layout>
          {/* Support Tier Overview */}
          <Layout.Section>
            <Card padding="500">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        SUPPORT TIER LEVEL
                      </Text>
                      <Badge tone={isUnlimitedTier ? "success" : "info"}>
                        {isUnlimitedTier
                          ? "Priority Helpline Active"
                          : `${currentPlan} Plan`}
                      </Badge>
                    </InlineStack>

                    <Text as="h1" variant="headingLg" fontWeight="bold">
                      {isUnlimitedTier
                        ? "Priority WhatsApp & Executive Helpline"
                        : "Email Support Desk"}
                    </Text>
                  </BlockStack>

                  <InlineStack gap="200">
                    <Badge tone={isUnlimitedTier ? "success" : "info"}>
                      {isUnlimitedTier
                        ? `${currentPlan} (Unlimited Tier)`
                        : `${currentPlan} Tier`}
                    </Badge>
                  </InlineStack>
                </InlineStack>

                <Divider />

                <Text as="p" variant="bodyMd" tone="subdued">
                  Our dedicated engineering and logistics team is here to assist
                  you with courier credentials, automated routing rules, dynamic
                  shipping rates, and real-time spreadsheet integrations.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Dynamic Setup Tutorial Video Card */}
          {tutorialLink ? (
            <Layout.Section>
              <Card background="bg-surface-secondary" padding="400">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="050">
                    <InlineStack gap="150" blockAlign="center">
                      <Text as="h3" variant="headingSm" fontWeight="bold">
                        📺 Video Documentation & Setup Guide
                      </Text>
                      <Badge tone="info">Official Guide</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Watch our step-by-step masterclass on configuring courier APIs, auto-routing rules, and dynamic shipping rates.
                    </Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    size="large"
                    url={tutorialLink}
                    target="_blank"
                  >
                    📺 Watch Setup Tutorial
                  </Button>
                </InlineStack>
              </Card>
            </Layout.Section>
          ) : null}

          {/* Contact Channel Section */}
          <Layout.Section>
            {isUnlimitedTier ? (
              /* ==================== ACTIVE UNLIMITED / PRIORITY TIER ==================== */
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack gap="300" blockAlign="center">
                    <Box
                      background="bg-surface-success"
                      padding="200"
                      borderRadius="200"
                    >
                      <WhatsAppIcon />
                    </Box>
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">
                        Priority WhatsApp Helpline Active
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Your tier includes direct access to our 24/7 dedicated
                        technical engineers via WhatsApp.
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <Banner tone="success">
                    <p>
                      <strong>VIP Priority Support:</strong> Average response
                      time is under 15 minutes. Our team can assist with live
                      order tracking holds, courier API keys, and custom billing
                      setups.
                    </p>
                  </Banner>

                  <Box paddingBlockStart="200" paddingBlockEnd="200">
                    <InlineStack align="center">
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "10px",
                          backgroundColor: "#25D366",
                          color: "#ffffff",
                          fontWeight: "700",
                          fontSize: "16px",
                          padding: "14px 28px",
                          borderRadius: "10px",
                          textDecoration: "none",
                          boxShadow: "0 4px 12px rgba(37, 211, 102, 0.35)",
                          transition: "background-color 0.2s ease",
                        }}
                      >
                        <WhatsAppIcon />
                        <span>Chat via Priority WhatsApp Helpline</span>
                      </a>
                    </InlineStack>
                  </Box>

                  <Divider />

                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <Text as="span" variant="bodyXs" tone="subdued">
                      Direct WhatsApp Number: {whatsappNumber}
                    </Text>
                    <Text as="span" variant="bodyXs" tone="subdued">
                      Or email: {supportEmail}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            ) : (
              /* ==================== FREE / BASIC TIER ==================== */
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack gap="300" blockAlign="center">
                    <Box
                      background="bg-surface-secondary"
                      padding="200"
                      borderRadius="200"
                    >
                      <EmailIcon />
                    </Box>
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">
                        Contact Support Team
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Need help with courier setup or order fulfillment? Send
                        our support desk an email.
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  {/* Elegant Mailto Block */}
                  <Box
                    padding="400"
                    background="bg-surface-secondary"
                    borderRadius="300"
                  >
                    <BlockStack gap="300">
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        wrap
                      >
                        <BlockStack gap="050">
                          <Text as="h3" variant="headingSm">
                            Official Email Support Desk
                          </Text>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {supportEmail}
                          </Text>
                        </BlockStack>

                        <Button
                          variant="primary"
                          size="large"
                          url={mailtoUrl}
                        >
                          Contact Email Support
                        </Button>
                      </InlineStack>

                      <Divider />

                      <Text as="p" variant="bodyXs" tone="subdued">
                        Standard Response Time: Within 24 business hours
                      </Text>
                    </BlockStack>
                  </Box>

                  <Divider />

                  {/* Upgrade Callout for Priority WhatsApp */}
                  <Banner tone="info">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "16px",
                        width: "100%",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: "1 1 300px" }}>
                        <Text as="p" variant="bodySm">
                          <strong>Want 24/7 instant WhatsApp Helpline access?</strong>{" "}
                          Upgrade to our Unlimited / Pro plans for dedicated priority
                          logistics support.
                        </Text>
                      </div>
                      <div
                        style={{
                          marginLeft: "auto",
                          display: "flex",
                          alignItems: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Link
                          to={`/app/pricing${searchStr}`}
                          style={{ textDecoration: "none" }}
                        >
                          <button
                            type="button"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: "#202223",
                              color: "#FFFFFF",
                              border: "1px solid #202223",
                              borderRadius: "8px",
                              padding: "7px 16px",
                              fontSize: "13px",
                              fontWeight: 600,
                              cursor: "pointer",
                              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
                              transition: "all 0.15s ease-in-out",
                              whiteSpace: "nowrap",
                              lineHeight: "1.4",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = "#303030";
                              e.currentTarget.style.borderColor = "#303030";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "#202223";
                              e.currentTarget.style.borderColor = "#202223";
                            }}
                          >
                            View Plans
                          </button>
                        </Link>
                      </div>
                    </div>
                  </Banner>
                </BlockStack>
              </Card>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
