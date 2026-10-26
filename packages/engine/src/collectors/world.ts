// =================================================================
// World feeds as collectors
// =================================================================
// A thin adapter: each validated feed definition becomes a Collector, so
// the sweep, the detectors and the graph treat "what the FAA is reporting"
// exactly like "what you committed". Nothing downstream knows the
// difference, which is what makes a you-versus-world correlation possible
// at all.
// =================================================================

import type { Collector, CollectorResult, LifeArea } from "./types.ts";
import { dayKey } from "./types.ts";
import { WORLD_FEEDS, type SourceDef } from "./world-feeds.ts";
import type { Topic } from "../topics.ts";

const LOOM_BASE = process.env.LOOM_BASE_URL ?? "https://loom.ibm.io";

/** Loom's own grouping mapped onto the life-area vocabulary of the canvas. */
const AREA: Record<SourceDef["group"], LifeArea> = {
  earth: "environment", cities: "society", space: "science",
  web: "science", us: "society", world: "society",
};

function toCollector(def: SourceDef): Collector {
  return {
    kind: def.kind,
    label: def.label,
    area: AREA[def.group] ?? "society",
    scope: "world",
    topics: def.topics as Partial<Record<string, number>>,
    premise: def.premise,
    origin: `${def.attribution} · via loom.ibm.io`,
    units: def.units,
    structural: def.structural,

    available: async () => {
      // A feed is only "available" if the user asked for its topic; the
      // profile decides, so an unwanted feed is never even polled.
      return { ok: true };
    },

    collect: async (): Promise<CollectorResult> => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${LOOM_BASE}/api/source/${def.kind}`, {
          signal: AbortSignal.timeout(25_000),
          headers: { accept: "application/json" },
        });
        const text = await res.text();
        if (!res.ok) {
          return { ok: false, observations: [], error: `HTTP ${res.status}`, detail: "", duration_ms: Date.now() - t0 };
        }
        const json = JSON.parse(text);
        // Loom's worker reports upstream failure in-band rather than as a 5xx.
        if (json && typeof json === "object" && !Array.isArray(json) && "error" in json) {
          return { ok: false, observations: [], error: String(json.error), detail: "", duration_ms: Date.now() - t0 };
        }

        /*
         * World feeds are snapshots, not archives: there is no history to
         * backfill, so each poll is stamped at day grain. The unique index
         * then makes repeated polls within a day idempotent — a feed that
         * updates daily contributes one row a day rather than ninety-six,
         * which is what keeps `n` honest for the longitudinal detectors.
         */
        const stamp = dayKey(new Date());
        const observations = def.extract(json, stamp).map((o) => ({ ...o, observed_at: stamp }));

        return {
          ok: true, observations,
          detail: `${(text.length / 1024).toFixed(1)} KB from ${def.attribution}`,
          duration_ms: Date.now() - t0,
        };
      } catch (e) {
        return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
      }
    },
  };
}

export const WORLD_COLLECTORS: Collector[] = WORLD_FEEDS.map(toCollector);

/** Every topic any world feed can speak to. */
export const WORLD_TOPICS = new Set<Topic>(
  WORLD_FEEDS.flatMap((f) => Object.keys(f.topics) as Topic[]),
);
