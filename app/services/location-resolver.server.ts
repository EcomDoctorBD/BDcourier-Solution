import {
  connectDB,
  CourierConfig,
  decryptCourierConfig,
  AddressCache,
  CourierLocationCache,
} from "../db.server";
import {
  getPathaoBaseUrl,
  getRedxBaseUrl,
  getValidPathaoToken,
} from "./courier-auth.server";

export interface PathaoLocationResult {
  recipient_city: number;
  recipient_zone: number;
  recipient_area?: number | null;
  cityName: string;
  zoneName: string;
  source: "cache" | "live_match" | "fallback";
}

export interface RedxLocationResult {
  delivery_area_id: number;
  delivery_area: string;
  districtName?: string;
  source: "cache" | "live_match" | "fallback";
}

// 7 Days Cache TTL for Courier Location Lists (Pathao Cities/Zones & RedX Areas)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cleanStr(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Common Bangladeshi District Name Aliases & Spellings
 */
const DISTRICT_ALIASES: Record<string, string[]> = {
  dhaka: ["dhaka", "dacca"],
  chattogram: ["chattogram", "chittagong", "ctg"],
  cumilla: ["cumilla", "comilla"],
  bogura: ["bogura", "bogra"],
  jashore: ["jashore", "jessore"],
  barishal: ["barishal", "barisal"],
  "cox's bazar": ["cox's bazar", "coxsbazar", "coxs bazar", "cox bazar"],
  brahmanbaria: ["brahmanbaria", "bbaria", "brahmanbarya"],
  lakshmipur: ["lakshmipur", "laxmipur"],
  moulvibazar: ["moulvibazar", "maulvibazar"],
  netrokona: ["netrokona", "netrakona"],
  chapainawabganj: ["chapainawabganj", "nawabganj", "chapainawabgonj"],
  sunamganj: ["sunamganj", "sunamgonj"],
  sirajganj: ["sirajganj", "sirajgonj"],
  habiganj: ["habiganj", "habigonj"],
  munshiganj: ["munshiganj", "munshigonj"],
  manikganj: ["manikganj", "manikgonj"],
  narayanganj: ["narayanganj", "narayangonj"],
  panchagarh: ["panchagarh", "panchagar"],
  jhalokati: ["jhalokati", "jhalakathi"],
  khagrachhari: ["khagrachhari", "khagrachari"],
};

