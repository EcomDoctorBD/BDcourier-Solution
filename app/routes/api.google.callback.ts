import { type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { exchangeCodeForTokens } from "../google-sheets.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const shopDomain = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error");

  if (error) {
    console.error("Google OAuth error callback:", error);
    return redirect(`/app/settings?google=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !shopDomain) {
    return redirect("/app/settings?google=missing_parameters");
  }

  try {
    await exchangeCodeForTokens(code, shopDomain);
    return redirect(`/app/settings?google=connected&shop=${encodeURIComponent(shopDomain)}`);
  } catch (err: any) {
    console.error("Failed to complete Google OAuth exchange:", err);
    return redirect(
      `/app/settings?google=failed&error=${encodeURIComponent(err.message || "OAuth exchange failed")}`
    );
  }
};
