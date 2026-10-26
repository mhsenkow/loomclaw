// =================================================================
// Interests — the persona layer
// =================================================================
// A person states goals in their own words ("what's happening with food
// safety", "follow the money in politics", "is my city getting worse").
// That text is resolved to topic weights, which multiply insight scores
// and decide what reaches the Weave.
//
// Resolution is keyword-first and fully offline. OpenClaw can refine an
// ambiguous phrase into topics, but it can never invent a topic that has
// no feed behind it — so a goal always maps onto real measurable data or
// is honestly reported as uncovered.
// =================================================================

import type { Insight } from "@loomclaw/core-schema";

export type Topic =
  | "politics" | "money" | "food" | "health" | "safety" | "transport"
  | "environment" | "cities" | "science" | "technology" | "infrastructure";

export const TOPICS: Topic[] = [
  "politics", "money", "food", "health", "safety", "transport",
  "environment", "cities", "science", "technology", "infrastructure",
];

/** Which topics each source can actually speak to, and how directly (0–1). */
export const SOURCE_TOPICS: Record<string, Partial<Record<Topic, number>>> = {
  lobbying:         { politics: 1.0, money: 0.9 },
  fda_recalls:      { food: 1.0, health: 0.9, safety: 0.8 },
  vehicle_recalls:  { safety: 1.0, transport: 0.9 },
  nyc311:           { cities: 1.0, infrastructure: 0.7, safety: 0.5, transport: 0.4 },
  faa_delays:       { transport: 1.0, infrastructure: 0.7 },
  nws:              { environment: 0.9, safety: 0.8 },
  usgs:             { environment: 1.0, safety: 0.6, science: 0.4 },
  aq:               { environment: 1.0, health: 0.9, cities: 0.6 },
  internet_outages: { infrastructure: 1.0, politics: 0.5, technology: 0.6 },
  arxiv:            { science: 1.0, technology: 0.7 },
  hn:               { technology: 1.0, science: 0.4 },
  pageviews:        { politics: 0.4, technology: 0.3, science: 0.3 },
  crypto:           { money: 1.0, technology: 0.4 },
  _cross:           {},  // inherits from whichever pair it spans
};

/** Words that point at a topic. Deliberately plain — this is a router, not a classifier. */
const LEXICON: Record<Topic, string[]> = {
  politics:       ["politic", "government", "congress", "senate", "policy", "lobby", "election", "regulation", "law", "legislat", "influence", "corrupt", "power", "state"],
  money:          ["money", "econom", "financ", "market", "spend", "cost", "price", "inflation", "budget", "fund", "dollar", "wealth", "invest", "capital"],
  food:           ["food", "eat", "diet", "grocer", "nutrition", "restaurant", "agricultur", "produce", "meal", "ingredient", "recall", "contamina"],
  health:         ["health", "medic", "disease", "illness", "hospital", "drug", "pharma", "wellness", "mortal", "safety of", "care"],
  safety:         ["safe", "risk", "danger", "hazard", "accident", "injur", "recall", "warning", "emergenc", "disaster", "crime"],
  transport:      ["transport", "travel", "flight", "airline", "airport", "traffic", "commut", "car", "vehicle", "transit", "road", "drive"],
  environment:    ["environment", "climate", "weather", "pollut", "air quality", "emission", "earthquake", "storm", "flood", "fire", "nature", "ecolog"],
  cities:         ["city", "cities", "urban", "neighborhood", "municipal", "local", "borough", "town", "civic", "resident", "housing"],
  science:        ["science", "scientif", "research", "study", "paper", "academ", "discover", "physics", "biolog", "experiment"],
  technology:     ["tech", "software", "ai", "computer", "internet", "digital", "data", "startup", "engineer", "code", "machine learning"],
  infrastructure: ["infrastructure", "grid", "power", "network", "utility", "bridge", "pipeline", "outage", "broadband", "supply chain", "logistics"],
};

export interface Persona {
  id: string;
  label: string;
  /** The user's goals, in their own words. */
  goals: string;
  /** Resolved weights, 0–1 per topic. */
  weights: Partial<Record<Topic, number>>;
  /** Topics the user asked for that no feed can currently answer. */
  uncovered: string[];
}

/** Shipped starting points — each one exercises a different corner of the data. */
export const PRESET_PERSONAS: { label: string; goals: string }[] = [
  { label: "Follow the money in politics", goals: "I want to track political influence, lobbying money, and which industries are buying policy attention." },
  { label: "What I eat and whether it's safe", goals: "Food safety, recalls, contamination, and anything affecting what ends up on my plate." },
  { label: "My city, day to day", goals: "Urban life: what people complain about, transit, infrastructure failures, air quality where I live." },
  { label: "Where science is heading", goals: "Research attention, what scientists and technologists are working on, emerging fields." },
  { label: "Everything, ranked by strength", goals: "" },
];

