// =================================================================
// Collectors — personal data, read locally, never transmitted
// =================================================================
// Every collector reads something already on this machine. Nothing is
// uploaded; narration runs on local Ollama. That is not a privacy
// disclaimer bolted on afterwards, it is why the architecture is local
// in the first place.
//
// Unlike a public feed, personal data is HISTORICAL: a git repository
// holds years of real timestamps. Collectors therefore emit observations
// bucketed by the day they actually happened, not by sweep time, so the
// longitudinal detectors have genuine history on the first run.
// =================================================================

import type { Observation } from "../graph.ts";

export type LifeArea = "work" | "attention" | "learning" | "wellbeing" | "environment";

export interface CollectorResult {
  ok: boolean;
  observations: Observation[];
  error?: string;
  /** What the collector read, in plain language, for the provenance line. */
  detail: string;
  duration_ms: number;
}

export interface Collector {
  kind: string;
  label: string;
  area: LifeArea;
  /** What this says about you — shown on the Board header. */
  premise: string;
  /** Where the data physically lives, so it is never a mystery. */
  origin: string;
  units?: Record<string, string>;
  /** Metrics whose cross-sectional ranking is a constant of your life, not news. */
  structural?: string[];
  /** Whether this collector can run at all right now (permissions, files present). */
  available: () => Promise<{ ok: boolean; reason?: string }>;
  collect: (sinceDays: number) => Promise<CollectorResult>;
}

/** Local calendar day for a timestamp — the bucket personal rhythms live in. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T00:00:00.000Z`;
}

/** Readable clock labels — "3 PM" is a fact about your day, "15" is a column. */
export const HOURS = Array.from({ length: 24 }, (_, h) =>
  h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`,
);

export const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/** Build daily observations from timestamped events. */
export function daily(
  kind: string,
  metric: string,
  events: { at: Date; value?: number; dim?: string }[],
  reduce: "count" | "sum" | "mean" = "count",
): Observation[] {
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const e of events) {
    const key = `${dayKey(e.at)}\u0000${e.dim ?? ""}`;
    const b = buckets.get(key) ?? { sum: 0, n: 0 };
    b.sum += e.value ?? 1;
    b.n++;
    buckets.set(key, b);
  }
  return [...buckets].map(([key, b]) => {
    const [observed_at, dim] = key.split("\u0000");
    return {
      source_kind: kind, metric, dim,
      value: reduce === "count" ? b.n : reduce === "sum" ? b.sum : b.sum / b.n,
      observed_at,
    };
  });
}

/**
 * Totals across the whole window, one observation per dimension. Used for
 * "which of these dominates my life" questions, where a per-day breakdown
 * would be too sparse to compare.
 *
 * Stamped at day grain, not sweep time: this is a snapshot that replaces the
 * previous one, and a fresh timestamp per sweep would instead pile up a new
 * copy every few minutes — along with any dimension labels since renamed.
 */
export function totals(
  kind: string,
  metric: string,
  pairs: Map<string, number>,
  _now: string,
  cap = 40,
): Observation[] {
  const observed_at = dayKey(new Date());
  return [...pairs]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([dim, value]) => ({ source_kind: kind, metric, dim, value, observed_at }));
}
