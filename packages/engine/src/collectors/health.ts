// =================================================================
// Apple Health — sleep, steps, heart
// =================================================================
// Reads an export you produce on your iPhone (Health -> profile ->
// Export All Health Data). The file never leaves this machine.
//
// Three things make this harder than it looks, and each is handled below:
//   * export.xml is routinely multiple gigabytes, so it is streamed, never
//     read into memory, and the parsed result is cached against the file's
//     size and mtime.
//   * iPhone and Watch both count the same steps. Summing every record
//     double-counts a day, sometimes triples it.
//   * Sleep crosses midnight, so the night you slept belongs to the day you
//     woke up, not the day you lay down.
// =================================================================

import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Observation } from "../graph.ts";
import type { Collector, CollectorResult } from "./types.ts";
import { SELF_TOPICS } from "../topics.ts";

const exec = promisify(execFile);
const CACHE = join(homedir(), ".loomclaw", "health-cache.json");

/** Where people actually leave the export, in the order worth trying. */
const CANDIDATE_DIRS = [
  process.env.LOOMCLAW_HEALTH_EXPORT,
  join(homedir(), "Downloads"),
  join(homedir(), "Desktop"),
  join(homedir(), "Documents"),
  join(homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs", "Downloads"),
].filter(Boolean) as string[];

/** Resolve the export to a readable export.xml, unzipping if needed. */
async function locateExportXml(): Promise<{ path: string; note: string } | null> {
  const direct = process.env.LOOMCLAW_HEALTH_EXPORT;
  if (direct && existsSync(direct)) {
    if (direct.endsWith(".xml")) return { path: direct, note: direct };
    if (direct.endsWith(".zip")) return unzipTo(direct);
    const inner = join(direct, "apple_health_export", "export.xml");
    if (existsSync(inner)) return { path: inner, note: inner };
    const flat = join(direct, "export.xml");
    if (existsSync(flat)) return { path: flat, note: flat };
  }

  for (const dir of CANDIDATE_DIRS) {
    if (!existsSync(dir)) continue;
    const unpacked = join(dir, "apple_health_export", "export.xml");
    if (existsSync(unpacked)) return { path: unpacked, note: unpacked };

    let entries: string[];
    try { entries = await readdir(dir); } catch { continue; }
    const zip = entries.find((f) => /^(export|apple_health_export).*\.zip$/i.test(f));
    if (zip) return unzipTo(join(dir, zip));
  }
  return null;
}

/** Extract just export.xml from the archive into a scratch directory. */
async function unzipTo(zipPath: string): Promise<{ path: string; note: string } | null> {
  const out = join(tmpdir(), "loomclaw-health");
  const xml = join(out, "apple_health_export", "export.xml");
  try {
    const zs = await stat(zipPath);
    // Re-extract only when the archive is newer than what we already unpacked.
    if (existsSync(xml)) {
      const xs = await stat(xml);
      if (xs.mtimeMs >= zs.mtimeMs) return { path: xml, note: `${zipPath} (already extracted)` };
    }
    await mkdir(out, { recursive: true });
    await exec("unzip", ["-o", "-q", zipPath, "apple_health_export/export.xml", "-d", out], {
      timeout: 600_000, maxBuffer: 1024 * 1024,
    });
    return existsSync(xml) ? { path: xml, note: zipPath } : null;
  } catch { return null; }
}

// ---- what we pull out ----

const QUANTITY: Record<string, { metric: string; reduce: "sum" | "mean" | "max" }> = {
  HKQuantityTypeIdentifierStepCount:                 { metric: "steps", reduce: "sum" },
  HKQuantityTypeIdentifierRestingHeartRate:          { metric: "resting_heart_rate", reduce: "mean" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN:  { metric: "hrv_sdnn", reduce: "mean" },
  HKQuantityTypeIdentifierActiveEnergyBurned:        { metric: "active_calories", reduce: "sum" },
  HKQuantityTypeIdentifierAppleExerciseTime:         { metric: "exercise_minutes", reduce: "sum" },
  HKQuantityTypeIdentifierHeartRate:                 { metric: "heart_rate", reduce: "mean" },
};

/** Apple writes "2026-10-25 23:04:00 -0400". */
function parseAppleDate(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7].slice(0, 3)}:${m[7].slice(3)}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Parsed {
  /** metric -> day -> source -> accumulated value */
  bySource: Record<string, Record<string, Record<string, { sum: number; n: number; max: number }>>>;
  /** sleep stage -> day -> hours (already de-duplicated by interval union) */
  sleep: Record<string, Record<string, number>>;
  records: number;
  span: { first: string; last: string } | null;
}

const RECORD_RE =
  /<Record\s+type="([^"]+)"[^>]*?sourceName="([^"]*)"[^>]*?startDate="([^"]+)"\s+endDate="([^"]+)"\s+value="([^"]*)"/g;

