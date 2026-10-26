// =================================================================
// Geographic scoping
// =================================================================
// A goal like "my city, day to day" is half a topic and half a place.
// Topic matching alone ranks a Pacific earthquake alongside a 311 complaint
// because both are "environment / cities".
//
// The load-bearing subtlety: scope belongs to the *insight*, not the source.
// Air quality is a world feed, but "New York stands out in nitrogen dioxide"
// is maximally local to a New York reader. So a place is resolved from the
// dimension the claim is actually about, falling back to the source's own
// footprint only when the claim names no place.
// =================================================================

/** Mirrors Loom's own `SourceGeo` vocabulary. */
export type GeoLevel = "world" | "us" | "city" | "region";

export interface Place {
  city?: string;
  country?: string;
}

/** Which dimension of a metric names a place, and at what granularity. */
export type PlaceDim = "city" | "country" | "state" | "region";

const US = "United States";

/**
 * Only the places these feeds actually emit. A world gazetteer would be dead
 * weight — and silently mismatching an unknown name is worse than admitting
 * we cannot place it.
 */
const CITY_COUNTRY: Record<string, string> = {
  "new york": US, "los angeles": US, "mexico city": "Mexico", "são paulo": "Brazil",
  "sao paulo": "Brazil", london: "United Kingdom", moscow: "Russia", cairo: "Egypt",
  lagos: "Nigeria", mumbai: "India", beijing: "China", tokyo: "Japan", sydney: "Australia",
  chicago: US, boston: US, "san francisco": US, philadelphia: US, houston: US,
};

/** NYC feeds report boroughs; all of them are the same city. */
const BOROUGHS = new Set(["brooklyn", "queens", "manhattan", "bronx", "staten island"]);

const US_STATES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la",
  "me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok",
  "or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc","pr",
]);

/** usgs encodes region as the tail of a place string: "…, Alaska" -> "Alaska". */
const US_REGIONS = new Set(["alaska", "hawaii", "california", "nevada", "puerto rico", "oklahoma", "texas", "washington", "utah", "montana", "idaho", "wyoming", "missouri", "tennessee", "arkansas", "kansas"]);

const norm = (s: string) => s.trim().toLowerCase();

/** Resolve a raw dimension label into a place, or null when it is not one. */
export function placeFromDim(label: string, kind: PlaceDim): Place | null {
  const n = norm(label);
  if (!n) return null;

  switch (kind) {
    case "city":
      return { city: label.trim(), country: CITY_COUNTRY[n] };
    case "state":
      return US_STATES.has(n) ? { country: US } : null;
    case "country":
      return { country: label.trim() };
    case "region": {
      if (BOROUGHS.has(n)) return { city: "New York", country: US };
      if (US_STATES.has(n) || US_REGIONS.has(n)) return { country: US };
      if (CITY_COUNTRY[n]) return { city: label.trim(), country: CITY_COUNTRY[n] };
      // "Japan region", "Vanuatu" and similar: treat the label as a country.
      return { country: label.replace(/\s+region$/i, "").trim() };
    }
  }
}

/**
 * How well an insight's place serves a reader anchored at `home`, 0–1.
 *
 * A claim with no place is not penalised to zero: a global finding is still
 * worth reading, it just should not outrank something happening where you are.
 */
export function geoAffinity(home: Place | null, subject: Place | null): number {
  if (!home) return 1;                       // no place stated: geography is irrelevant
  if (!subject) return 0.3;                  // genuinely placeless (arXiv, crypto)

  const sameCity =
    !!home.city && !!subject.city && norm(home.city) === norm(subject.city);
  if (sameCity) return 1;

  const sameCountry =
    !!home.country && !!subject.country && norm(home.country) === norm(subject.country);

  // A country-wide claim about your country is nearly as relevant as a local one.
  if (sameCountry && !subject.city) return 0.75;
  // Another city in your country.
  if (sameCountry) return 0.45;

  return 0.08;
}

/**
 * Parse a home place out of free-text goals.
 *
 * Returns `inferred: true` when the text asked for somewhere local without
 * naming it ("my city", "where I live"), so the UI can say which place was
 * assumed rather than quietly picking one.
 */
export function placeFromGoals(
  goals: string,
  fallbackCity = process.env.LOOMCLAW_HOME_CITY ?? "New York",
): { place: Place | null; inferred: boolean } {
  const text = norm(goals);
  if (!text) return { place: null, inferred: false };

  // An explicitly named place always wins over an inferred one.
  for (const [city, country] of Object.entries(CITY_COUNTRY)) {
    if (new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      return { place: { city: city.replace(/\b\w/g, (c) => c.toUpperCase()), country }, inferred: false };
    }
  }
  for (const b of BOROUGHS) {
    if (new RegExp(`\\b${b}\\b`, "i").test(text)) return { place: { city: "New York", country: US }, inferred: false };
  }
  if (/\bnyc\b/.test(text)) return { place: { city: "New York", country: US }, inferred: false };

  // Deictic: the reader means somewhere, but has not said where.
  if (/\b(my|our|this)\s+(city|town|neighborhood|area|borough)\b|\bwhere i live\b|\bnear me\b|\blocal\b|\baround here\b/.test(text)) {
    return { place: { city: fallbackCity, country: CITY_COUNTRY[norm(fallbackCity)] }, inferred: true };
  }

  return { place: null, inferred: false };
}

export const describePlace = (p: Place | null) =>
  !p ? "anywhere" : p.city ? `${p.city}${p.country ? `, ${p.country}` : ""}` : (p.country ?? "anywhere");
