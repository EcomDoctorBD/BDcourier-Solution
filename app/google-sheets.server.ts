import crypto from "crypto";
import { google } from "googleapis";
import { connectDB, MerchantIntegrations } from "./db.server";
import { encryptSecret, decryptSecret } from "./utils/crypto.server";

// Standard Google Sheets Columns strictly defined for Bangladeshi Courier Hub
export const GOOGLE_SHEETS_COLUMNS = [
  "Order ID",
  "Order Date",
  "Customer Name",
  "Phone Number",
  "Delivery Address",
  "District",
  "Area / Thana",
  "Assigned Courier",
  "Tracking ID",
] as const;

export interface SyncOrderPayload {
  orderId: string | number;
  timestamp?: string | Date;
  customerName: string;
  phoneNumber: string;
  rawAddress: string;
  cleanedDistrict: string;
  cleanedThana?: string;
  courierPartner: string; // e.g. "Pathao" | "Steadfast"
  courierTrackingId: string;
}

/**
 * Resolves Google OAuth credentials from process.env or fallback configuration
 */
function getOAuthCredentials() {
  const clientId =
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.GOOGLE_SHEETS_CLIENT_ID?.trim() ||
    "";
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_SHEETS_CLIENT_SECRET?.trim() ||
    "";

  return { clientId, clientSecret };
}

/**
 * Initializes Google OAuth2 Client
 */
export function getOAuth2Client(redirectUri?: string) {
  const { clientId, clientSecret } = getOAuthCredentials();

  const appUrl =
    process.env.SHOPIFY_APP_URL ||
    process.env.HOST ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://b-dcourier-solution.vercel.app");

  const defaultRedirect = `${appUrl.replace(/\/$/, "")}/api/google/callback`;
  const finalRedirectUri = redirectUri || process.env.GOOGLE_REDIRECT_URI || defaultRedirect;

  return new google.auth.OAuth2(clientId, clientSecret, finalRedirectUri);
}

/**
 * Generates an HMAC-SHA256 cryptographically signed OAuth state
 * Format: <base64url(shopDomain|timestamp|nonce)>.<base64url(hmac)>
 */
export function createSignedGoogleOAuthState(shopDomain: string): string {
  const normalizedShop = String(shopDomain || "").trim().toLowerCase();
  if (!normalizedShop) {
    throw new Error("Cannot create Google OAuth state: Missing shopDomain.");
  }
  const secret =
    process.env.ENCRYPTION_KEY?.trim() ||
    process.env.SHOPIFY_API_SECRET?.trim() ||
    "";
  if (!secret) {
    throw new Error("Missing ENCRYPTION_KEY or SHOPIFY_API_SECRET for OAuth state signing.");
  }

  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = `${normalizedShop}|${Date.now()}|${nonce}`;
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

/**
 * Validates HMAC-SHA256 signed OAuth state and enforces a 15-minute expiration window.
 * Returns the verified shopDomain if valid, or null if forged/expired/invalid.
 */
export function verifySignedGoogleOAuthState(stateParam: string): string | null {
  if (!stateParam || typeof stateParam !== "string") return null;

  const parts = stateParam.trim().split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, providedSig] = parts;
  if (!encodedPayload || !providedSig) return null;

  const secret =
    process.env.ENCRYPTION_KEY?.trim() ||
    process.env.SHOPIFY_API_SECRET?.trim() ||
    "";
  if (!secret) {
    console.error("Missing ENCRYPTION_KEY or SHOPIFY_API_SECRET for OAuth state verification.");
    return null;
  }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const [shopDomain, timestampStr] = decoded.split("|");
    if (!shopDomain) return null;

    const timestamp = Number(timestampStr);
    if (!timestamp || isNaN(timestamp)) return null;

    const ageMs = Date.now() - timestamp;
    // 15-minute expiration window (reject timestamps older than 15 mins or future-dated by > 60s)
    if (ageMs < -60000 || ageMs > 15 * 60 * 1000) {
      console.warn(`Google OAuth state expired or future-dated for ${shopDomain} (age: ${ageMs}ms)`);
      return null;
    }

    const normalizedShop = shopDomain.trim().toLowerCase();
    if (!normalizedShop.endsWith(".myshopify.com") && !normalizedShop.includes(".")) {
      return null;
    }

    return normalizedShop;
  } catch (err) {
    console.warn("Failed to parse Google OAuth state payload:", err);
    return null;
  }
}

/**
 * Generates OAuth authorization consent URL with offline access and signed state
 */
export function getGoogleAuthUrl(shopDomain: string, redirectUri?: string): string {
  const oauth2Client = getOAuth2Client(redirectUri);

  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  const state = createSignedGoogleOAuthState(shopDomain);

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state,
  });
}

/**
 * Exchanges authorization code for tokens and saves them in MerchantIntegrations
 * Tokens are encrypted at rest using AES-256-GCM.
 */
