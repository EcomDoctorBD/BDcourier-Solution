import { useEffect } from "react";
import { json, redirect, type HeadersFunction, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useSearchParams } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { connectDB, getSystemConfig } from "../db.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isAuthHeaderPresent = Boolean(request.headers.get("authorization"));

  // If a document request has missing shop or host, attempt to recover them before authenticate.admin throws a redirect
  if (!isAuthHeaderPresent && (!url.searchParams.get("shop") || !url.searchParams.get("host"))) {
    const cookieHeader = request.headers.get("cookie") || "";
    const shopCookie = cookieHeader.match(/(?:^|;\s*)app_shop=([^;]+)/)?.[1];
    const hostCookie = cookieHeader.match(/(?:^|;\s*)app_host=([^;]+)/)?.[1];

    let recoveredShop = url.searchParams.get("shop") || (shopCookie ? decodeURIComponent(shopCookie) : "");
    let recoveredHost = url.searchParams.get("host") || (hostCookie ? decodeURIComponent(hostCookie) : "");

    const referer = request.headers.get("referer") || "";
    if (!recoveredShop && referer) {
      const adminMatch = referer.match(/admin\.shopify\.com\/store\/([a-zA-Z0-9-_]+)/);
      if (adminMatch) recoveredShop = `${adminMatch[1]}.myshopify.com`;
      const domainMatch = referer.match(/([a-zA-Z0-9-_]+\.myshopify\.com)/);
      if (!recoveredShop && domainMatch) recoveredShop = domainMatch[1];
    }
    if (!recoveredHost && referer) {
      try {
        const refUrl = new URL(referer);
        const refHost = refUrl.searchParams.get("host");
        if (refHost) recoveredHost = refHost;
      } catch {}
    }

    if (recoveredShop && (!url.searchParams.get("shop") || !url.searchParams.get("host"))) {
      const redirectUrl = new URL(request.url);
      if (!redirectUrl.searchParams.get("shop") && recoveredShop) {
        redirectUrl.searchParams.set("shop", recoveredShop);
      }
      if (!redirectUrl.searchParams.get("host") && recoveredHost) {
        redirectUrl.searchParams.set("host", recoveredHost);
      }
      return redirect(redirectUrl.toString());
    }
  }

  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const host = url.searchParams.get("host") || "";

  const responseHeaders = new Headers();
  if (shop) {
    responseHeaders.append(
      "Set-Cookie",
      `app_shop=${encodeURIComponent(shop)}; Path=/; SameSite=None; Secure; Max-Age=31536000`
    );
  }
  if (host) {
    responseHeaders.append(
      "Set-Cookie",
      `app_host=${encodeURIComponent(host)}; Path=/; SameSite=None; Secure; Max-Age=31536000`
    );
  }

  let systemConfig: any = null;
  try {
    await connectDB();
    systemConfig = await getSystemConfig();
  } catch (err) {
    console.warn("Could not load SystemConfig:", err);
  }

  return json(
    {
      apiKey: process.env.SHOPIFY_API_KEY || "bc8cab60c84e1dcbb55b4c057645e5c8",
      shop,
      host,
      supportEmail: systemConfig?.supportEmail || "ecomdoctorbd@gmail.com",
      whatsappHelpline: systemConfig?.whatsappHelpline || "01346851322",
      whatsappNumber: systemConfig?.whatsappNumber || "+8801346851322",
    },
    { headers: responseHeaders }
  );
};

export default function App() {
  const { apiKey, shop, host, supportEmail, whatsappHelpline, whatsappNumber } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const currentShop = searchParams.get("shop") || shop || "";
  const currentHost = searchParams.get("host") || host || "";

  // Maintain shop and host in the URL search params so App Bridge and browser history retain active context
  useEffect(() => {
    if (typeof window !== "undefined" && (currentShop || currentHost)) {
      const params = new URLSearchParams(window.location.search);
      let changed = false;
      if (currentShop && !params.get("shop")) {
        params.set("shop", currentShop);
        changed = true;
      }
      if (currentHost && !params.get("host")) {
        params.set("host", currentHost);
        changed = true;
      }
      if (changed) {
        const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
        window.history.replaceState(null, "", newUrl);
      }
    }
  }, [currentShop, currentHost]);

  const navParams = new URLSearchParams();
  if (currentShop) navParams.set("shop", currentShop);
  if (currentHost) navParams.set("host", currentHost);
  const searchStr = navParams.toString() ? `?${navParams.toString()}` : "";

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to={`/app${searchStr}`} rel="home">
          📊 Dashboard
        </Link>
        <Link to={`/app/orders${searchStr}`}>📦 Orders</Link>
        <Link to={`/app/courier-settings${searchStr}`}>⚙️ Courier Settings</Link>
        <Link to={`/app/shipping-rates${searchStr}`}>🚚 Shipping Rates</Link>
        <Link to={`/app/integrations${searchStr}`}>🔌 Integrations</Link>
        <Link to={`/app/pricing${searchStr}`}>💳 Pricing & Billing</Link>
        <Link to={`/app/help${searchStr}`}>💬 Help & Support</Link>
      </NavMenu>
      <Outlet context={{ supportEmail, whatsappHelpline, whatsappNumber }} />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
