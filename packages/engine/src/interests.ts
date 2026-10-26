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
import { describePlace, geoAffinity, placeFromGoals, type Place } from "./geo.ts";
import { COLLECTOR_BY_KIND } from "./collectors/index.ts";

export type Topic =
  | "output" | "rhythm" | "focus" | "balance" | "learning"
  | "projects" | "wellbeing" | "attention";

export const TOPICS: Topic[] = [
  "output", "rhythm", "focus", "balance", "learning",
  "projects", "wellbeing", "attention",
];

/** What each collector can actually tell you about, and how directly (0–1). */
export const SOURCE_TOPICS: Record<string, Partial<Record<Topic, number>>> = {
  git:         { output: 1.0, projects: 0.95, rhythm: 0.9, balance: 0.6 },
  screentime:  { attention: 1.0, focus: 0.95, balance: 0.8, rhythm: 0.7 },
  ai:          { learning: 1.0, output: 0.7, projects: 0.6, rhythm: 0.5 },
  browsing:    { attention: 1.0, focus: 0.8, learning: 0.5 },
  health:      { wellbeing: 1.0, balance: 0.9, rhythm: 0.5, focus: 0.4 },
  environment: { wellbeing: 1.0, balance: 0.4 },
};

/**
 * Words that point at a topic. A router, not a classifier — and written in
 * the language people actually use about themselves ("burning out", "late
 * nights", "distracted"), not in the vocabulary of the metrics.
 */
const LEXICON: Record<Topic, string[]> = {
  output:     ["output", "productive", "productivity", "ship", "shipping", "build", "built", "building", "commit", "work done", "getting done", "accomplish", "deliver"],
  rhythm:     ["rhythm", "when", "time of day", "schedule", "morning", "night", "late", "hour", "pattern", "routine", "consistent", "cadence", "best work"],
  focus:      ["focus", "focused", "deep work", "distract", "distracted", "interrupt", "context switch", "switching", "concentration", "scattered", "flow"],
  balance:    ["balance", "burnout", "burning out", "overwork", "overworking", "rest", "rested", "break", "weekend", "too much", "exhaust", "tired", "sustainable", "health of", "run down", "recover"],
  learning:   ["learn", "learning", "ai", "agent", "claude", "study", "skill", "improve", "growth", "research", "explore"],
  projects:   ["project", "projects", "repo", "repository", "what am i", "working on", "side project", "spread", "juggling", "scattered across"],
  wellbeing:  ["wellbeing", "well-being", "health", "healthy", "air", "sleep", "sleeping", "slept", "body", "environment", "breathing", "feel", "heart", "resting", "steps", "walk", "exercise", "fitness", "recovery", "hrv"],
  attention:  ["attention", "screen time", "screen", "app", "browsing", "scroll", "doomscroll", "waste", "spending time", "where my time", "where does my time"],
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
  /** Where the reader is anchored, when the goals imply one. */
  place: Place | null;
  /** True when "my city" was resolved to a default rather than named outright. */
  place_inferred: boolean;
  /** Human-readable form of `place`, for the UI to state plainly. */
  place_label: string;
}

/** Shipped starting points — each one exercises a different corner of the data. */
export const PRESET_PERSONAS: { label: string; goals: string }[] = [
  { label: "When do I do my best work?", goals: "What time of day and which days I'm most productive — my rhythm, when I ship the most, when I work late." },
  { label: "Where is my attention going?", goals: "Where my screen time and attention actually go, what distracts me, how much I context-switch." },
  { label: "Am I overworking?", goals: "Whether I'm burning out — late nights, weekend work, whether my rest is sustainable." },
  { label: "What am I actually building?", goals: "Which projects and repositories I'm spending myself on, and how scattered I am across them." },
  { label: "Does my sleep affect my work?", goals: "Whether my sleep, resting heart rate and rest show up in how much I ship and how I spend my attention." },
  { label: "Everything, ranked by strength", goals: "" },
];

/**
 * Match a lexicon stem at a word boundary.
 *
 * Plain substring matching is actively wrong here: "ai" matches "air quality"
 * and tags a wellbeing goal as learning. Anchoring to a word start, and
 * allowing any suffix, keeps stemming ("productive" -> "productivity")
 * without the false positives. Stems of three characters or fewer must match
 * a whole word for the same reason.
 */
function matches(text: string, stem: string): boolean {
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  // Personal collectors describe you, not a location; only the air-quality
  // collector is geographic, and it is already pinned to your home city.
  const { place, inferred } = placeFromGoals(goals);
  return {
    id: `persona_${Date.now().toString(36)}`,
    label, goals, weights, uncovered,
    place, place_inferred: inferred, place_label: describePlace(place),
  };
}

/**
 * Where a claim is about.
 *
 * Read from the dimension the claim names when that dimension is a place —
 * this is what lets a world feed produce a local finding — and only otherwise
 * from the source's own footprint. A cross-source claim spans two feeds, so it
 * is placed only when both agree.
 */
export function insightPlace(insight: Insight): Place | null {
  const kinds = insight.source_kind.split("+");
  const metrics = insight.metric?.split("+") ?? [];

  const places = kinds.map((kind, i) => {
    const def = COLLECTOR_BY_KIND.get(kind);
    if (!def) return null;
    // Only the air-quality collector is geographic, and it is already pinned
    // to the home city, so a claim's place is simply where you live or nowhere.
    return def.kind === "environment"
      ? ({ city: process.env.LOOMCLAW_HOME_CITY ?? "New York" } as Place)
      : null;
  });

  if (places.length === 1) return places[0];
  // Two feeds in different places describe no single place.
  const [a, b] = places;
  if (!a || !b) return null;
  if (a.city && b.city && a.city === b.city) return a;
  if (a.country && b.country && a.country === b.country) return { country: a.country };
  return null;
}

/**
 * How well an insight serves this persona, 0–1.
 * A cross-source insight takes the best of the two sources it spans, which is
 * what makes "food" surface a food↔weather correlation.
 */
export function topicRelevance(persona: Persona, insight: Insight): number {
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
 * Combined relevance: the topic match, scaled by how close the claim is to
 * where the reader stands.
 *
 * Geography scales rather than gates. Someone asking about their city still
 * wants to hear about a national recall; they just should not have to scroll
 * past a Pacific earthquake to reach their own borough.
 */
export function relevance(persona: Persona, insight: Insight): number {
  const topic = topicRelevance(persona, insight);
  if (!persona.place) return topic;
  const geo = geoAffinity(persona.place, insightPlace(insight));
  return topic * (0.25 + 0.75 * geo);
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
