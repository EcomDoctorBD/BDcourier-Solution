import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { cleanAndCacheAddress } from "../clean-address.server";
import { authenticate } from "../shopify.server";

/**
 * Remix HTTP Loader: Gated behind Shopify Admin authentication
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return json({
    status: "online",
    service: "SafeParcel BD AI Address Correction & Caching Engine",
  });
};

/**
 * Remix HTTP Action: Direct endpoint to clean an address (strictly authenticated)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // 1. Strictly authenticate Shopify merchant admin session (Issue 5.1)
  try {
    await authenticate.admin(request);
  } catch {
    return json(
      { success: false, error: "Unauthorized: Valid Shopify admin session required." },
      { status: 401 }
    );
  }

  try {
    let rawAddressInput: unknown = "";
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      rawAddressInput = body?.rawAddress ?? body?.address ?? "";
    } else {
      const formData = await request.formData().catch(() => new FormData());
      rawAddressInput = formData.get("rawAddress") ?? formData.get("address") ?? "";
    }

    // 2. Prevent NoSQL Object Injection & Validate String Type (Issue 4.1)
    if (typeof rawAddressInput !== "string") {
      return json(
        { success: false, error: "Invalid address format: Expected plain string." },
        { status: 400 }
      );
    }

    const trimmed = rawAddressInput.trim();
    if (trimmed.length < 3) {
      return json(
        { success: false, error: "Address is too short (minimum 3 characters required)." },
        { status: 400 }
      );
    }

    const rawAddress = trimmed.slice(0, 500);
    const result = await cleanAndCacheAddress(rawAddress);

    return json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error("Address correction endpoint error:", error?.message || error);
    return json(
      {
        success: false,
        error: "Address correction processing failed.",
      },
      { status: 500 }
    );
  }
};
