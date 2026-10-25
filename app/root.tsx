import { useEffect } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import { Analytics } from "@vercel/analytics/remix";
import { SpeedInsights } from "@vercel/speed-insights/remix";

export default function App() {
  // Safe Free Skew Protection against stale chunk cache when new deployments occur
  useEffect(() => {
    const handlePreloadError = () => {
      const lastReload = sessionStorage.getItem("skew_reload_ts");
      const now = Date.now();
      if (!lastReload || now - Number(lastReload) > 10000) {
        sessionStorage.setItem("skew_reload_ts", String(now));
        window.location.reload();
      }
    };
    window.addEventListener("vite:preloadError", handlePreloadError);
    return () => window.removeEventListener("vite:preloadError", handlePreloadError);
  }, []);

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("ROOT ERROR BOUNDARY:", error);
  let errorMessage = "An unexpected error occurred.";
  let errorStack: string | undefined;

  if (isRouteErrorResponse(error)) {
    errorMessage = `${error.status} ${error.statusText}: ${error.data?.message || JSON.stringify(error.data)}`;
  } else if (error instanceof Error) {
    errorMessage = error.message;
    errorStack = error.stack;
  }

  return (
    <html>
      <head>
        <title>Application Error</title>
        <Meta />
        <Links />
      </head>
      <body style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Application Error</h1>
        <p style={{ color: "#d82c0d", fontWeight: "bold" }}>{errorMessage}</p>
        {errorStack && (
          <pre
            style={{
              background: "#f4f6f8",
              padding: "1rem",
              borderRadius: "4px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {errorStack}
          </pre>
        )}
        <Scripts />
      </body>
    </html>
  );
}
