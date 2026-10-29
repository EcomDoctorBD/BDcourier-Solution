/**
 * Universal Bangladesh Phone Number Sanitizer & Validator
 *
 * Isomorphic utility: safe to import in both Remix server runtime and client React components.
 * Normalizes Bengali unicode numerals, strips special formatting characters,
 * parses multi-number fields, and extracts valid 11-digit Bangladeshi mobile numbers.
 */

const BENGALI_DIGITS: Record<string, string> = {
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

/**
 * Converts all Bengali numerals (০-৯, Unicode \u09E6-\u09EF) to ASCII digits (0-9).
 */
export function convertBengaliDigitsToAscii(input: string): string {
  if (!input) return "";
  return String(input).replace(/[০-৯]/g, (char) => BENGALI_DIGITS[char] || char);
}

/**
 * Sanitizes and normalizes any Bangladeshi phone input into a standard 11-digit mobile string (013-019).
 * Returns a clean 11-digit number when valid, or fallback ASCII digits for landline/incomplete numbers.
 */
export function sanitizeBangladeshPhone(rawPhone?: string | null): string {
  if (!rawPhone) return "";
  const str = String(rawPhone).trim();
  if (!str) return "";

  // Step A: Convert Bengali numerals to ASCII digits
  const asciiStr = convertBengaliDigitsToAscii(str);

  // Step B: Split the string by common multi-number separators
  // Handles commas, slashes, semicolons, pipes, newlines, "or", and Bengali words "অথবা", "বা"
  const segments = asciiStr
    .split(/(?:[,\/;|\n\r]+|\b(?:or)\b|(?:\s+(?:অথবা|বা)\s+))/i)
    .map((s) => s.trim())
    .filter(Boolean);

  let fallbackDigits = "";

  // Step C & D: Examine each segment for a valid Bangladesh mobile number
  for (const segment of segments) {
    // Strip all non-digit characters (formatting, spaces, hyphens, plus, unicode directional markers)
    const digits = segment.replace(/\D/g, "");
    if (!digits) continue;

    if (!fallbackDigits) {
      fallbackDigits = digits;
    }

    // 1. Starts with international prefix 008801... (15 digits)
    if (digits.startsWith("008801") && digits.length === 15) {
      const core = digits.slice(4); // 01XXXXXXXXX
      if (/^01[3-9]\d{8}$/.test(core)) {
        return core;
      }
    }

    // 2. Starts with country code 8801... (13 digits)
    if (digits.startsWith("8801") && digits.length === 13) {
      const core = digits.slice(2); // 01XXXXXXXXX
      if (/^01[3-9]\d{8}$/.test(core)) {
        return core;
      }
    }

    // 3. Exactly 10 digits starting with 1 (e.g., 17XXXXXXXX without leading 0)
    if (digits.length === 10 && /^1[3-9]\d{8}$/.test(digits)) {
      return `0${digits}`;
    }

    // 4. Exactly 11 digits matching standard BD mobile format
    if (/^01[3-9]\d{8}$/.test(digits)) {
      return digits;
    }

    // 5. Concatenated numbers or extra surrounding digits: extract first valid 10-digit mobile core
    const match = /(?:00880|880|0)?(1[3-9]\d{8})/.exec(digits);
    if (match && match[1]) {
      const extracted = `0${match[1]}`;
      if (/^01[3-9]\d{8}$/.test(extracted)) {
        return extracted;
      }
    }
  }

  // Step E: Fallback for incomplete numbers or non-mobile landlines in UI
  if (fallbackDigits) {
    if (fallbackDigits.startsWith("0088") && fallbackDigits.length > 11) {
      return fallbackDigits.slice(4);
    }
    if (fallbackDigits.startsWith("88") && fallbackDigits.length > 11) {
      return fallbackDigits.slice(2);
    }
    return fallbackDigits;
  }

  return "";
}

/**
 * Strict validator: returns true ONLY if the phone number resolves to an authentic 11-digit Bangladesh mobile number.
 * Valid operators: Grameenphone (017, 013), Banglalink (019, 014), Robi/Airtel (018, 016), Teletalk (015).
 */
export function isValidBangladeshMobile(rawPhone?: string | null): boolean {
  const cleaned = sanitizeBangladeshPhone(rawPhone);
  return /^01[3-9]\d{8}$/.test(cleaned);
}

/**
 * Formats a phone number for direct WhatsApp wa.me links.
 * Valid BD numbers return "88" + 11-digit phone (e.g. 8801712345678).
 */
export function formatBangladeshPhoneForWhatsApp(rawPhone?: string | null): string {
  const cleaned = sanitizeBangladeshPhone(rawPhone);
  if (/^01[3-9]\d{8}$/.test(cleaned)) {
    return `88${cleaned}`;
  }
  return cleaned;
}
