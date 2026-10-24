import type { LoaderFunctionArgs } from "@remix-run/node";
import { useRouteError } from "@remix-run/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
    return null;
  } catch (error) {
    if (error instanceof Response) {
      throw error; // Standard Remix redirect / App Bridge response
    }
    console.error("AUTH ROUTE ERROR:", error);
    throw error;
  }
};

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("AUTH ROUTE BOUNDARY ERROR:", error);

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h2>Authentication Error</h2>
      <p style={{ color: "#d82c0d", fontWeight: "bold" }}>
        {error instanceof Error ? error.message : "An unexpected error occurred during authentication."}
      </p>
      {error instanceof Error && error.stack && (
        <pre style={{ background: "#f4f6f8", padding: "1rem", borderRadius: "4px", overflow: "auto" }}>
          {error.stack}
        </pre>
      )}
    </div>
  );
}