export function areDistrictsMatching(districtA: string, districtB: string): boolean {
  const normA = cleanStr(districtA);
  const normB = cleanStr(districtB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;

  for (const aliases of Object.values(DISTRICT_ALIASES)) {
    const cleanedAliases = aliases.map(cleanStr);
    const hasA = cleanedAliases.some((alias) => alias === normA || normA.includes(alias));
    const hasB = cleanedAliases.some((alias) => alias === normB || normB.includes(alias));
    if (hasA && hasB) return true;
  }
  return false;
}

/**
 * 1. PATHAO LOCATION RESOLVER
 * Maps { district, thana, rawAddress } to Pathao numeric { recipient_city, recipient_zone }
 */
export async function resolvePathaoLocation(
  shopDomain: string,
  district?: string | null,
  thana?: string | null,
  rawAddress?: string | null
): Promise<PathaoLocationResult> {
  const defaultResult: PathaoLocationResult = {
    recipient_city: 1, // Dhaka
    recipient_zone: 1, // Standard Central Dhaka Zone
    cityName: "Dhaka",
    zoneName: "Dhaka",
    source: "fallback",
  };

  try {
    await connectDB();

    const normalizedRaw = (rawAddress || "").trim().toLowerCase();

    // Check AddressCache first (<5ms hit)
    if (normalizedRaw && normalizedRaw.length >= 3) {
      const cachedAddress: any = await AddressCache.findOne({
        rawInput: normalizedRaw,
      }).lean();

      if (
        cachedAddress &&
        cachedAddress.pathaoCityId &&
        cachedAddress.pathaoZoneId &&
        Number(cachedAddress.pathaoCityId) > 0 &&
        Number(cachedAddress.pathaoZoneId) > 0
      ) {
        return {
          recipient_city: Number(cachedAddress.pathaoCityId),
          recipient_zone: Number(cachedAddress.pathaoZoneId),
          cityName: cachedAddress.district || "Dhaka",
          zoneName: cachedAddress.thana || "",
          source: "cache",
        };
      }
    }

    // Step A: Load or Fetch Pathao Cities List
    let citiesList: Array<{ city_id: number; city_name: string }> = [];

    const cachedCitiesDoc: any = await CourierLocationCache.findOne({
      courier: "pathao_cities",
      parentId: 0,
    }).lean();

    const isCitiesCacheFresh =
      cachedCitiesDoc?.data &&
      cachedCitiesDoc.updatedAt &&
      Date.now() - new Date(cachedCitiesDoc.updatedAt).getTime() < CACHE_TTL_MS;

    if (isCitiesCacheFresh && Array.isArray(cachedCitiesDoc.data)) {
      citiesList = cachedCitiesDoc.data;
    } else {
      // Fetch live cities list from Pathao API
      try {
        const rawConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
        const baseUrl = getPathaoBaseUrl(rawConfig?.pathaoEnvironment);
        const tokenRes = await getValidPathaoToken(shopDomain);

        if (tokenRes.success && tokenRes.token) {
          const resp = await fetch(`${baseUrl}/aladdin/api/v1/countries/1/city-list`, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${tokenRes.token}`,
            },
            signal: AbortSignal.timeout(6000),
          });

          if (resp.ok) {
            const data: any = await resp.json();
            const rawCities =
              data?.data?.data || data?.data || (Array.isArray(data) ? data : []);

            if (Array.isArray(rawCities) && rawCities.length > 0) {
              citiesList = rawCities.map((c: any) => ({
                city_id: Number(c.city_id ?? c.id ?? 1),
                city_name: String(c.city_name ?? c.name ?? "Dhaka"),
              }));

              await CourierLocationCache.findOneAndUpdate(
                { courier: "pathao_cities", parentId: 0 },
                {
                  $set: {
                    courier: "pathao_cities",
                    parentId: 0,
                    data: citiesList,
                    updatedAt: new Date(),
                  },
                },
                { upsert: true }
              );
            }
          }
        }
      } catch (fetchCitiesErr) {
        console.warn("Failed to fetch Pathao cities list:", fetchCitiesErr);
      }

      // If fetch failed, use cached data even if older than TTL
      if (citiesList.length === 0 && Array.isArray(cachedCitiesDoc?.data)) {
        citiesList = cachedCitiesDoc.data;
      }
    }

    // Step B: Match District to Pathao City ID
    let matchedCity: { city_id: number; city_name: string } | null = null;
    const targetDistrict = (district || "").trim();

    if (targetDistrict && citiesList.length > 0) {
      matchedCity =
        citiesList.find((c) => areDistrictsMatching(c.city_name, targetDistrict)) ||
        null;
    }

    // Default to Dhaka if no match found
    if (!matchedCity) {
      matchedCity =
        citiesList.find((c) => cleanStr(c.city_name) === "dhaka") || {
          city_id: 1,
          city_name: "Dhaka",
        };
    }

    const cityId = matchedCity.city_id || 1;

    // Step C: Load or Fetch Pathao Zones List for the matched City
    let zonesList: Array<{ zone_id: number; zone_name: string }> = [];

    const cachedZonesDoc: any = await CourierLocationCache.findOne({
      courier: "pathao_zones",
      parentId: cityId,
    }).lean();

    const isZonesCacheFresh =
      cachedZonesDoc?.data &&
      cachedZonesDoc.updatedAt &&
      Date.now() - new Date(cachedZonesDoc.updatedAt).getTime() < CACHE_TTL_MS;

    if (isZonesCacheFresh && Array.isArray(cachedZonesDoc.data)) {
      zonesList = cachedZonesDoc.data;
    } else {
      try {
        const rawConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
        const baseUrl = getPathaoBaseUrl(rawConfig?.pathaoEnvironment);
        const tokenRes = await getValidPathaoToken(shopDomain);

        if (tokenRes.success && tokenRes.token) {
          const resp = await fetch(
            `${baseUrl}/aladdin/api/v1/cities/${cityId}/zone-list`,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${tokenRes.token}`,
              },
              signal: AbortSignal.timeout(6000),
            }
          );

          if (resp.ok) {
            const data: any = await resp.json();
            const rawZones =
              data?.data?.data || data?.data || (Array.isArray(data) ? data : []);

            if (Array.isArray(rawZones) && rawZones.length > 0) {
              zonesList = rawZones.map((z: any) => ({
                zone_id: Number(z.zone_id ?? z.id ?? 1),
                zone_name: String(z.zone_name ?? z.name ?? ""),
              }));

              await CourierLocationCache.findOneAndUpdate(
                { courier: "pathao_zones", parentId: cityId },
                {
                  $set: {
                    courier: "pathao_zones",
                    parentId: cityId,
                    data: zonesList,
                    updatedAt: new Date(),
                  },
                },
                { upsert: true }
              );
            }
          }
        }
      } catch (fetchZonesErr) {
        console.warn(`Failed to fetch Pathao zones for city ${cityId}:`, fetchZonesErr);
      }

      if (zonesList.length === 0 && Array.isArray(cachedZonesDoc?.data)) {
        zonesList = cachedZonesDoc.data;
      }
    }

    // Step D: Match Thana or Raw Address to Zone ID
    let matchedZone: { zone_id: number; zone_name: string } | null = null;
    const cleanThana = cleanStr(thana || "");
    const cleanAddr = (rawAddress || "").toLowerCase();

    if (zonesList.length > 0) {
      // 1. Exact or Substring match on Thana
      if (cleanThana) {
        matchedZone =
          zonesList.find((z) => cleanStr(z.zone_name) === cleanThana) ||
          zonesList.find((z) => {
            const cz = cleanStr(z.zone_name);
            return cz.includes(cleanThana) || cleanThana.includes(cz);
          }) ||
          null;
      }

      // 2. Keyword match in Raw Address (Longest zone name match preferred)
      if (!matchedZone && cleanAddr) {
        const sortedZones = [...zonesList].sort(
          (a, b) => b.zone_name.length - a.zone_name.length
        );
        for (const z of sortedZones) {
          const zn = z.zone_name.toLowerCase().trim();
          if (zn.length >= 3 && cleanAddr.includes(zn)) {
            matchedZone = z;
            break;
          }
        }
      }

      // 3. Fallback to first zone in city
      if (!matchedZone) {
        matchedZone = zonesList[0];
      }
    }

    const zoneId = matchedZone?.zone_id || 1;
    const zoneName = matchedZone?.zone_name || "";

    // Step E: Asynchronously update AddressCache for instant future lookups
    if (normalizedRaw && normalizedRaw.length >= 3) {
      AddressCache.updateOne(
        { rawInput: normalizedRaw },
        {
          $set: {
            pathaoCityId: cityId,
            pathaoZoneId: zoneId,
          },
        }
      ).catch((err: any) =>
        console.warn("Failed to asynchronously save Pathao IDs to AddressCache:", err)
      );
    }

    return {
      recipient_city: cityId,
      recipient_zone: zoneId,
      cityName: matchedCity.city_name,
      zoneName,
      source: "live_match",
    };
  } catch (err: any) {
    console.warn("Pathao location resolution encountered error, using fallback:", err);
    return defaultResult;
  }
}

