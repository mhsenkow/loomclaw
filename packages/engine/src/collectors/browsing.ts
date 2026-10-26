// =================================================================
// Browsing — domains only, never URLs or page titles
// =================================================================
// Chrome holds its history database locked while running, so it is copied
// to a scratch file and read there. Only the hostname and the visit time
// are extracted; full URLs and titles are discarded before anything is
// stored, because a domain answers "where does my attention go" and a URL
// only adds exposure.
// =================================================================

import { DatabaseSync } from "node:sqlite";
import { copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Collector, CollectorResult } from "./types.ts";
import { HOURS, daily, totals } from "./types.ts";

const SRC = join(homedir(), "Library", "Application Support", "Google", "Chrome", "Default", "History");
/** Chrome timestamps: microseconds since 1601-01-01. */
const CHROME_EPOCH_OFFSET = 11644473600_000_000;

export const browsingCollector: Collector = {
  kind: "browsing",
  label: "Where you read",
  area: "attention",
  premise: "Which domains your browsing actually lands on, and at what hours — the shape of your reading, not its content.",
  origin: "Chrome history (copied read-only; domains kept, URLs and titles discarded)",
  units: {
    visits_per_day: "visits", domains_per_day: "domains",
    visits_by_domain: "visits", visits_by_hour: "visits",
  },

  /*
   * Opt-in, unlike every other collector.
   *
   * Browsing history is the most revealing thing on the machine, and the
   * top-domain card is exactly the kind of finding someone might not want
   * rendered on a screen a colleague can see. Filtering it silently would be
   * both patronising and unreliable, so the collector simply stays off until
   * you ask for it: LOOMCLAW_BROWSING=1.
   */
  available: async () => {
    if (process.env.LOOMCLAW_BROWSING !== "1") {
      return { ok: false, reason: "off by default — browsing history is sensitive; enable with LOOMCLAW_BROWSING=1" };
    }
    return existsSync(SRC) ? { ok: true } : { ok: false, reason: "no Chrome history found" };
  },

  collect: async (sinceDays): Promise<CollectorResult> => {
    const t0 = Date.now();
    const copy = join(tmpdir(), `loomclaw-history-${process.pid}.db`);
    try {
      // Chrome keeps the live file locked; a copy is the standard read path.
      await copyFile(SRC, copy);
      const db = new DatabaseSync(copy, { readOnly: true });
      const cutoff = (Date.now() - sinceDays * 86400_000) * 1000 + CHROME_EPOCH_OFFSET;
      const rows = db.prepare(
        // CAST to REAL: Chrome's microsecond timestamps exceed the safe
        // integer range, and node:sqlite refuses to narrow them silently.
        `SELECT u.url AS url, CAST(v.visit_time AS REAL) AS t
           FROM visits v JOIN urls u ON u.id = v.url
          WHERE v.visit_time > ?`,
      ).all(cutoff) as { url: string; t: number }[];
      db.close();

      // Hostname extracted immediately; the URL never leaves this function.
      const visits: { at: Date; domain: string }[] = [];
      for (const r of rows) {
        let domain: string;
        try { domain = new URL(r.url).hostname.replace(/^www\./, ""); } catch { continue; }
        if (!domain || domain === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(domain)) continue;
        visits.push({ at: new Date((r.t - CHROME_EPOCH_OFFSET) / 1000), domain });
      }

      if (!visits.length) {
        return { ok: false, observations: [], error: "no visits in window", detail: "", duration_ms: Date.now() - t0 };
      }

      const perDayDomains = new Map<string, Set<string>>();
      for (const v of visits) {
        const k = new Date(v.at.getFullYear(), v.at.getMonth(), v.at.getDate()).toISOString().slice(0, 10);
        (perDayDomains.get(k) ?? perDayDomains.set(k, new Set()).get(k)!).add(v.domain);
      }

      const now = new Date().toISOString();
      return {
        ok: true,
        observations: [
          ...daily("browsing", "visits_per_day", visits.map((v) => ({ at: v.at }))),
          ...[...perDayDomains].map(([day, set]) => ({
            source_kind: "browsing", metric: "domains_per_day", dim: "",
            value: set.size, observed_at: `${day}T00:00:00.000Z`,
          })),
          ...totals("browsing", "visits_by_domain",
            visits.reduce((m, v) => m.set(v.domain, (m.get(v.domain) ?? 0) + 1), new Map<string, number>()), now),
          ...totals("browsing", "visits_by_hour",
            visits.reduce((m, v) => {
              const k = HOURS[v.at.getHours()];
              return m.set(k, (m.get(k) ?? 0) + 1);
            }, new Map<string, number>()), now, 24),
        ],
        detail: `${visits.length} visits across ${new Set(visits.map((v) => v.domain)).size} domains`,
        duration_ms: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
    } finally {
      await rm(copy, { force: true }).catch(() => {});
    }
  },
};
