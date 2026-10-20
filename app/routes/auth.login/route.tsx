import { useState } from "react";
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

function extractShopAndHost(request: Request) {
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop");
  let host = url.searchParams.get("host");

  // 1. Recover shop from base64 host param if available
  if (!shop && host) {
    try {
      const decodedHost = Buffer.from(host, "base64").toString("utf-8");
      const adminMatch = decodedHost.match(/admin\.shopify\.com\/store\/([a-zA-Z0-9-_]+)/);
      if (adminMatch) {
        shop = `${adminMatch[1]}.myshopify.com`;
      } else {
        const domainMatch = decodedHost.match(/([a-zA-Z0-9-_]+\.myshopify\.com)/);
        if (domainMatch) {
          shop = domainMatch[1];
        }
      }
    } catch {}
  }

  // 2. Recover shop and host from cookies
  if (!shop || !host) {
    const cookieHeader = request.headers.get("cookie") || "";
    if (!shop) {
      const match = cookieHeader.match(/(?:^|;\s*)app_shop=([^;]+)/);
      if (match) {
        try {
          shop = decodeURIComponent(match[1]);
        } catch {}
      }
    }
    if (!host) {
      const match = cookieHeader.match(/(?:^|;\s*)app_host=([^;]+)/);
      if (match) {
        try {
          host = decodeURIComponent(match[1]);
        } catch {}
      }
    }
  }

  // 3. Recover shop and host from Referer
  if (!shop) {
    const referer = request.headers.get("referer") || "";
    if (referer) {
      const adminMatch = referer.match(/admin\.shopify\.com\/store\/([a-zA-Z0-9-_]+)/);
      if (adminMatch) {
        shop = `${adminMatch[1]}.myshopify.com`;
      } else {
        const domainMatch = referer.match(/([a-zA-Z0-9-_]+\.myshopify\.com)/);
        if (domainMatch) {
          shop = domainMatch[1];
        }
      }
      if (!host) {
        try {
          const refUrl = new URL(referer);
          const refHost = refUrl.searchParams.get("host");
          if (refHost) host = refHost;
        } catch {}
      }
    }
  }

  return { shop, host };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  if (!shopParam) {
    const { shop, host } = extractShopAndHost(request);
    if (shop) {
      const redirectUrl = new URL(request.url);
      redirectUrl.searchParams.set("shop", shop);
      if (host) redirectUrl.searchParams.set("host", host);
      return redirect(redirectUrl.toString());
    }
  }

  const errors = loginErrorMessage(await login(request));

  return { errors, polarisTranslations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
