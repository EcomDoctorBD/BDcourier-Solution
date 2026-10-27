import { connectDB, CourierConfig, decryptCourierConfig, encryptSecret } from "../db.server";

export interface PathaoStore {
  store_id: string;
  store_name: string;
  store_address: string;
}

export interface RedxStore {
  id: string;
  name: string;
  address: string;
}

/**
 * Returns the official Pathao API base URL according to the selected environment
 */
export function getPathaoBaseUrl(environment = "production"): string {
  const envNormalized = String(environment || "").toLowerCase().trim();
  if (envNormalized === "sandbox") {
    return "https://courier-api-sandbox.pathao.com";
  }
  return "https://api-hermes.pathao.com";
}

/**
 * Returns the official RedX API base URL according to the selected environment
 */
export function getRedxBaseUrl(environment = "production"): string {
  const envNormalized = String(environment || "").toLowerCase().trim();
  if (envNormalized === "sandbox") {
    return "https://sandbox.redx.com.bd";
  }
  return "https://openapi.redx.com.bd";
}

// In-flight mutex map to deduplicate concurrent Pathao OAuth refresh calls per shopDomain
// Prevents race conditions and multiple token refresh collisions under heavy batch stress (e.g. 50 orders simultaneously)
const ongoingPathaoRefreshes = new Map<
  string,
  Promise<{ success: boolean; token: string | null; error?: string }>
>();

/**
 * Resolves or refreshes an active, valid Pathao OAuth access token.
 * Automatically saves new/refreshed tokens with AES-256 encryption into MongoDB.
 * Supports forceRefresh for silent 401 interception and single-flight lock concurrency.
 */
export async function getValidPathaoToken(
  shopDomain: string,
  options: { forceRefresh?: boolean } = {}
): Promise<{
  success: boolean;
  token: string | null;
  error?: string;
}> {
  const cacheKey = (shopDomain || "").trim().toLowerCase();

  // If a refresh or token resolution is already in progress for this shopDomain, await it directly!
  if (ongoingPathaoRefreshes.has(cacheKey)) {
    return ongoingPathaoRefreshes.get(cacheKey)!;
  }

  const tokenPromise = (async () => {
    try {
      return await resolvePathaoTokenInternal(shopDomain, options);
    } finally {
      ongoingPathaoRefreshes.delete(cacheKey);
    }
  })();

  ongoingPathaoRefreshes.set(cacheKey, tokenPromise);
  return tokenPromise;
}

async function resolvePathaoTokenInternal(
  shopDomain: string,
  options: { forceRefresh?: boolean } = {}
): Promise<{
  success: boolean;
  token: string | null;
  error?: string;
}> {
  await connectDB();
  const rawConfig: any = await CourierConfig.findOne({ shopDomain }).lean();

  if (!rawConfig) {
    return {
      success: false,
      token: null,
      error: "Store courier configuration not found.",
    };
  }

  const config = decryptCourierConfig(rawConfig);
  const baseUrl = getPathaoBaseUrl(config.pathaoEnvironment);

  const clientId = config.pathaoClientId?.trim();
  const clientSecret = config.pathaoSecret?.trim();
  const username = config.pathaoUsername?.trim() || process.env.PATHAO_USERNAME || "";
  const password = config.pathaoPassword?.trim() || process.env.PATHAO_PASSWORD || "";

  if (!clientId || !clientSecret) {
    return {
      success: false,
      token: null,
      error: "Pathao Client ID and Client Secret are required in Courier Settings.",
    };
  }

  // 1. Proactive Token Health Check Guard (5-minute safety threshold)
  // If token exists, is valid, and NOT forced to refresh, return cached token immediately
  const SAFETY_BUFFER_MS = 5 * 60 * 1000;
  const tokenExpiresAtMs = config.pathaoTokenExpiresAt
    ? new Date(config.pathaoTokenExpiresAt).getTime()
    : 0;
  const isExpired = Date.now() >= tokenExpiresAtMs - SAFETY_BUFFER_MS;

  if (!options.forceRefresh && config.pathaoAccessToken && !isExpired) {
    return { success: true, token: config.pathaoAccessToken };
  }

  // 2. Silent Auto-Refresh via refresh_token grant
  if (config.pathaoRefreshToken) {
    try {
      const refreshResponse = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: config.pathaoRefreshToken,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (refreshResponse.ok) {
        const refreshData: any = await refreshResponse.json();
        const newAccessToken =
          refreshData?.access_token || refreshData?.data?.access_token;
        const newRefreshToken =
          refreshData?.refresh_token ||
          refreshData?.data?.refresh_token ||
          config.pathaoRefreshToken;
        const expiresInSec = Number(
          refreshData?.expires_in || refreshData?.data?.expires_in || 604800
        );

        if (newAccessToken) {
          const expiresAt = new Date(Date.now() + expiresInSec * 1000);

          await CourierConfig.updateOne(
            { shopDomain },
            {
              $set: {
                pathaoAccessToken: encryptSecret(newAccessToken),
                pathaoRefreshToken: encryptSecret(newRefreshToken),
                pathaoTokenExpiresAt: expiresAt,
              },
            }
          );

          console.log(
            `[Pathao OAuth] Token successfully refreshed via refresh_token for ${shopDomain}. Valid until ${expiresAt.toISOString()}`
          );

          return { success: true, token: newAccessToken };
        }
      } else {
        const errJson: any = await refreshResponse.json().catch(() => null);
        console.warn(
          `[Pathao OAuth] refresh_token grant failed (${refreshResponse.status}):`,
          errJson?.message || errJson?.error || refreshResponse.statusText
        );
      }
    } catch (refreshErr: any) {
      console.warn(
        `[Pathao OAuth] refresh_token network error for ${shopDomain}:`,
        refreshErr?.message || refreshErr
      );
    }
  }

  // 3. Fallback: Request fresh token via password grant if username & password configured
  if (!username || !password) {
    return {
      success: false,
      token: null,
      error:
        "Pathao token expired and cannot be refreshed automatically. Please re-authenticate your Pathao account in Courier Settings.",
    };
  }

  try {
    const tokenResponse = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        username,
        password,
        grant_type: "password",
      }),
      signal: AbortSignal.timeout(8000),
    });

    const tokenData: any = await tokenResponse.json();
    const accessToken =
      tokenData?.access_token || tokenData?.data?.access_token;
    const refreshToken =
      tokenData?.refresh_token || tokenData?.data?.refresh_token || "";
    const expiresInSec = Number(
      tokenData?.expires_in || tokenData?.data?.expires_in || 604800
    );

    if (!tokenResponse.ok || !accessToken) {
      const errorMsg =
        tokenData?.message ||
        tokenData?.error_description ||
        tokenData?.error ||
        `HTTP ${tokenResponse.status} from Pathao OAuth`;
      return {
        success: false,
        token: null,
        error: `Pathao authentication failed: ${errorMsg}. Please re-authenticate your Pathao account in Courier Settings.`,
      };
    }

    const expiresAt = new Date(Date.now() + expiresInSec * 1000);

    await CourierConfig.updateOne(
      { shopDomain },
      {
        $set: {
          pathaoAccessToken: encryptSecret(accessToken),
          pathaoRefreshToken: encryptSecret(refreshToken),
          pathaoTokenExpiresAt: expiresAt,
        },
      }
    );

    console.log(
      `[Pathao OAuth] Fresh token issued via password grant for ${shopDomain}. Valid until ${expiresAt.toISOString()}`
    );

    return { success: true, token: accessToken };
  } catch (err: any) {
    return {
      success: false,
      token: null,
      error: `Network error connecting to Pathao OAuth: ${err?.message || "Unknown"}`,
    };
  }
}

