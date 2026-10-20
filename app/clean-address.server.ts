import { connectDB, AddressCache } from "./db.server";

export interface CleanAddressResult {
  cleanAddress: string;
  district: string | null;
  thana: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  source: "cache" | "gemini" | "fallback";
}

/**
 * Canonical 64 Districts of Bangladesh & Common Keywords for Instant Local Matching
 */
const BANGLADESH_DISTRICT_MAP: Record<string, string> = {
  dhaka: "Dhaka",
  dacca: "Dhaka",
  savar: "Dhaka",
  uttara: "Dhaka",
  mirpur: "Dhaka",
  dhanmondi: "Dhaka",
  gulshan: "Dhaka",
  banani: "Dhaka",
  mohammadpur: "Dhaka",
  badda: "Dhaka",
  motijheel: "Dhaka",
  keraniganj: "Dhaka",
  gazipur: "Gazipur",
  tongi: "Gazipur",
  narayanganj: "Narayanganj",
  tangail: "Tangail",
  manikganj: "Manikganj",
  munshiganj: "Munshiganj",
  narsingdi: "Narsingdi",
  kishoreganj: "Kishoreganj",
  faridpur: "Faridpur",
  gopalganj: "Gopalganj",
  madaripur: "Madaripur",
  rajbari: "Rajbari",
  shariatpur: "Shariatpur",
  chattogram: "Chattogram",
  chittagong: "Chattogram",
  "cox's bazar": "Cox's Bazar",
  coxsbazar: "Cox's Bazar",
  cumilla: "Cumilla",
  comilla: "Cumilla",
  brahmanbaria: "Brahmanbaria",
  chandpur: "Chandpur",
  noakhali: "Noakhali",
  feni: "Feni",
  lakshmipur: "Lakshmipur",
  laxmipur: "Lakshmipur",
  rangamati: "Rangamati",
  khagrachhari: "Khagrachhari",
  bandarban: "Bandarban",
  rajshahi: "Rajshahi",
  bogura: "Bogura",
  bogra: "Bogura",
  pabna: "Pabna",
  sirajganj: "Sirajganj",
  natore: "Natore",
  naogaon: "Naogaon",
  chapainawabganj: "Chapainawabganj",
  joypurhat: "Joypurhat",
  khulna: "Khulna",
  jashore: "Jashore",
  jessore: "Jashore",
  kushtia: "Kushtia",
  satkhira: "Satkhira",
  bagerhat: "Bagerhat",
  jhenaidah: "Jhenaidah",
  magura: "Magura",
  narail: "Narail",
  chuadanga: "Chuadanga",
  meherpur: "Meherpur",
  barishal: "Barishal",
  barisal: "Barishal",
  patuakhali: "Patuakhali",
  bhola: "Bhola",
  pirojpur: "Pirojpur",
  barguna: "Barguna",
  jhalokati: "Jhalokati",
  sylhet: "Sylhet",
  moulvibazar: "Moulvibazar",
  maulvibazar: "Moulvibazar",
  habiganj: "Habiganj",
  sunamganj: "Sunamganj",
  rangpur: "Rangpur",
  dinajpur: "Dinajpur",
  kurigram: "Kurigram",
  gaibandha: "Gaibandha",
  nilphamari: "Nilphamari",
  panchagarh: "Panchagarh",
  thakurgaon: "Thakurgaon",
  lalmonirhat: "Lalmonirhat",
  mymensingh: "Mymensingh",
  jamalpur: "Jamalpur",
  netrokona: "Netrokona",
  sherpur: "Sherpur",
};

const SYSTEM_INSTRUCTION = `You are an expert Bangladeshi Logistics Address Normalizer and Geo-Coder.
Your job is to take raw, messy, or unstructured shipping addresses entered by Bangladeshi e-commerce customers (often mixed with Bengali, English, phonetics, landmarks, typos, or phone numbers) and clean them into a structured JSON object.

Output JSON Format:
{
  "cleanAddress": "Full well-formatted address in English title case without customer phone numbers",
  "district": "One of the 64 official Bangladeshi districts (e.g. Dhaka, Gazipur, Chattogram, Sylhet, etc.) or null if unidentifiable",
  "thana": "Prominent upazila, police station, or urban neighborhood (e.g. Mirpur, Uttara, Dhanmondi, Savar, Tongi, etc.) or empty string",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}

Confidence Rules:
- "HIGH": District and specific neighborhood/thana are clearly identified.
- "MEDIUM": District is identified, but neighborhood is approximate or generic.
- "LOW": Address is ambiguous, conflicting, fake, unidentifiable, or missing district. Set district to null if confidence is LOW.`;

