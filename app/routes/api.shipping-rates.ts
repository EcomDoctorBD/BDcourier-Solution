import crypto from "crypto";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { connectDB, ShippingZone, ZoneDistricts } from "../db.server";

/**
 * Alias Dictionary mapping all 64 Bangladeshi Districts & common legacy spellings
 * to their canonical districtId for <5ms address matching.
 */
const DISTRICT_SYNONYM_MAP: Record<string, string> = {
  dhaka: "dhaka",
  dacca: "dhaka",
  savar: "dhaka",
  uttara: "dhaka",
  mirpur: "dhaka",
  dhanmondi: "dhaka",
  gulshan: "dhaka",
  banani: "dhaka",
  gazipur: "gazipur",
  tongi: "gazipur",
  narayanganj: "narayanganj",
  tangail: "tangail",
  manikganj: "manikganj",
  munshiganj: "munshiganj",
  narsingdi: "narsingdi",
  kishoreganj: "kishoreganj",
  faridpur: "faridpur",
  gopalganj: "gopalganj",
  madaripur: "madaripur",
  rajbari: "rajbari",
  shariatpur: "shariatpur",
  chattogram: "chattogram",
  chittagong: "chattogram",
  "cox's bazar": "coxs_bazar",
  coxsbazar: "coxs_bazar",
  cumilla: "cumilla",
  comilla: "cumilla",
  brahmanbaria: "brahmanbaria",
  chandpur: "chandpur",
  noakhali: "noakhali",
  feni: "feni",
  lakshmipur: "lakshmipur",
  laxmipur: "lakshmipur",
  rangamati: "rangamati",
  khagrachhari: "khagrachhari",
  khagrachari: "khagrachhari",
  bandarban: "bandarban",
  rajshahi: "rajshahi",
  bogura: "bogura",
  bogra: "bogura",
  pabna: "pabna",
  sirajganj: "sirajganj",
  natore: "natore",
  naogaon: "naogaon",
  chapainawabganj: "chapainawabganj",
  nawabganj: "chapainawabganj",
  joypurhat: "joypurhat",
  khulna: "khulna",
  jashore: "jashore",
  jessore: "jashore",
  kushtia: "kushtia",
  satkhira: "satkhira",
  bagerhat: "bagerhat",
  jhenaidah: "jhenaidah",
  magura: "magura",
  narail: "narail",
  chuadanga: "chuadanga",
  meherpur: "meherpur",
  barishal: "barishal",
  barisal: "barishal",
  patuakhali: "patuakhali",
  bhola: "bhola",
  pirojpur: "pirojpur",
  barguna: "barguna",
  jhalokati: "jhalokati",
  jhalokathi: "jhalokati",
  sylhet: "sylhet",
  moulvibazar: "moulvibazar",
  maulvibazar: "moulvibazar",
  habiganj: "habiganj",
  sunamganj: "sunamganj",
  rangpur: "rangpur",
  dinajpur: "dinajpur",
  kurigram: "kurigram",
  gaibandha: "gaibandha",
  nilphamari: "nilphamari",
  panchagarh: "panchagarh",
  thakurgaon: "thakurgaon",
  lalmonirhat: "lalmonirhat",
  mymensingh: "mymensingh",
  jamalpur: "jamalpur",
  netrokona: "netrokona",
  sherpur: "sherpur",
};

function detectBangladeshDistrictId(destination: any): string {
  const combinedLocation = [
    destination?.city,
    destination?.province,
    destination?.address2,
    destination?.address1,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const [keyword, canonicalId] of Object.entries(DISTRICT_SYNONYM_MAP)) {
    if (combinedLocation.includes(keyword)) {
      return canonicalId;
    }
  }

  return "dhaka";
}