/**
 * Match a lexicon stem at a word boundary.
 *
 * Plain substring matching is actively wrong here: "ai" matches "air quality"
 * and tags an environment goal as technology. Anchoring to a word start, and
 * allowing any suffix, keeps stemming ("politic" -> "political", "politics")
 * without the false positives.
 */
function matches(text: string, stem: string): boolean {
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Short stems must match a whole word: a prefix rule would let "ai" match
  // "air quality" and tag an environment goal as technology.
  const pattern = stem.length <= 3 ? `\\b${esc}\\b` : `\\b${esc}`;
  return new RegExp(pattern, "i").test(text);
}

/**
 * Resolve free-text goals into topic weights.
 *
 * Weights come from *rank*, not raw hit counts. A goal about food safety hits
 * both "food" and "safety", and with flat weighting the generic topic ties the
 * specific one — which is how a question about food comes back answered with
 * vehicle recalls. Decaying by rank makes the topic the person actually led
 * with dominate, while keeping its neighbours in play.
 *
 * An empty goal means "no preference": every topic weighted equally, so the
 * feed falls back to pure statistical strength.
 */
const RANK_DECAY = [1, 0.6, 0.42, 0.3, 0.22, 0.16];

export function resolveGoals(goals: string): { weights: Partial<Record<Topic, number>>; uncovered: string[] } {
  const text = goals.toLowerCase().trim();
  const neutral = () => Object.fromEntries(TOPICS.map((t) => [t, 1])) as Partial<Record<Topic, number>>;
  if (!text) return { weights: neutral(), uncovered: [] };

  const hits = TOPICS
    .map((topic) => ({ topic, n: LEXICON[topic].filter((w) => matches(text, w)).length }))
    .filter((h) => h.n > 0)
    .sort((a, b) => b.n - a.n);

  // Nothing matched — rather than silently returning an empty feed, fall back
  // to no-preference and let the UI say the goal wasn't understood.
  if (!hits.length) return { weights: neutral(), uncovered: [text.slice(0, 80)] };

  // Equal hit counts are a genuine tie and share a rank, so neither is demoted.
  const weights: Partial<Record<Topic, number>> = {};
  let rank = 0;
  let prevN = hits[0].n;
  for (const h of hits) {
    if (h.n < prevN) { rank++; prevN = h.n; }
    weights[h.topic] = RANK_DECAY[Math.min(rank, RANK_DECAY.length - 1)];
  }

  // Report requested topics with no feed behind them, so coverage stays honest.
  const covered = new Set(Object.values(SOURCE_TOPICS).flatMap((m) => Object.keys(m)));
  const uncovered = Object.keys(weights).filter((t) => !covered.has(t));
  return { weights, uncovered };
}

export function makePersona(label: string, goals: string): Persona {
  const { weights, uncovered } = resolveGoals(goals);
  return { id: `persona_${Date.now().toString(36)}`, label, goals, weights, uncovered };
}

/**
 * How well an insight serves this persona, 0–1.
 * A cross-source insight takes the best of the two sources it spans, which is
 * what makes "food" surface a food↔weather correlation.
 */
export function relevance(persona: Persona, insight: Insight): number {
  const kinds = insight.source_kind.split("+");
  let best = 0;
  for (const kind of kinds) {
    const topics = SOURCE_TOPICS[kind] ?? {};
    for (const [topic, affinity] of Object.entries(topics)) {
      const w = persona.weights[topic as Topic] ?? 0;
      best = Math.max(best, w * (affinity ?? 0));
    }
  }
  return best;
}

/**
 * Final ranking. Relevance scales the statistic rather than replacing it:
 * a weak finding in your topic still loses to a very strong one next door,
 * but an off-topic finding has to be dramatically stronger to win.
 *
 * Relevance is raised to a power so the middle of the range is penalised —
 * a 50%-related finding should not sit comfortably above a 100%-related one.
 * The small floor keeps one quiet topic from emptying the feed entirely.
 */
export function rankForPersona(persona: Persona, insight: Insight): number {
  return insight.score * (0.08 + 0.92 * relevance(persona, insight) ** 1.6);
}

/**
 * Which of the persona's priorities actually have a finding behind them this
 * sweep. Surfacing the gap is the honest alternative to filling a food
 * question with whatever else happened to clear significance.
 */
export function coverageGaps(persona: Persona, insights: Insight[]): string[] {
  const served = new Set<string>();
  for (const ins of insights) {
    for (const kind of ins.source_kind.split("+")) {
      for (const t of Object.keys(SOURCE_TOPICS[kind] ?? {})) served.add(t);
    }
  }
  return Object.entries(persona.weights)
    .filter(([t, w]) => w >= 0.6 && !served.has(t))
    .map(([t]) => t);
}