export async function exchangeCodeForTokens(
  code: string,
  shopDomain: string,
  redirectUri?: string
) {
  await connectDB();
  const oauth2Client = getOAuth2Client(redirectUri);

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch authenticated Google user profile info for display in the UI
  let email = "";
  let name = "";
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    email = userInfo.data.email || "";
    name = userInfo.data.name || "";
  } catch (err) {
    console.warn("Could not retrieve Google user profile info:", err);
  }

  // Check if an existing spreadsheet is linked, or create a brand new dedicated one
  let spreadsheetId = "";
  let spreadsheetName = "Delivery1 Orders Hub";
  let spreadsheetUrl = "";

  try {
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Delivery1 Orders - ${shopDomain}`,
        },
        sheets: [
          {
            properties: {
              title: "Orders",
              gridProperties: {
                frozenRowCount: 1,
              },
            },
          },
        ],
      },
    });

    spreadsheetId = createRes.data.spreadsheetId || "";
    spreadsheetName = createRes.data.properties?.title || "Delivery1 Orders";
    spreadsheetUrl = createRes.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

    // Write header row to the newly created sheet with RAW valueInputOption
    if (spreadsheetId) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Orders!A1:I1",
        valueInputOption: "RAW",
        requestBody: {
          values: [Array.from(GOOGLE_SHEETS_COLUMNS)],
        },
      });
    }
  } catch (createErr) {
    console.warn("Could not auto-create Google Sheet during OAuth setup:", createErr);
  }

  // Save encrypted credentials into MongoDB MerchantIntegrations collection
  const updateData: any = {
    merchantId: shopDomain,
    googleAccessToken: tokens.access_token ? encryptSecret(tokens.access_token) : "",
    googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    googleUserEmail: email,
    googleUserName: name,
    autoSyncEnabled: true,
    lastSyncStatus: "IDLE",
    lastSyncError: "",
  };

  if (tokens.refresh_token) {
    updateData.googleRefreshToken = encryptSecret(tokens.refresh_token);
  }
  if (spreadsheetId) {
    updateData.spreadsheetId = spreadsheetId;
    updateData.spreadsheetName = spreadsheetName;
    updateData.sheetName = "Orders";
    updateData.spreadsheetUrl = spreadsheetUrl;
  }

  const updatedDoc = await MerchantIntegrations.findOneAndUpdate(
    { merchantId: shopDomain },
    { $set: updateData },
    { upsert: true, new: true }
  );

  return updatedDoc;
}

/**
 * Disconnects Google Sheets integration
 */
export async function disconnectGoogleAccount(shopDomain: string) {
  await connectDB();
  return MerchantIntegrations.findOneAndUpdate(
    { merchantId: shopDomain },
    {
      $set: {
        googleRefreshToken: "",
        googleAccessToken: "",
        googleTokenExpiry: null,
        googleUserEmail: "",
        googleUserName: "",
        autoSyncEnabled: false,
        lastSyncStatus: "IDLE",
      },
    },
    { new: true }
  );
}

/**
 * Updates merchant's spreadsheet preference (ID, sheet tab name, autoSyncEnabled)
 */
export async function updateSpreadsheetSettings(
  shopDomain: string,
  settings: {
    spreadsheetId?: string;
    sheetName?: string;
    autoSyncEnabled?: boolean;
  }
) {
  await connectDB();
  const update: any = {};
  if (settings.spreadsheetId !== undefined) {
    update.spreadsheetId = settings.spreadsheetId.trim();
    update.spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId.trim()}`;
  }
  if (settings.sheetName !== undefined) {
    update.sheetName = settings.sheetName.trim() || "Orders";
  }
  if (settings.autoSyncEnabled !== undefined) {
    update.autoSyncEnabled = Boolean(settings.autoSyncEnabled);
  }

  return MerchantIntegrations.findOneAndUpdate(
    { merchantId: shopDomain },
    { $set: update },
    { upsert: true, new: true }
  );
}

/**
 * Fetches the merchant integration document
 */
export async function getMerchantIntegration(shopDomain: string) {
  await connectDB();
  return MerchantIntegrations.findOne({ merchantId: shopDomain }).lean();
}

/**
 * Ensures valid authenticated Google Sheets client with automatic token refreshing
 * Decrypts encrypted credentials and re-encrypts refreshed access tokens.
 */
async function getAuthenticatedSheetsClient(shopDomain: string) {
  await connectDB();
  const integration = await MerchantIntegrations.findOne({ merchantId: shopDomain });

  if (!integration || !integration.googleRefreshToken) {
    return null;
  }

  const decryptedRefreshToken = decryptSecret(integration.googleRefreshToken);
  const decryptedAccessToken = decryptSecret(integration.googleAccessToken);

  if (!decryptedRefreshToken) {
    return null;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: decryptedRefreshToken,
    access_token: decryptedAccessToken,
  });

  // Check if access token is missing or expired within the next 2 minutes
  const now = Date.now();
  const isExpired =
    !decryptedAccessToken ||
    !integration.googleTokenExpiry ||
    new Date(integration.googleTokenExpiry).getTime() <= now + 120000;

  if (isExpired) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      integration.googleAccessToken = credentials.access_token
        ? encryptSecret(credentials.access_token)
        : "";
      if (credentials.refresh_token) {
        integration.googleRefreshToken = encryptSecret(credentials.refresh_token);
      }
      if (credentials.expiry_date) {
        integration.googleTokenExpiry = new Date(credentials.expiry_date);
      }
      await integration.save();
    } catch (refreshErr: any) {
      console.error("Failed to refresh Google OAuth token:", refreshErr);
      integration.lastSyncStatus = "FAILED";
      integration.lastSyncError = `Token Refresh Error: ${refreshErr.message}`;
      await integration.save();
      throw new Error(`Google token refresh failed: ${refreshErr.message}`);
    }
  }

  return {
    sheets: google.sheets({ version: "v4", auth: oauth2Client }),
    integration,
  };
}

