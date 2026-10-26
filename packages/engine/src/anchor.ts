// =================================================================
// Anchors — where you sit inside a finding about the world
// =================================================================
// A world ranking is more useful when it says where YOU are in it. "Mumbai
// leads air quality" is a fact; "Mumbai leads, and New York — where you
// live — is 7th of 12" is about you.
//
// Anchors are drawn only from things the engine already knows about the
// user: the city they named at onboarding, the languages they actually
// commit in, the repositories they work on. Nothing is inferred and
// nothing new is collected.
// =================================================================

import type { Insight } from "@loomclaw/core-schema";
import type { GraphStore } from "./graph.ts";
import { loadProfile } from "./profile.ts";

export interface Anchor {
  /** The dimension label in this finding that is yours. */
  label: string;
  /** 1-based position in the ranking. */
  rank: number;
  of: number;
  value: number;
  /** Multiple of the median, when that is meaningful. */
  vsTypical: number | null;
  /** Why this counts as yours. */
  because: string;
}

/** Things the engine can honestly call "yours", built from what it already has. */
/**
 * Where the known cities sit, so a city answer also answers for its state
 * and country. Only the cities the feeds actually emit — a world gazetteer
 * would be dead weight and a wrong guess is worse than no anchor.
 */
const CITY_PLACE: Record<string, { state?: string; country: string }> = {
  "new york": { state: "NY", country: "United States" },
  "los angeles": { state: "CA", country: "United States" },
  chicago: { state: "IL", country: "United States" },
  houston: { state: "TX", country: "United States" },
  philadelphia: { state: "PA", country: "United States" },
  boston: { state: "MA", country: "United States" },
  "san francisco": { state: "CA", country: "United States" },
  london: { country: "United Kingdom" },
  tokyo: { country: "Japan" },
  beijing: { country: "China" },
  mumbai: { country: "India" },
  moscow: { country: "Russia" },
  cairo: { country: "Egypt" },
  lagos: { country: "Nigeria" },
  sydney: { country: "Australia" },
  "mexico city": { country: "Mexico" },
  "são paulo": { country: "Brazil" },
};

export function userAnchors(store: GraphStore): Map<string, string> {
  const out = new Map<string, string>();
  const city = loadProfile().home_city;
  if (city) {
    out.set(city.toLowerCase(), "where you live");
    // A state or country answer is still an answer about where you are.
    const place = CITY_PLACE[city.toLowerCase()];
    if (place?.state) out.set(place.state.toLowerCase(), `your state`);
    if (place?.country) out.set(place.country.toLowerCase(), "your country");
  }

  // Languages you actually commit in, and the repos you work on.
  const rows = store.db
    .prepare(`SELECT dim, value FROM observations
               WHERE source_kind = 'git' AND metric IN ('lines_by_language', 'commits_by_repo')
                 AND dim != '' ORDER BY value DESC LIMIT 30`)
    .all() as { dim: string; value: number }[];
  for (const r of rows) out.set(r.dim.toLowerCase(), "something you work in");

  // Apps you actually spend time in.
  const apps = store.db
    .prepare(`SELECT dim FROM observations
               WHERE source_kind = 'screentime' AND metric = 'hours_by_app'
                 AND dim != '' ORDER BY value DESC LIMIT 12`)
    .all() as { dim: string }[];
  for (const a of apps) out.set(a.dim.toLowerCase(), "something you use");

  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

/**
 * Find the reader inside a world finding's ranking.
 *
 * Returns null when the leader is already theirs — saying "and you are 1st"
 * under a headline that just named them adds nothing — and when the finding
 * is about them already.
 */
export function anchorFor(insight: Insight, anchors: Map<string, string>): Anchor | null {
  const pts = insight.evidence.points;
  if (pts.length < 3) return null;
  // Time series have no ranking to sit in.
  if (/^\d{4}-\d{2}-\d{2}T/.test(pts[0]?.label ?? "")) return null;

  const idx = pts.findIndex((p) => anchors.has(p.label.toLowerCase()));
  if (idx <= 0) return null; // not present, or already the headline

  const mine = pts[idx];
  const med = median(pts.map((p) => p.value));
  return {
    label: mine.label,
    rank: idx + 1,
    of: pts.length,
    value: mine.value,
    vsTypical: med > 0 ? mine.value / med : null,
    because: anchors.get(mine.label.toLowerCase())!,
  };
}
