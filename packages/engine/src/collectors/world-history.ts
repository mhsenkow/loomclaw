// =================================================================
// World feeds that can be backfilled
// =================================================================
// The ordinary world feeds are snapshots: one row per day, accumulating
// from the day you switch them on. That makes a you-versus-world
// correlation impossible for the first three weeks, while your own data
// already carries months of history.
//
// These three upstreams expose real archives, so they are fetched as
// series rather than snapshots and the overlap exists immediately. They
// go direct rather than through Loom's worker, which serves today only.
// =================================================================

import type { Collector, CollectorResult } from "./types.ts";
import type { Observation } from "../graph.ts";
import { dayKey } from "./types.ts";

const UA = { "user-agent": "loomclaw/0.1 (personal analytics; local only)" };

const ymd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

const dash = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const stampOf = (iso: string) => `${iso.slice(0, 10)}T00:00:00.000Z`;

async function getJson<T>(url: string, ms = 30_000): Promise<T> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

// =================================================================
// Collective attention — total Wikipedia reading, per day
// =================================================================

export const attentionHistory: Collector = {
  kind: "attention_world",
  label: "What the world reads",
  area: "society",
  scope: "world",
  topics: { culture: 1.0, world: 0.6, politics: 0.3 },
  dailyGrain: true,
  premise: "Total daily pageviews across English Wikipedia — the broadest available measure of collective attention, and one of the few that reaches back far enough to compare against your own months.",
  origin: "Wikimedia REST API (daily aggregate, backfilled)",
  units: { world_pageviews: "views" },

  available: async () => {
    try {
      await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/en.wikipedia/all-access/user/daily/${ymd(new Date(Date.now() - 3 * 864e5))}/${ymd(new Date(Date.now() - 2 * 864e5))}`, 10_000);
      return { ok: true };
    } catch { return { ok: false, reason: "Wikimedia REST API unreachable" }; }
  },

  collect: async (sinceDays): Promise<CollectorResult> => {
    const t0 = Date.now();
    try {
      // Wikimedia lags about two days; asking for today returns nothing.
      const end = new Date(Date.now() - 2 * 864e5);
      const start = new Date(end.getTime() - sinceDays * 864e5);
      const d = await getJson<{ items?: { timestamp: string; views: number }[] }>(
        `https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/en.wikipedia/all-access/user/daily/${ymd(start)}/${ymd(end)}`,
      );
      const items = d.items ?? [];
      if (!items.length) return { ok: false, observations: [], error: "no points returned", detail: "", duration_ms: Date.now() - t0 };

      const observations: Observation[] = items.map((i) => ({
        source_kind: "attention_world", metric: "world_pageviews", dim: "",
        value: i.views,
        // timestamp is YYYYMMDDHH
        observed_at: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}T00:00:00.000Z`,
      }));
      return {
        ok: true, observations,
        detail: `${items.length} days of global Wikipedia reading`,
        duration_ms: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
    }
  },
};

// =================================================================
// Seismicity — real earthquakes per day, not a 24h snapshot
// =================================================================

export const seismicHistory: Collector = {
  kind: "seismic_world",
  label: "What the Earth is doing",
  area: "environment",
  scope: "world",
  topics: { environment: 1.0, world: 0.6, science: 0.4, safety: 0.5 },
  dailyGrain: true,
  premise: "Significant earthquakes per day worldwide, as a real series rather than today's snapshot — a physical process with no plausible connection to how you work, which makes it a useful control.",
  origin: "USGS FDSN event API (M4.5+, backfilled)",
  units: { quakes_per_day: "quakes", max_magnitude: "M" },

  available: async () => {
    try {
      await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/count?starttime=${dash(new Date(Date.now() - 2 * 864e5))}&endtime=${dash(new Date(Date.now() - 864e5))}&minmagnitude=4.5&format=geojson`, 10_000);
      return { ok: true };
    } catch { return { ok: false, reason: "USGS FDSN API unreachable" }; }
  },

  collect: async (sinceDays): Promise<CollectorResult> => {
    const t0 = Date.now();
    try {
      const end = new Date();
      const start = new Date(end.getTime() - sinceDays * 864e5);
      // One request for the whole window; bucketed into days here.
      const d = await getJson<{ features?: { properties?: { time?: number; mag?: number } }[] }>(
        `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${dash(start)}&endtime=${dash(end)}` +
        `&minmagnitude=4.5&orderby=time&limit=20000`,
        60_000,
      );
      const feats = d.features ?? [];
      if (!feats.length) return { ok: false, observations: [], error: "no events returned", detail: "", duration_ms: Date.now() - t0 };

      const perDay = new Map<string, { n: number; max: number }>();
      for (const f of feats) {
        const t = f.properties?.time;
        if (typeof t !== "number") continue;
        const key = dayKey(new Date(t));
        const b = perDay.get(key) ?? { n: 0, max: 0 };
        b.n++;
        b.max = Math.max(b.max, f.properties?.mag ?? 0);
        perDay.set(key, b);
      }

      const observations: Observation[] = [];
      for (const [observed_at, b] of perDay) {
        observations.push({ source_kind: "seismic_world", metric: "quakes_per_day", dim: "", value: b.n, observed_at });
        observations.push({ source_kind: "seismic_world", metric: "max_magnitude", dim: "", value: b.max, observed_at });
      }
      return {
        ok: true, observations,
        detail: `${feats.length} events over ${perDay.size} days`,
        duration_ms: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
    }
  },
};

// =================================================================
// Risk appetite — a daily market series
// =================================================================

export const marketHistory: Collector = {
  kind: "market_world",
  label: "What money is doing",
  area: "markets",
  scope: "world",
  topics: { money: 1.0, technology: 0.3, world: 0.4 },
  dailyGrain: true,
  premise: "Daily crypto price and volume — a continuously traded, fully public risk-appetite gauge, useful mainly as something to correlate other series against.",
  origin: "CoinGecko market chart (daily, backfilled)",
  units: { btc_price: "USD", btc_volume: "USD" },

  available: async () => {
    try {
      await getJson("https://api.coingecko.com/api/v3/ping", 10_000);
      return { ok: true };
    } catch { return { ok: false, reason: "CoinGecko unreachable (free tier rate-limits)" }; }
  },

  collect: async (sinceDays): Promise<CollectorResult> => {
    const t0 = Date.now();
    try {
      // The free tier caps daily granularity at 365 days.
      const days = Math.min(sinceDays, 364);
      const d = await getJson<{ prices?: [number, number][]; total_volumes?: [number, number][] }>(
        `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`,
      );
      const prices = d.prices ?? [];
      if (!prices.length) return { ok: false, observations: [], error: "no points returned", detail: "", duration_ms: Date.now() - t0 };

      const observations: Observation[] = [];
      for (const [ms, v] of prices) {
        observations.push({ source_kind: "market_world", metric: "btc_price", dim: "", value: v, observed_at: dayKey(new Date(ms)) });
      }
      for (const [ms, v] of d.total_volumes ?? []) {
        observations.push({ source_kind: "market_world", metric: "btc_volume", dim: "", value: v, observed_at: dayKey(new Date(ms)) });
      }
      return {
        ok: true, observations,
        detail: `${prices.length} days of daily price and volume`,
        duration_ms: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
    }
  },
};

export const HISTORY_COLLECTORS: Collector[] = [attentionHistory, seismicHistory, marketHistory];
