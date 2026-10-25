import { type LoaderFunctionArgs, redirect } from "@remix-run/node";
import {
  exchangeCodeForTokens,
  verifySignedGoogleOAuthState,
} from "../google-sheets.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error");

  if (error) {
    console.error("Google OAuth error callback:", error);
    return redirect(`/app/integrations?google=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !rawState) {
    return redirect("/app/integrations?google=missing_parameters");
  }

  // Verify HMAC-SHA256 signature and 15-minute freshness of OAuth state
  const shopDomain = verifySignedGoogleOAuthState(rawState);
  if (!shopDomain) {
    console.error(
      "Google OAuth callback rejected: Invalid, forged, or expired state signature."
    );
    return new Response(
      "Security Error: Invalid or expired Google OAuth state signature.",
      {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      }
    );
  }

  try {
    await exchangeCodeForTokens(code, shopDomain);
    return redirect(
      `/app/integrations?google=connected&shop=${encodeURIComponent(shopDomain)}`
    );
  } catch (err: any) {
    console.error("Failed to complete Google OAuth exchange:", err);
    return redirect(
      `/app/integrations?google=failed&error=${encodeURIComponent(
        err.message || "OAuth exchange failed"
      )}`
    );
  }
};
