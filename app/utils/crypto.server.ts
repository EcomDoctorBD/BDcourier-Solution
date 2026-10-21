import crypto from "crypto";

/**
 * Derives a consistent 32-byte (256-bit) key for AES-256-GCM
 */
function getEncryptionKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    "delivery1-fallback-32-byte-secret-key-bd";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts sensitive credentials using AES-256-GCM.
 * Output format: `ivHex:authTagHex:encryptedHex`
 */
export function encryptSecret(plainText: string): string {
  if (!plainText || typeof plainText !== "string" || !plainText.trim()) {
    return plainText || "";
  }

  // If already encrypted in iv:authTag:cipher format, return as is to avoid double-encryption
  const parts = plainText.split(":");
  if (
    parts.length === 3 &&
    parts[0].length === 24 && // 12-byte IV in hex is 24 chars
    parts[1].length === 32    // 16-byte AuthTag in hex is 32 chars
  ) {
    return plainText;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  } catch (err) {
    console.error("Encryption error:", err);
    return plainText; // Fail-safe return
  }
}

/**
 * Decrypts sensitive credentials.
 * Backward compatible: if string is not in `ivHex:authTagHex:encryptedHex` format,
 * returns the original plain text gracefully.
 */
export function decryptSecret(cipherText: string): string {
  if (!cipherText || typeof cipherText !== "string" || !cipherText.trim()) {
    return cipherText || "";
  }

  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    // Legacy plaintext string
    return cipherText;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;

  // Validate hex lengths (IV = 24 chars / 12 bytes, AuthTag = 32 chars / 16 bytes)
  if (ivHex.length !== 24 || authTagHex.length !== 32) {
    return cipherText;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    // If decryption fails (e.g., corrupted or legacy plaintext with colons), return original text
    return cipherText;
  }
}
