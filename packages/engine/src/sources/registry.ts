// =================================================================
// Source registry — societal feeds, reduced to measurable metrics
// =================================================================
// Data plane is Loom's deployed Worker (`loom.ibm.io/api/source/<kind>`),
// which already handles upstream auth, fallbacks, shaping and caching for
// 65+ feeds. We do not re-implement any of that; we subscribe to it.
//
// Each source reduces one poll into `(metric, dim, value)` observations.
// Scalar metrics carry dim ""; everything else is a named dimension, which
// is what lets the cross-sectional detectors compare peers inside a sweep.
// =================================================================

import type { Observation } from "../graph.ts";

export const LOOM_BASE = process.env.LOOM_BASE_URL ?? "https://loom.ibm.io";

export interface SourceDef {
  kind: string;
  label: string;
  /** Sidebar grouping, mirrored from Loom's own source groups. */
  group: "earth" | "cities" | "space" | "web" | "us" | "world";
  /** Why this feed is worth watching — shown on the Board header. */
  premise: string;
  attribution: string;
  /** Units per metric, used in headlines and axis labels. */
  units?: Record<string, string>;
  /**
   * Metrics whose *cross-sectional* shape is a constant of the domain rather
   * than news. Bitcoin outranking every altcoin by price is not a finding; it
   * is the definition of the market. Cross-sectional detectors skip these, but
   * longitudinal ones still run on them — a change over time IS news.
   */
  structural?: string[];
  extract: (payload: unknown, now: string) => Observation[];
}

// ---- shared helpers ----

type Row = unknown[];
interface Tabular { columns: string[]; rows: Row[] }

const isTabular = (p: unknown): p is Tabular =>
  !!p && typeof p === "object" && Array.isArray((p as Tabular).rows) && Array.isArray((p as Tabular).columns);

/** Column accessor by name; returns undefined when the column is absent. */
function col(t: Tabular, name: string) {
  const i = t.columns.indexOf(name);
  return (r: Row) => (i < 0 ? undefined : r[i]);
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Count rows per key, keeping the top `cap` so a long tail can't flood the store. */
function tally(values: (string | null | undefined)[], cap = 40): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    const k = String(v).slice(0, 80);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return new Map([...m].sort((a, b) => b[1] - a[1]).slice(0, cap));
}

function sumBy(pairs: [string | null | undefined, number | null][], cap = 40): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of pairs) {
    if (!k || v === null) continue;
    const key = String(k).slice(0, 80);
    m.set(key, (m.get(key) ?? 0) + v);
  }
  return new Map([...m].sort((a, b) => b[1] - a[1]).slice(0, cap));
}

const obs = (kind: string, metric: string, now: string) =>
  (dim: string, value: number): Observation => ({ source_kind: kind, metric, dim, value, observed_at: now });

function fromMap(kind: string, metric: string, now: string, m: Map<string, number>): Observation[] {
  const mk = obs(kind, metric, now);
  return [...m].map(([dim, v]) => mk(dim, v));
}

const scalar = (kind: string, metric: string, now: string, value: number): Observation => ({
  source_kind: kind, metric, dim: "", value, observed_at: now,
});

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ---- the registry ----

