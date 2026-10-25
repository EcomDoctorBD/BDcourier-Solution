import { type LoaderFunctionArgs, redirect } from "@remix-run/node";
import {
  getGoogleAuthUrl,
  verifySignedGoogleOAuthState,
} from "../google-sheets.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const stateParam = url.searchParams.get("state") || "";

  let shop = "";

  // 1. If an existing cryptographically signed state was passed, verify it
  if (stateParam) {
    const verifiedShop = verifySignedGoogleOAuthState(stateParam);
    if (verifiedShop) {
      shop = verifiedShop;
    }
  }

  // 2. Otherwise authenticate via active Shopify Admin session
  if (!shop) {
    try {
      const { session } = await authenticate.admin(request);
      if (session?.shop) {
        shop = session.shop;
      }
    } catch {
      // Unauthenticated session
    }
  }

  // Reject unauthenticated requests attempting IDOR or impersonation
  if (!shop) {
    return new Response(
      "Unauthorized: Valid Shopify admin session or signed state required to initiate Google authentication.",
      {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      }
    );
  }

  const authUrl = getGoogleAuthUrl(shop);
  return redirect(authUrl);
};
