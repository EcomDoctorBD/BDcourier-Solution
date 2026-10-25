import { type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { exchangeCodeForTokens } from "../google-sheets.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const shopDomain = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error");

  if (error) {
    console.error("Google OAuth error callback:", error);
    return redirect(`/app/integrations?google=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !shopDomain) {
    return redirect("/app/integrations?google=missing_parameters");
  }

  try {
    await exchangeCodeForTokens(code, shopDomain);
    return redirect(`/app/integrations?google=connected&shop=${encodeURIComponent(shopDomain)}`);
  } catch (err: any) {
    console.error("Failed to complete Google OAuth exchange:", err);
    return redirect(
      `/app/integrations?google=failed&error=${encodeURIComponent(err.message || "OAuth exchange failed")}`
    );
  }
};