/**
 * Sanitizes cell values to prevent CSV / Spreadsheet formula injection attacks (CWE-1236).
 * Any cell starting with =, +, -, @, \t, \r, or | is prepended with a single quote (')
 * to force spreadsheet software to treat the value strictly as literal plain text.
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value).trim();
  if (!str) return "";
  if (/^[=+\-@|\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * REAL-TIME ORDER AUTO-SYNC EVENT HANDLER
 * Appends a new order row strictly formatted with all 9 logistics columns:
 * 1. Order ID
 * 2. Timestamp
 * 3. Customer Name
 * 4. Phone Number
 * 5. Raw Shopify Address
 * 6. Cleaned District (AI / Cache)
 * 7. Cleaned Thana (AI / Cache)
 * 8. Courier Partner Assigned (Pathao / Steadfast)
 * 9. Official Courier Tracking ID
 */
export async function syncOrderToGoogleSheet(
  shopDomain: string,
  payload: SyncOrderPayload
): Promise<{ success: boolean; error?: string; rowAppended?: any }> {
  try {
    const clientData = await getAuthenticatedSheetsClient(shopDomain);
    if (!clientData) {
      return { success: false, error: "Google Sheets is not connected for this merchant." };
    }

    const { sheets, integration } = clientData;

    if (!integration.autoSyncEnabled) {
      return { success: false, error: "Google Sheets auto-sync is paused in settings." };
    }

    const spreadsheetId = integration.spreadsheetId?.trim();
    if (!spreadsheetId) {
      return { success: false, error: "No target Google Spreadsheet ID is configured." };
    }

    const targetSheet = integration.sheetName?.trim() || "Orders";

    // 1. Verify / Write Header row if the sheet is freshly created or empty
    try {
      const headerCheck = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${targetSheet}!A1:I1`,
      });

      if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${targetSheet}!A1:I1`,
          valueInputOption: "RAW",
          requestBody: {
            values: [Array.from(GOOGLE_SHEETS_COLUMNS)],
          },
        });
      }
    } catch (headerErr) {
      // If the sheet tab doesn't exist, create it with the headers
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: targetSheet,
                    gridProperties: { frozenRowCount: 1 },
                  },
                },
              },
            ],
          },
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${targetSheet}!A1:I1`,
          valueInputOption: "RAW",
          requestBody: {
            values: [Array.from(GOOGLE_SHEETS_COLUMNS)],
          },
        });
      } catch (addSheetErr) {
        console.warn("Header initialization notice:", addSheetErr);
      }
    }

    // 2. Format the Row values strictly matching the required columns and sanitize against formula injection
    const orderIdStr = sanitizeSpreadsheetCell(payload.orderId);
    const formattedTimestamp = sanitizeSpreadsheetCell(
      payload.timestamp
        ? new Date(payload.timestamp).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })
        : new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })
    );

    const rowData = [
      orderIdStr,
      formattedTimestamp,
      sanitizeSpreadsheetCell(payload.customerName),
      sanitizeSpreadsheetCell(payload.phoneNumber),
      sanitizeSpreadsheetCell(payload.rawAddress),
      sanitizeSpreadsheetCell(payload.cleanedDistrict),
      sanitizeSpreadsheetCell(payload.cleanedThana),
      sanitizeSpreadsheetCell(payload.courierPartner || "Unassigned"),
      sanitizeSpreadsheetCell(payload.courierTrackingId || "Pending"),
    ];

    // 3. Append Row securely with RAW valueInputOption to prevent formula execution
    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${targetSheet}!A:I`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [rowData],
      },
    });

    // 4. Update sync statistics on success
    await MerchantIntegrations.updateOne(
      { merchantId: shopDomain },
      {
        $set: {
          lastSyncAt: new Date(),
          lastSyncStatus: "SUCCESS",
          lastSyncError: "",
        },
        $inc: { totalOrdersSynced: 1 },
      }
    );

    return {
      success: true,
      rowAppended: rowData,
    };
  } catch (err: any) {
    console.error("Google Sheets order sync failed:", err);
    try {
      await MerchantIntegrations.updateOne(
        { merchantId: shopDomain },
        {
          $set: {
            lastSyncAt: new Date(),
            lastSyncStatus: "FAILED",
            lastSyncError: err.message || "Unknown Google Sheets API error",
          },
        }
      );
    } catch (saveErr) {
      console.warn("Could not save sync error status:", saveErr);
    }

    return {
      success: false,
      error: err.message || "Failed to append order to Google Sheet",
    };
  }
}