/**
 * Fetches all registered pickup stores from Pathao for the authenticated merchant
 */
export async function fetchPathaoStores(shopDomain: string): Promise<{
  success: boolean;
  stores: PathaoStore[];
  error?: string;
}> {
  let tokenResult = await getValidPathaoToken(shopDomain);
  if (!tokenResult.success || !tokenResult.token) {
    return { success: false, stores: [], error: tokenResult.error };
  }

  await connectDB();
  const rawConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
  const baseUrl = getPathaoBaseUrl(rawConfig?.pathaoEnvironment);

  try {
    let response = await fetch(`${baseUrl}/aladdin/api/v1/stores`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenResult.token}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    // Silent 401 Unauthorized Interception & Automatic Retry
    if (response.status === 401) {
      console.warn("[Pathao Stores] 401 Unauthorized encountered. Attempting silent token refresh...");
      tokenResult = await getValidPathaoToken(shopDomain, { forceRefresh: true });
      if (tokenResult.success && tokenResult.token) {
        response = await fetch(`${baseUrl}/aladdin/api/v1/stores`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${tokenResult.token}`,
          },
          signal: AbortSignal.timeout(8000),
        });
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        stores: [],
        error: `Pathao Stores API error (${response.status}): ${errText}`,
      };
    }

    const data: any = await response.json();
    const rawList =
      Array.isArray(data?.data?.data)
        ? data.data.data
        : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
        ? data
        : [];

    const stores: PathaoStore[] = rawList.map((s: any) => ({
      store_id: String(s.store_id ?? s.id ?? ""),
      store_name: String(s.store_name ?? s.name ?? "Store #" + (s.store_id || s.id)),
      store_address: String(s.store_address ?? s.address ?? ""),
    }));

    return { success: true, stores };
  } catch (err: any) {
    return {
      success: false,
      stores: [],
      error: `Failed to fetch Pathao stores: ${err.message || "Network Timeout"}`,
    };
  }
}

/**
 * Fetches all pickup stores from RedX for the merchant using their API Access Token
 */
export async function fetchRedxStores(shopDomain: string): Promise<{
  success: boolean;
  stores: RedxStore[];
  error?: string;
}> {
  await connectDB();
  const rawConfig: any = await CourierConfig.findOne({ shopDomain }).lean();

  if (!rawConfig) {
    return { success: false, stores: [], error: "Store courier configuration not found." };
  }

  const config = decryptCourierConfig(rawConfig);
  const token = config.redxAccessToken?.trim();

  if (!token) {
    return {
      success: false,
      stores: [],
      error: "RedX API Access Token is required to fetch pickup stores.",
    };
  }

  const baseUrl = getRedxBaseUrl(config.redxEnvironment);

  try {
    const response = await fetch(`${baseUrl}/v1.0.0-beta/pickup/stores`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "API-ACCESS-TOKEN": `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        stores: [],
        error: `RedX Stores API error (${response.status}): ${errText}`,
      };
    }

    const data: any = await response.json();
    const rawList =
      Array.isArray(data?.pickup_stores)
        ? data.pickup_stores
        : Array.isArray(data?.stores)
        ? data.stores
        : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
        ? data
        : [];

    const stores: RedxStore[] = rawList.map((s: any) => ({
      id: String(s.id ?? s.pickup_store_id ?? s._id ?? ""),
      name: String(s.name ?? s.store_name ?? "Store #" + (s.id || "")),
      address: String(s.address ?? s.pickup_address ?? ""),
    }));

    return { success: true, stores };
  } catch (err: any) {
    return {
      success: false,
      stores: [],
      error: `Failed to fetch RedX pickup stores: ${err.message || "Network Timeout"}`,
    };
  }
}
