// =================================================================
// The air where you live
// =================================================================
// The one collector that reaches outside this machine, and the reason the
// geographic scoping exists: a world feed becomes personal the moment it
// is filtered to the city you are actually breathing in. Served by the
// user's own deployed Loom worker.
// =================================================================

import type { Collector, CollectorResult } from "./types.ts";
import { dayKey, totals } from "./types.ts";
import { SELF_TOPICS } from "../topics.ts";

const LOOM_BASE = process.env.LOOM_BASE_URL ?? "https://loom.ibm.io";
const HOME_CITY = process.env.LOOMCLAW_HOME_CITY ?? "New York";

export const environmentCollector: Collector = {
  kind: "environment",
  scope: "self",
  topics: SELF_TOPICS["environment"],
  label: "The air where you live",
  area: "wellbeing",
  premise: `Air quality in ${HOME_CITY} — the one environmental measure that acts on you directly, every hour, whether or not you notice it.`,
  origin: `loom.ibm.io air-quality feed, filtered to ${HOME_CITY}`,
  units: {
    pm2_5: "µg/m³", european_aqi: "AQI", nitrogen_dioxide: "µg/m³",
    aqi_vs_world: "AQI",
  },
  // The peer list exists to give your own number a reference point. Which
  // *other* city happens to top it is not a finding about you, so it is
  // excluded from cross-sectional tests; your city's own readings are not.
  structural: ["aqi_vs_world"],

  available: async () => {
    try {
      const r = await fetch(`${LOOM_BASE}/api/source/aq`, { signal: AbortSignal.timeout(8_000) });
      return r.ok ? { ok: true } : { ok: false, reason: `Loom worker returned ${r.status}` };
    } catch {
      return { ok: false, reason: "Loom worker unreachable (this is the only collector needing network)" };
    }
  },

  collect: async (): Promise<CollectorResult> => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${LOOM_BASE}/api/source/aq`, { signal: AbortSignal.timeout(20_000) });
      const json = (await res.json()) as { cities?: { name: string; current?: Record<string, unknown> }[] };
      const cities = json.cities ?? [];
      const home = cities.find((c) => c.name.toLowerCase() === HOME_CITY.toLowerCase());
      if (!home?.current) {
        return {
          ok: false, observations: [],
          error: `${HOME_CITY} is not in the air-quality feed (set LOOMCLAW_HOME_CITY to one of: ${cities.map((c) => c.name).join(", ")})`,
          detail: "", duration_ms: Date.now() - t0,
        };
      }

      const today = dayKey(new Date());
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const obs = [];
      for (const m of ["pm2_5", "european_aqi", "nitrogen_dioxide"] as const) {
        const v = num(home.current[m]);
        if (v !== null) obs.push({ source_kind: "environment", metric: m, dim: "", value: v, observed_at: today });
      }

      // Your city against the others, so the number has a reference point.
      const peers = new Map<string, number>();
      for (const c of cities) {
        const v = num(c.current?.european_aqi);
        if (v !== null) peers.set(c.name, v);
      }
      obs.push(...totals("environment", "aqi_vs_world", peers, today, 20));

      return {
        ok: true, observations: obs,
        detail: `${HOME_CITY}: AQI ${home.current.european_aqi}, PM2.5 ${home.current.pm2_5} µg/m³`,
        duration_ms: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
    }
  },
};
