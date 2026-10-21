import { type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { getGoogleAuthUrl } from "../google-sheets.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop") || "";

  if (!shop) {
    try {
      const { session } = await authenticate.admin(request);
      shop = session.shop;
    } catch {
      // ignore
    }
  }

  if (!shop) {
    return new Response("Missing shop parameter for Google authentication.", {
      status: 400,
    });
  }

  const host = url.searchParams.get("host") || "";
  const authUrl = getGoogleAuthUrl(shop);

  return redirect(authUrl);
};