export const SOURCES: SourceDef[] = [
  {
    kind: "usgs",
    label: "Global seismicity",
    group: "earth",
    premise: "Every earthquake on Earth in the past 24h — a baseline for what 'normal' tectonic activity looks like.",
    attribution: "USGS Earthquake Hazards Program",
    units: { event_count: "quakes", max_magnitude: "M", mean_depth_km: "km", count_by_region: "quakes" },
    extract: (p, now) => {
      const feats = (p as { features?: { properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }[] })?.features ?? [];
      if (!feats.length) return [];
      const mags = feats.map((f) => num(f.properties?.mag)).filter((v): v is number => v !== null);
      const depths = feats.map((f) => f.geometry?.coordinates?.[2]).filter((v): v is number => typeof v === "number");
      // "49 km E of Pedro Bay, Alaska" -> "Alaska"
      const regions = feats.map((f) => String(f.properties?.place ?? "").split(",").pop()?.trim() || null);
      return [
        scalar("usgs", "event_count", now, feats.length),
        scalar("usgs", "max_magnitude", now, mags.length ? Math.max(...mags) : 0),
        scalar("usgs", "mean_depth_km", now, mean(depths)),
        ...fromMap("usgs", "count_by_region", now, tally(regions)),
      ];
    },
  },
  {
    kind: "nws",
    label: "US weather alerts",
    group: "us",
    premise: "Active National Weather Service alerts — where the country is under acute environmental stress right now.",
    attribution: "NOAA / National Weather Service",
    units: { alert_count: "alerts", severe_share: "%", count_by_event: "alerts" },
    extract: (p, now) => {
      const feats = (p as { features?: { properties?: Record<string, unknown> }[] })?.features ?? [];
      if (!feats.length) return [];
      const sev = feats.filter((f) => ["Severe", "Extreme"].includes(String(f.properties?.severity))).length;
      return [
        scalar("nws", "alert_count", now, feats.length),
        scalar("nws", "severe_share", now, (sev / feats.length) * 100),
        ...fromMap("nws", "count_by_event", now, tally(feats.map((f) => String(f.properties?.event ?? "")))),
      ];
    },
  },
  {
    kind: "aq",
    label: "World city air quality",
    group: "world",
    premise: "Live PM2.5 and AQI across major world cities — the most direct measure of what people are breathing.",
    attribution: "Open-Meteo Air Quality",
    units: { pm2_5: "µg/m³", european_aqi: "AQI", nitrogen_dioxide: "µg/m³" },
    extract: (p, now) => {
      const cities = (p as { cities?: { name: string; current?: Record<string, unknown> }[] })?.cities ?? [];
      const out: Observation[] = [];
      for (const m of ["pm2_5", "european_aqi", "nitrogen_dioxide"] as const) {
        const mk = obs("aq", m, now);
        for (const c of cities) {
          const v = num(c.current?.[m]);
          if (v !== null) out.push(mk(c.name, v));
        }
      }
      return out;
    },
  },
  {
    kind: "nyc311",
    label: "NYC 311 service requests",
    group: "cities",
    premise: "What a city of 8 million is actually complaining about — the highest-resolution civic signal that exists.",
    attribution: "NYC Open Data",
    units: { request_count: "requests", count_by_complaint: "requests", count_by_agency: "requests", count_by_borough: "requests" },
    // NYPD always receives the most 311 traffic; the agency mix shifting is the signal.
    structural: ["count_by_agency"],
    extract: (p, now) => {
      const rows = Array.isArray(p) ? (p as Record<string, unknown>[]) : [];
      if (!rows.length) return [];
      return [
        scalar("nyc311", "request_count", now, rows.length),
        ...fromMap("nyc311", "count_by_complaint", now, tally(rows.map((r) => String(r.complaint_type ?? "")))),
        ...fromMap("nyc311", "count_by_agency", now, tally(rows.map((r) => String(r.agency ?? "")))),
        ...fromMap("nyc311", "count_by_borough", now, tally(rows.map((r) => String(r.borough ?? r.city ?? "")))),
      ];
    },
  },
  {
    kind: "pageviews",
    label: "Wikipedia attention",
    group: "web",
    premise: "What the public chose to look up yesterday — collective curiosity, ranked.",
    attribution: "Wikimedia REST API",
    units: { views: "views", top10_share: "%" },
    extract: (p, now) => {
      const arts = (p as { items?: { articles?: { article: string; views: number }[] }[] })?.items?.[0]?.articles ?? [];
      // Portal/meta pages drown out everything the public actually searched for.
      const real = arts.filter((a) => !/^(Main_Page|Special:|Wikipedia:|Portal:)/.test(a.article)).slice(0, 50);
      if (!real.length) return [];
      const total = real.reduce((s, a) => s + a.views, 0);
      const top10 = real.slice(0, 10).reduce((s, a) => s + a.views, 0);
      const mk = obs("pageviews", "views", now);
      return [
        scalar("pageviews", "top10_share", now, (top10 / total) * 100),
        ...real.map((a) => mk(a.article.replace(/_/g, " "), a.views)),
      ];
    },
  },
  {
    kind: "crypto",
    label: "Crypto market",
    group: "world",
    premise: "A fully public, 24/7 risk-appetite gauge — useful mostly as a correlate for other signals.",
    attribution: "CoinGecko",
    units: { price_usd: "USD", pct_change_24h: "%", market_cap: "USD" },
    // BTC is permanently the largest by price and cap; only pct_change moves.
    structural: ["price_usd", "market_cap"],
    extract: (p, now) => {
      const coins = Array.isArray(p) ? (p as Record<string, unknown>[]) : [];
      const out: Observation[] = [];
      const mkP = obs("crypto", "price_usd", now);
      const mkC = obs("crypto", "pct_change_24h", now);
      const mkM = obs("crypto", "market_cap", now);
      for (const c of coins.slice(0, 30)) {
        const sym = String(c.symbol ?? "").toUpperCase();
        if (!sym) continue;
        const price = num(c.current_price);
        const pct = num(c.price_change_percentage_24h);
        const cap = num(c.market_cap);
        if (price !== null) out.push(mkP(sym, price));
        if (pct !== null) out.push(mkC(sym, pct));
        if (cap !== null) out.push(mkM(sym, cap));
      }
      return out;
    },
  },
  {
    kind: "faa_delays",
    label: "US air traffic disruption",
    group: "us",
    premise: "Airport-by-airport delays and closures — national mobility friction, updated continuously.",
    attribution: "FAA NAS Status",
    units: { disruption_count: "events", count_by_airport: "events", count_by_reason: "events", avg_delay_min: "min" },
    extract: (p, now) => {
      if (!isTabular(p)) return [];
      const airport = col(p, "airport"), reason = col(p, "reason"), avg = col(p, "avg_delay_min"), maxd = col(p, "max_delay_min");
      const delays = p.rows.map((r) => num(avg(r)) ?? num(maxd(r))).filter((v): v is number => v !== null);
      return [
        scalar("faa_delays", "disruption_count", now, p.rows.length),
        ...(delays.length ? [scalar("faa_delays", "mean_delay_min", now, mean(delays))] : []),
        ...fromMap("faa_delays", "count_by_airport", now, tally(p.rows.map((r) => String(airport(r) ?? "")))),
        // Reasons are long NOTAM strings; the leading code is the useful part.
        ...fromMap("faa_delays", "count_by_reason", now, tally(p.rows.map((r) => String(reason(r) ?? "").split(":")[0].slice(0, 40)))),
      ];
    },
  },
  {
    kind: "fda_recalls",
    label: "FDA enforcement actions",
    group: "us",
    premise: "Food and drug recalls as they are filed — a direct read on consumer-safety failures by firm and state.",
    attribution: "openFDA",
    units: { recall_count: "recalls", count_by_classification: "recalls", count_by_state: "recalls", count_by_product_type: "recalls" },
    extract: (p, now) => {
      if (!isTabular(p)) return [];
      const cls = col(p, "classification"), st = col(p, "state"), pt = col(p, "product_type");
      return [
        scalar("fda_recalls", "recall_count", now, p.rows.length),
        ...fromMap("fda_recalls", "count_by_classification", now, tally(p.rows.map((r) => String(cls(r) ?? "")))),
        ...fromMap("fda_recalls", "count_by_state", now, tally(p.rows.map((r) => String(st(r) ?? "")))),
        ...fromMap("fda_recalls", "count_by_product_type", now, tally(p.rows.map((r) => String(pt(r) ?? "")))),
      ];
    },
  },
  {
    kind: "vehicle_recalls",
    label: "NHTSA vehicle recalls",
    group: "us",
    premise: "Which manufacturers are recalling how many vehicles, and for what failing component.",
    attribution: "NHTSA",
    units: { recall_count: "recalls", affected_by_manufacturer: "vehicles", count_by_component: "recalls" },
    extract: (p, now) => {
      if (!isTabular(p)) return [];
      const mfr = col(p, "manufacturer"), comp = col(p, "component"), aff = col(p, "potentially_affected");
      return [
        scalar("vehicle_recalls", "recall_count", now, p.rows.length),
        ...fromMap("vehicle_recalls", "affected_by_manufacturer", now,
          sumBy(p.rows.map((r) => [String(mfr(r) ?? ""), num(aff(r))]))),
        ...fromMap("vehicle_recalls", "count_by_component", now, tally(p.rows.map((r) => String(comp(r) ?? "")))),
      ];
    },
  },
  {
    kind: "lobbying",
    label: "Federal lobbying filings",
    group: "us",
    premise: "Who is paying whom to influence which policy area — money and intent, disclosed by law.",
    attribution: "US Senate Lobbying Disclosure Act database",
    units: { total_amount_usd: "USD", amount_by_client: "USD", count_by_issue: "filings" },
    extract: (p, now) => {
      if (!isTabular(p)) return [];
      const client = col(p, "client"), amt = col(p, "amount_usd"), issues = col(p, "issue_codes"), state = col(p, "client_state");
      const total = p.rows.reduce((s, r) => s + (num(amt(r)) ?? 0), 0);
      const issueCodes = p.rows.flatMap((r) => String(issues(r) ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      return [
        scalar("lobbying", "filing_count", now, p.rows.length),
        scalar("lobbying", "total_amount_usd", now, total),
        ...fromMap("lobbying", "amount_by_client", now, sumBy(p.rows.map((r) => [String(client(r) ?? ""), num(amt(r))]))),
        ...fromMap("lobbying", "count_by_issue", now, tally(issueCodes)),
        ...fromMap("lobbying", "amount_by_state", now, sumBy(p.rows.map((r) => [String(state(r) ?? ""), num(amt(r))]))),
      ];
    },
  },
  {
    kind: "arxiv",
    label: "arXiv preprints",
    group: "web",
    premise: "Where scientific effort is being spent this week, by field — research attention as a leading indicator.",
    attribution: "arXiv",
    units: { paper_count: "papers", count_by_field: "papers", count_by_category: "papers", mean_authors: "authors" },
    extract: (p, now) => {
      if (!isTabular(p)) return [];
      const field = col(p, "field"), cat = col(p, "primary_category"), na = col(p, "n_authors");
      const authors = p.rows.map((r) => num(na(r))).filter((v): v is number => v !== null);
      return [
        scalar("arxiv", "paper_count", now, p.rows.length),
        scalar("arxiv", "mean_authors", now, mean(authors)),
        ...fromMap("arxiv", "count_by_field", now, tally(p.rows.map((r) => String(field(r) ?? "")))),
        ...fromMap("arxiv", "count_by_category", now, tally(p.rows.map((r) => String(cat(r) ?? "")))),
      ];
    },
  },
  {
    kind: "internet_outages",
    label: "National internet reachability",
    group: "world",
    premise: "Country-level connectivity drops — often the first observable sign of unrest, disaster or state action.",
    attribution: "IODA (Georgia Tech)",
    units: { critical_count: "events", drop_pct_by_country: "%", count_by_country: "events" },
    extract: (p, now) => {
      if (!isTabular(p)) return [];
      const country = col(p, "country"), level = col(p, "level"), drop = col(p, "drop_pct");
      const crit = p.rows.filter((r) => String(level(r)) === "critical");
      return [
        scalar("internet_outages", "event_count", now, p.rows.length),
        scalar("internet_outages", "critical_count", now, crit.length),
        ...fromMap("internet_outages", "count_by_country", now, tally(crit.map((r) => String(country(r) ?? "")))),
        // Worst observed drop per country, not the sum — a sum would reward chatty reporters.
        ...fromMap("internet_outages", "max_drop_pct_by_country", now,
          new Map([...p.rows.reduce((m, r) => {
            const c = String(country(r) ?? ""), d = num(drop(r));
            if (c && d !== null) m.set(c, Math.max(m.get(c) ?? 0, d));
            return m;
          }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 40))),
      ];
    },
  },
  {
    kind: "hn",
    label: "Hacker News front page",
    group: "web",
    premise: "What technologists are collectively surfacing — useful as a discourse-attention proxy.",
    attribution: "HN / Algolia",
    units: { story_count: "stories", mean_points: "points", count_by_domain: "stories" },
    extract: (p, now) => {
      const hits = (p as { hits?: Record<string, unknown>[] })?.hits ?? [];
      if (!hits.length) return [];
      const pts = hits.map((h) => num(h.points)).filter((v): v is number => v !== null);
      const domains = hits.map((h) => {
        try { return new URL(String(h.url)).hostname.replace(/^www\./, ""); } catch { return null; }
      });
      const comments = hits.map((h) => num(h.num_comments)).filter((v): v is number => v !== null);
      return [
        scalar("hn", "story_count", now, hits.length),
        scalar("hn", "mean_points", now, mean(pts)),
        scalar("hn", "mean_comments", now, mean(comments)),
        ...fromMap("hn", "count_by_domain", now, tally(domains)),
      ];
    },
  },
];

export const SOURCE_BY_KIND = new Map(SOURCES.map((s) => [s.kind, s]));

export interface FetchResult {
  kind: string;
  ok: boolean;
  observations: Observation[];
  error?: string;
  duration_ms: number;
  bytes: number;
}

/** One poll of one Loom feed, reduced to observations. Never throws. */
export async function pollSource(def: SourceDef, now: string, timeoutMs = 25_000): Promise<FetchResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${LOOM_BASE}/api/source/${def.kind}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      return { kind: def.kind, ok: false, observations: [], error: `HTTP ${res.status}`, duration_ms: Date.now() - t0, bytes: text.length };
    }
    const json = JSON.parse(text);
    // Loom's worker reports upstream failure in-band rather than as a 5xx.
    if (json && typeof json === "object" && "error" in json && !Array.isArray(json)) {
      return { kind: def.kind, ok: false, observations: [], error: String(json.error), duration_ms: Date.now() - t0, bytes: text.length };
    }
    const observations = def.extract(json, now);
    return { kind: def.kind, ok: true, observations, duration_ms: Date.now() - t0, bytes: text.length };
  } catch (e) {
    return { kind: def.kind, ok: false, observations: [], error: (e as Error).message, duration_ms: Date.now() - t0, bytes: 0 };
  }
}
