import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/shipping-rates${url.search}`);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/shipping-rates${url.search}`);
};

export default function ShippingRedirectPage() {
  return null;
}