function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret || !hmacHeader) {
    return false;
  }
  try {
    const digest = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    const digestBuffer = Buffer.from(digest, "utf8");
    const headerBuffer = Buffer.from(hmacHeader, "utf8");

    if (digestBuffer.length !== headerBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(digestBuffer, headerBuffer);
  } catch {
    return false;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({
    status: "online",
    service: "BD Dynamic Courier Shipping Zone Engine",
    endpoint: new URL(request.url).pathname,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const startTime = Date.now();

  try {
    const rawBody = await request.text();
    const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");

    if (!verifyShopifyHmac(rawBody, hmacHeader)) {
      return json({ rates: [] }, { status: 401 });
    }

    const payload = JSON.parse(rawBody || "{}");
    const rateRequest = payload?.rate || {};
    const destination = rateRequest?.destination || {};
    const items = Array.isArray(rateRequest?.items) ? rateRequest.items : [];
    const currency = rateRequest?.currency || "BDT";

    const url = new URL(request.url);
    const shopDomain =
      request.headers.get("X-Shopify-Shop-Domain") ||
      url.searchParams.get("shop") ||
      payload?.shop_domain ||
      "";

    // Strict multi-tenant isolation: if no shopDomain is identified, abort immediately
    if (!shopDomain) {
      return json({ rates: [] });
    }

    // 1. Identify Customer's Bangladeshi District
    const matchedDistrictId = detectBangladeshDistrictId(destination);

    // 2. Calculate Total Cart Weight (grams -> kg) & Cart Subtotal (cents -> major currency)
    let totalGrams = 0;
    let totalCartCents = 0;

    for (const item of items) {
      const qty = Number(item.quantity || 1);
      totalGrams += Number(item.grams || 500) * qty;
      totalCartCents += Number(item.price || 0) * qty;
    }

    const totalWeightKg = Math.max(0.2, totalGrams / 1000);
    const totalCartAmount = totalCartCents / 100;

    await connectDB();

    // 3. Query ZoneDistricts & ShippingZone strictly scoped to this merchant
    const matchedZoneDistrictDocs: any[] = await ZoneDistricts.find({
      merchantId: shopDomain,
      districtIds: matchedDistrictId,
    })
      .limit(5)
      .lean();

    if (matchedZoneDistrictDocs.length === 0) {
      // Fast Default Fallback Rate if merchant hasn't mapped this specific district yet
      const isDhaka = matchedDistrictId === "dhaka";
      const fallbackRateBdt = isDhaka ? 70 : 120;

      return json({
        rates: [
          {
            service_name: isDhaka
              ? "Inside Dhaka Express Delivery"
              : `Outside Dhaka Courier (${matchedDistrictId.toUpperCase()})`,
            service_code: `BD_DEFAULT_${matchedDistrictId.toUpperCase()}`,
            total_price: String(Math.round(fallbackRateBdt * 100)),
            description: `Estimated 24-72h Delivery • Weight: ${totalWeightKg.toFixed(
              2
            )}kg`,
            currency,
          },
        ],
      });
    }

    const zoneIds = matchedZoneDistrictDocs.map((zd) => zd.zoneId);
    const shippingZones: any[] = await ShippingZone.find({
      _id: { $in: zoneIds },
      merchantId: shopDomain,
    }).lean();

    const rates = shippingZones.map((zone) => {
      const baseRate = Number(zone.baseRate ?? 70);

      // Evaluate Weight Tiers
      let extraWeightCharge = 0;
      if (Array.isArray(zone.weightTiers) && zone.weightTiers.length > 0) {
        const sortedTiers = [...zone.weightTiers].sort(
          (a, b) => Number(a.maxWeight) - Number(b.maxWeight)
        );
        const applicableTier =
          sortedTiers.find((t) => totalWeightKg <= Number(t.maxWeight)) ||
          sortedTiers[sortedTiers.length - 1];

        extraWeightCharge = Number(applicableTier?.extraRate || 0);
      }

      // Evaluate COD Surcharge if enabled on the Zone
      let codSurchargeAmount = 0;
      if (zone.codSurchargeEnabled && totalCartAmount > 0) {
        const pct = Number(zone.codSurchargePercentage ?? 1);
        codSurchargeAmount = (totalCartAmount * pct) / 100;
      }

      const finalShippingRate =
        baseRate + extraWeightCharge + codSurchargeAmount;
      const totalPriceInCents = String(Math.round(finalShippingRate * 100));

      return {
        service_name: `${zone.zoneName} (${matchedDistrictId.toUpperCase()})`,
        service_code: `BD_ZONE_${String(zone._id)}`,
        total_price: totalPriceInCents,
        description: `Base: ৳${baseRate}${
          extraWeightCharge > 0
            ? ` + Weight (${totalWeightKg.toFixed(1)}kg): ৳${extraWeightCharge}`
            : ""
        }${
          codSurchargeAmount > 0
            ? ` + COD Fee: ৳${codSurchargeAmount.toFixed(0)}`
            : ""
        } • Solved in ${Date.now() - startTime}ms`,
        currency,
      };
    });

    return json({ rates });
  } catch (error) {
    return json({
      rates: [
        {
          service_name: "Bangladesh Standard Courier Delivery",
          service_code: "BD_FALLBACK_STANDARD",
          total_price: "10000",
          description: "Standard Nationwide Courier Delivery",
          currency: "BDT",
        },
      ],
    });
  }
};