/**
 * Stream the export and accumulate per day.
 *
 * Records are matched with a regex rather than a DOM parser because the file
 * is far too large to hold in memory and each <Record/> is self-contained.
 * A tail buffer carries any record split across a chunk boundary.
 */
async function parseExport(path: string): Promise<Parsed> {
  const out: Parsed = { bySource: {}, sleep: {}, records: 0, span: null };
  const sleepIntervals: Record<string, { start: number; end: number }[]> = {};
  let tail = "";
  let firstTs = Infinity, lastTs = -Infinity;

  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(path, { encoding: "utf8", highWaterMark: 4 * 1024 * 1024 });
    rs.on("data", (chunk) => {
      const text = tail + chunk;
      let lastIndex = 0;
      RECORD_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RECORD_RE.exec(text))) {
        lastIndex = RECORD_RE.lastIndex;
        const [, type, source, startRaw, endRaw, valueRaw] = m;
        const start = parseAppleDate(startRaw);
        const end = parseAppleDate(endRaw);
        if (!start || !end) continue;
        out.records++;
        if (start.getTime() < firstTs) firstTs = start.getTime();
        if (end.getTime() > lastTs) lastTs = end.getTime();

        if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
          // Attribute a night to the morning you woke on, not the evening you
          // lay down — otherwise every night is split across two days.
          const stage = valueRaw.includes("InBed") ? "in_bed"
            : valueRaw.includes("Awake") ? "awake"
            : valueRaw.includes("Asleep") ? "asleep"
            : null;
          if (!stage) continue;
          const key = `${stage}\u0000${dayOf(end)}`;
          (sleepIntervals[key] ??= []).push({ start: start.getTime(), end: end.getTime() });
          continue;
        }

        const q = QUANTITY[type];
        if (!q) continue;
        const value = Number(valueRaw);
        if (!Number.isFinite(value)) continue;
        const day = dayOf(start);
        const bucket = ((out.bySource[q.metric] ??= {})[day] ??= {});
        const acc = (bucket[source] ??= { sum: 0, n: 0, max: 0 });
        acc.sum += value;
        acc.n++;
        acc.max = Math.max(acc.max, value);
      }
      // Keep whatever followed the last complete match for the next chunk.
      tail = text.slice(Math.max(lastIndex, text.length - 4096));
    });
    rs.on("error", reject);
    rs.on("end", () => resolve());
  });

  // Union overlapping sleep intervals so an iPhone and a Watch recording the
  // same night cannot add up to sixteen hours of sleep.
  for (const [key, intervals] of Object.entries(sleepIntervals)) {
    const [stage, day] = key.split("\u0000");
    intervals.sort((a, b) => a.start - b.start);
    let total = 0, curStart = intervals[0].start, curEnd = intervals[0].end;
    for (const iv of intervals.slice(1)) {
      if (iv.start <= curEnd) curEnd = Math.max(curEnd, iv.end);
      else { total += curEnd - curStart; curStart = iv.start; curEnd = iv.end; }
    }
    total += curEnd - curStart;
    ((out.sleep[stage] ??= {})[day] = total / 3_600_000);
  }

  if (Number.isFinite(firstTs)) {
    out.span = { first: dayOf(new Date(firstTs)), last: dayOf(new Date(lastTs)) };
  }
  return out;
}