/**
 * AI Address Correction & Caching Pipeline
 * 1. Step A: Fast MongoDB Cache Check (<5ms)
 * 2. Step B: Google AI Studio Gemini API Fallback on Cache Miss
 * 3. Step C: Save Translation Pair Asynchronously into AddressCache
 */
export async function cleanAndCacheAddress(
  rawAddress: string
): Promise<CleanAddressResult> {
  const normalizedRaw = (rawAddress || "").trim().toLowerCase();

  if (!normalizedRaw || normalizedRaw.length < 3) {
    return {
      cleanAddress: rawAddress || "",
      district: null,
      thana: "",
      confidence: "LOW",
      source: "fallback",
    };
  }

  // Ensure DB connection
  await connectDB();

  // -------------------------------------------------------------
  // STEP A: Cache Check (Sub-5ms Execution)
  // -------------------------------------------------------------
  try {
    const cached = await AddressCache.findOne({ rawInput: normalizedRaw }).lean();
    if (cached) {
      return {
        cleanAddress: cached.cleanAddress,
        district: cached.district || null,
        thana: cached.thana || "",
        confidence: (cached.confidence as any) || "HIGH",
        source: "cache",
      };
    }
  } catch (cacheErr) {
    console.warn("AddressCache lookup error:", cacheErr);
  }

  // -------------------------------------------------------------
  // STEP B: Gemini API Fallback
  // -------------------------------------------------------------
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  if (geminiApiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Parse and clean this Bangladeshi customer address:\n"${rawAddress}"`,
                },
              ],
            },
          ],
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      });

      if (response.ok) {
        const data: any = await response.json();
        const candidateText =
          data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (candidateText) {
          const parsed = JSON.parse(candidateText);

          const cleanAddress =
            String(parsed.cleanAddress || rawAddress).trim();
          const district = parsed.district ? String(parsed.district).trim() : null;
          const thana = parsed.thana ? String(parsed.thana).trim() : "";
          const confidence: "HIGH" | "MEDIUM" | "LOW" =
            parsed.confidence === "LOW" || !district
              ? "LOW"
              : parsed.confidence === "MEDIUM"
              ? "MEDIUM"
              : "HIGH";

          // -------------------------------------------------------------
          // STEP C: Save Cache (Asynchronously for future <5ms hits)
          // -------------------------------------------------------------
          AddressCache.updateOne(
            { rawInput: normalizedRaw },
            {
              $set: {
                rawInput: normalizedRaw,
                cleanAddress,
                district: district || "",
                thana,
                confidence,
                createdAt: new Date(),
              },
            },
            { upsert: true }
          ).catch((err: any) =>
            console.error("Failed to asynchronously save AddressCache:", err)
          );

          return {
            cleanAddress,
            district,
            thana,
            confidence,
            source: "gemini",
          };
        }
      } else {
        console.warn(
          `Gemini API returned status ${response.status}: ${await response.text()}`
        );
      }
    } catch (geminiErr) {
      console.error("Gemini API call failed, falling back to local normalizer:", geminiErr);
    }
  }

  // -------------------------------------------------------------
  // LOCAL FALLBACK NORMALIZER (When Gemini API key is missing or offline)
  // -------------------------------------------------------------
  let matchedDistrict: string | null = null;
  let matchedThana = "";

  for (const [keyword, canonDistrict] of Object.entries(BANGLADESH_DISTRICT_MAP)) {
    if (normalizedRaw.includes(keyword)) {
      matchedDistrict = canonDistrict;
      if (keyword !== canonDistrict.toLowerCase()) {
        matchedThana = keyword.charAt(0).toUpperCase() + keyword.slice(1);
      }
      break;
    }
  }

  const confidence = matchedDistrict ? "MEDIUM" : "LOW";
  const cleanAddress = rawAddress.trim();

  // Cache the local resolution as well so repeated clicks are instant
  if (matchedDistrict) {
    AddressCache.updateOne(
      { rawInput: normalizedRaw },
      {
        $set: {
          rawInput: normalizedRaw,
          cleanAddress,
          district: matchedDistrict,
          thana: matchedThana,
          confidence,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    ).catch(() => {});
  }

  return {
    cleanAddress,
    district: matchedDistrict,
    thana: matchedThana,
    confidence,
    source: "fallback",
  };
}
