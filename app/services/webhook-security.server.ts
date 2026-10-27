import crypto from "crypto";

/**
 * Constant-time safe string comparison to prevent timing attacks.
 */
export function safeCompare(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  try {
    const cleanProvided = String(provided).trim();
    const cleanExpected = String(expected).trim();
    const bufA = Buffer.from(cleanProvided, "utf8");
    const bufB = Buffer.from(cleanExpected, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Verifies HMAC cryptographic signature against raw payload bytes.
 * Computes HMAC-SHA256 (or HMAC-SHA512) in Hex and Base64 format.
 * Uses constant-time safe comparison to prevent timing side-channel attacks.
 */
export function verifyHmacSignature(
  rawBody: string,
  providedSignature: string,
  secretKey: string,
  algorithm: "sha256" | "sha512" = "sha256"
): boolean {
  if (!rawBody || !providedSignature || !secretKey) return false;
  try {
    const cleanSig = String(providedSignature).trim();
    // Strip common algorithm prefixes like "sha256=" or "sha512="
    const strippedSig = cleanSig
      .replace(/^sha256=/i, "")
      .replace(/^sha512=/i, "")
      .trim();

    // 1. Verify against Hex digest
    const expectedHex = crypto
      .createHmac(algorithm, secretKey)
      .update(rawBody, "utf8")
      .digest("hex");

    if (safeCompare(strippedSig, expectedHex)) {
      return true;
    }

    // 2. Verify against Base64 digest
    const expectedBase64 = crypto
      .createHmac(algorithm, secretKey)
      .update(rawBody, "utf8")
      .digest("base64");

    if (safeCompare(strippedSig, expectedBase64)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validates incoming webhook requests using dynamic multi-vector verification:
 * 1. Cryptographic HMAC Signature check against candidate secret keys.
 * 2. Static token / API Key safe string comparison against candidate secret keys.
 * Returns true if ANY candidate secret satisfies HMAC signature or token equality.
 */
export function validateWebhookRequest({
  rawBody,
  candidateSecrets,
  providedSignatures = [],
  providedTokens = [],
}: {
  rawBody: string;
  candidateSecrets: (string | null | undefined)[];
  providedSignatures?: (string | null | undefined)[];
  providedTokens?: (string | null | undefined)[];
}): { isValid: boolean; reason?: string } {
  const cleanSecrets = candidateSecrets
    .map((s) => (s ? String(s).trim() : ""))
    .filter(Boolean);

  if (cleanSecrets.length === 0) {
    return {
      isValid: false,
      reason: "No webhook secret configured on store courier profile",
    };
  }

  const cleanSignatures = providedSignatures
    .map((s) => (s ? String(s).trim() : ""))
    .filter(Boolean);

  const cleanTokens = providedTokens
    .map((t) => (t ? String(t).trim() : ""))
    .filter(Boolean);

  // If no signatures and no tokens were provided at all, reject immediately
  if (cleanSignatures.length === 0 && cleanTokens.length === 0) {
    return {
      isValid: false,
      reason: "Missing webhook cryptographic signature or authorization token",
    };
  }

  // 1. Verify HMAC signatures (SHA-256 and SHA-512)
  if (rawBody && cleanSignatures.length > 0) {
    for (const sig of cleanSignatures) {
      for (const secret of cleanSecrets) {
        if (verifyHmacSignature(rawBody, sig, secret, "sha256")) {
          return { isValid: true };
        }
        if (verifyHmacSignature(rawBody, sig, secret, "sha512")) {
          return { isValid: true };
        }
      }
    }
  }

  // 2. Verify raw security tokens / API keys via constant-time comparison
  if (cleanTokens.length > 0) {
    for (const token of cleanTokens) {
      for (const secret of cleanSecrets) {
        if (safeCompare(token, secret)) {
          return { isValid: true };
        }
      }
    }
  }

  return {
    isValid: false,
    reason: "Cryptographic signature or token mismatch",
  };
}