/**
 * 2. REDX LOCATION RESOLVER
 * Maps { district, thana, rawAddress } to RedX numeric { delivery_area_id, delivery_area }
 */
export async function resolveRedxLocation(
  shopDomain: string,
  district?: string | null,
  thana?: string | null,
  rawAddress?: string | null
): Promise<RedxLocationResult> {
  const defaultResult: RedxLocationResult = {
    delivery_area_id: 1,
    delivery_area: district || "Dhaka",
    districtName: district || "Dhaka",
    source: "fallback",
  };

  try {
    await connectDB();

    const normalizedRaw = (rawAddress || "").trim().toLowerCase();

    // Check AddressCache first (<5ms hit)
    if (normalizedRaw && normalizedRaw.length >= 3) {
      const cachedAddress: any = await AddressCache.findOne({
        rawInput: normalizedRaw,
      }).lean();

      if (
        cachedAddress &&
        cachedAddress.redxAreaId &&
        cachedAddress.redxAreaName &&
        Number(cachedAddress.redxAreaId) > 0
      ) {
        return {
          delivery_area_id: Number(cachedAddress.redxAreaId),
          delivery_area: cachedAddress.redxAreaName,
          districtName: cachedAddress.district || district || "Dhaka",
          source: "cache",
        };
      }
    }

    // Step A: Load or Fetch RedX Areas List
    let areasList: Array<{
      id: number;
      name: string;
      district_name?: string;
      division_name?: string;
      zone_name?: string;
      post_code?: number;
    }> = [];

    const cachedAreasDoc: any = await CourierLocationCache.findOne({
      courier: "redx_areas",
      parentId: 0,
    }).lean();

    const isAreasCacheFresh =
      cachedAreasDoc?.data &&
      cachedAreasDoc.updatedAt &&
      Date.now() - new Date(cachedAreasDoc.updatedAt).getTime() < CACHE_TTL_MS;

    if (isAreasCacheFresh && Array.isArray(cachedAreasDoc.data)) {
      areasList = cachedAreasDoc.data;
    } else {
      try {
        const rawConfig: any = await CourierConfig.findOne({ shopDomain }).lean();
        if (rawConfig) {
          const config = decryptCourierConfig(rawConfig);
          const baseUrl = getRedxBaseUrl(config.redxEnvironment);
          const token = config.redxAccessToken?.trim();

          if (token) {
            const resp = await fetch(`${baseUrl}/v1.0.0-beta/areas`, {
              method: "GET",
              headers: {
                Accept: "application/json",
                "API-ACCESS-TOKEN": `Bearer ${token}`,
              },
              signal: AbortSignal.timeout(8000),
            });

            if (resp.ok) {
              const data: any = await resp.json();
              const rawAreas =
                data?.areas ||
                data?.data?.areas ||
                data?.data ||
                (Array.isArray(data) ? data : []);

              if (Array.isArray(rawAreas) && rawAreas.length > 0) {
                areasList = rawAreas.map((a: any) => ({
                  id: Number(a.id ?? a.area_id ?? 1),
                  name: String(a.name ?? a.area_name ?? "Dhaka"),
                  district_name: String(a.district_name ?? a.division_name ?? ""),
                  division_name: String(a.division_name ?? ""),
                  zone_name: String(a.zone_name ?? ""),
                  post_code: Number(a.post_code ?? 0),
                }));

                await CourierLocationCache.findOneAndUpdate(
                  { courier: "redx_areas", parentId: 0 },
                  {
                    $set: {
                      courier: "redx_areas",
                      parentId: 0,
                      data: areasList,
                      updatedAt: new Date(),
                    },
                  },
                  { upsert: true }
                );
              }
            }
          }
        }
      } catch (fetchAreasErr) {
        console.warn("Failed to fetch RedX areas list:", fetchAreasErr);
      }

      if (areasList.length === 0 && Array.isArray(cachedAreasDoc?.data)) {
        areasList = cachedAreasDoc.data;
      }
    }

    if (areasList.length === 0) {
      return defaultResult;
    }

    // Step B: Match District and Thana/Address to RedX Area
    const targetDistrict = (district || "").trim();
    const cleanThana = cleanStr(thana || "");
    const cleanAddr = (rawAddress || "").toLowerCase();

    // 1. Filter candidates matching district
    let candidates = areasList;
    if (targetDistrict) {
      const districtMatches = areasList.filter((a) =>
        areDistrictsMatching(a.district_name || a.division_name || "", targetDistrict)
      );
      if (districtMatches.length > 0) {
        candidates = districtMatches;
      }
    }

    // 2. Match thana in candidates
    let matchedArea: (typeof areasList)[0] | null = null;

    if (cleanThana) {
      matchedArea =
        candidates.find((a) => cleanStr(a.name) === cleanThana) ||
        candidates.find((a) => {
          const ca = cleanStr(a.name);
          return ca.includes(cleanThana) || cleanThana.includes(ca);
        }) ||
        null;
    }

    // 3. Match address keywords in candidates (Longest match preferred)
    if (!matchedArea && cleanAddr) {
      const sortedCandidates = [...candidates].sort(
        (a, b) => (b.name?.length || 0) - (a.name?.length || 0)
      );
      for (const a of sortedCandidates) {
        const an = (a.name || "").toLowerCase().trim();
        if (an.length >= 3 && cleanAddr.includes(an)) {
          matchedArea = a;
          break;
        }
      }
    }

    // 4. Fallback to first area in candidate district or whole list
    if (!matchedArea) {
      matchedArea = candidates[0] || areasList[0];
    }

    const deliveryAreaId = Number(matchedArea.id || 1);
    const deliveryArea = String(matchedArea.name || district || "Dhaka");

    // Step C: Asynchronously update AddressCache for instant future lookups
    if (normalizedRaw && normalizedRaw.length >= 3) {
      AddressCache.updateOne(
        { rawInput: normalizedRaw },
        {
          $set: {
            redxAreaId: deliveryAreaId,
            redxAreaName: deliveryArea,
          },
        }
      ).catch((err: any) =>
        console.warn("Failed to asynchronously save RedX IDs to AddressCache:", err)
      );
    }

    return {
      delivery_area_id: deliveryAreaId,
      delivery_area: deliveryArea,
      districtName: matchedArea.district_name || district || "Dhaka",
      source: "live_match",
    };
  } catch (err: any) {
    console.warn("RedX location resolution encountered error, using fallback:", err);
    return defaultResult;
  }
}
