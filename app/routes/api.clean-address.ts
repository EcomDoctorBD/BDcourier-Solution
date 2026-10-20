import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { cleanAndCacheAddress } from "../clean-address.server";

/**
 * Remix HTTP Loader: Health and info check
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({
    status: "online",
    service: "Delivery1 AI Address Correction & Caching Engine",
    geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  });
};

/**
 * Remix HTTP Action: Direct endpoint to clean an address
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    let rawAddress = "";
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      rawAddress = body.rawAddress || body.address || "";
    } else {
      const formData = await request.formData();
      rawAddress = String(
        formData.get("rawAddress") || formData.get("address") || ""
      );
    }

    const result = await cleanAndCacheAddress(rawAddress);

    return json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    return json(
      {
        success: false,
        error: error?.message || "Address correction failed",
      },
      { status: 500 }
    );
  }
};
