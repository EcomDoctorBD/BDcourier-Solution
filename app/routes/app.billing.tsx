import { redirect, type HeadersFunction, type LoaderFunctionArgs } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/pricing${url.search}`);
};

export default function BillingRedirect() {
  return null;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