export const healthCollector: Collector = {
  kind: "health",
  scope: "self",
  dailyGrain: true,
  topics: SELF_TOPICS["health"],
  label: "Your body",
  area: "wellbeing",
  premise: "Sleep, steps and heart from Apple Health — the record of how you were actually doing while you did everything else.",
  origin: "Apple Health export on this machine (never uploaded)",
  units: {
    sleep_hours: "hours", time_in_bed: "hours", sleep_efficiency: "%",
    steps: "steps", resting_heart_rate: "bpm", heart_rate: "bpm",
    hrv_sdnn: "ms", active_calories: "kcal", exercise_minutes: "min",
  },

  available: async () => {
    const found = await locateExportXml();
    if (found) return { ok: true };
    return {
      ok: false,
      reason:
        "no Apple Health export found — on your iPhone open Health, tap your photo, " +
        "choose Export All Health Data, AirDrop or save the zip to ~/Downloads, " +
        "then sweep again (or set LOOMCLAW_HEALTH_EXPORT to its path)",
    };
  },

  collect: async (sinceDays): Promise<CollectorResult> => {
    const t0 = Date.now();
    const found = await locateExportXml();
    if (!found) {
      return { ok: false, observations: [], error: "no export found", detail: "", duration_ms: Date.now() - t0 };
    }

    try {
      // Parsing gigabytes on every sweep would be absurd; the result is cached
      // against the file's identity and only recomputed when the export changes.
      const st = await stat(found.path);
      const fingerprint = `${found.path}:${st.size}:${Math.round(st.mtimeMs)}`;
      let parsed: Parsed | null = null;
      try {
        const cached = JSON.parse(await readFile(CACHE, "utf8")) as { fingerprint: string; parsed: Parsed };
        if (cached.fingerprint === fingerprint) parsed = cached.parsed;
      } catch { /* no usable cache */ }

      const fromCache = parsed !== null;
      if (!parsed) {
        parsed = await parseExport(found.path);
        await mkdir(join(homedir(), ".loomclaw"), { recursive: true });
        await writeFile(CACHE, JSON.stringify({ fingerprint, parsed }), "utf8");
      }

      const cutoff = Date.now() - sinceDays * 86400_000;
      const inWindow = (day: string) => new Date(`${day}T12:00:00Z`).getTime() >= cutoff;
      const stamp = (day: string) => `${day}T00:00:00.000Z`;
      const obs: Observation[] = [];

      // Quantities: collapse the devices that recorded the same day.
      for (const [metric, days] of Object.entries(parsed.bySource)) {
        const reduce = Object.values(QUANTITY).find((q) => q.metric === metric)?.reduce ?? "mean";
        for (const [day, sources] of Object.entries(days)) {
          if (!inWindow(day)) continue;
          const perSource = Object.values(sources);
          let value: number;
          if (reduce === "sum") {
            // iPhone and Watch each count the whole day's steps independently,
            // so the day's total is the best-informed single device, not the
            // sum of all of them.
            value = Math.max(...perSource.map((s) => s.sum));
          } else if (reduce === "max") {
            value = Math.max(...perSource.map((s) => s.max));
          } else {
            const n = perSource.reduce((a, s) => a + s.n, 0);
            value = n ? perSource.reduce((a, s) => a + s.sum, 0) / n : 0;
          }
          if (Number.isFinite(value)) obs.push({ source_kind: "health", metric, dim: "", value, observed_at: stamp(day) });
        }
      }

      // Sleep, plus efficiency where both asleep and in-bed exist.
      for (const [day, hours] of Object.entries(parsed.sleep.asleep ?? {})) {
        if (!inWindow(day)) continue;
        obs.push({ source_kind: "health", metric: "sleep_hours", dim: "", value: hours, observed_at: stamp(day) });
        const inBed = parsed.sleep.in_bed?.[day];
        if (inBed && inBed > 0) {
          obs.push({
            source_kind: "health", metric: "sleep_efficiency", dim: "",
            value: Math.min(100, (hours / inBed) * 100), observed_at: stamp(day),
          });
        }
      }
      for (const [day, hours] of Object.entries(parsed.sleep.in_bed ?? {})) {
        if (!inWindow(day)) continue;
        obs.push({ source_kind: "health", metric: "time_in_bed", dim: "", value: hours, observed_at: stamp(day) });
      }

      if (!obs.length) {
        return {
          ok: false, observations: [],
          error: `export parsed (${parsed.records.toLocaleString()} records) but nothing falls in the last ${sinceDays} days` +
            (parsed.span ? ` — it covers ${parsed.span.first} to ${parsed.span.last}` : ""),
          detail: "", duration_ms: Date.now() - t0,
        };
      }

      const days = new Set(obs.map((o) => o.observed_at)).size;
      return {
        ok: true, observations: obs,
        detail: `${parsed.records.toLocaleString()} records${fromCache ? " (cached)" : ""} -> ${days} days of sleep, steps and heart`,
        duration_ms: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
    }
  },
};
