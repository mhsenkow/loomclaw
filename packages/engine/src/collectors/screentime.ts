// =================================================================
// Screen Time — where your attention actually went
// =================================================================
// Reads macOS's own knowledgeC store read-only. Bundle ids are mapped to
// readable names and to a coarse category, because "com.todesktop.230313…"
// is not an insight about anybody.
// =================================================================

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Collector, CollectorResult } from "./types.ts";
import { HOURS, WEEKDAYS, daily, totals } from "./types.ts";
import { SELF_TOPICS } from "../topics.ts";

const DB = join(homedir(), "Library", "Application Support", "Knowledge", "knowledgeC.db");
/** Core Data epoch: 2001-01-01. */
const APPLE_EPOCH = 978307200;

const NAMES: Record<string, string> = {
  "com.google.Chrome": "Chrome",
  "com.apple.Safari": "Safari",
  "com.todesktop.230313mzl4w4u92": "Cursor",
  "com.microsoft.VSCode": "VS Code",
  "com.anthropic.claudefordesktop": "Claude",
  "com.openai.codex": "Codex",
  "com.hnc.Discord": "Discord",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.apple.Terminal": "Terminal",
  "com.googlecode.iterm2": "iTerm",
  "com.apple.finder": "Finder",
  "com.apple.mail": "Mail",
  "com.spotify.client": "Spotify",
  "com.apple.MobileSMS": "Messages",
  "com.figma.Desktop": "Figma",
  "com.apple.dt.Xcode": "Xcode",
  "com.docker.docker": "Docker",
  "com.apple.systempreferences": "Settings",
  "com.wizards.mtga": "MTG Arena",
  "com.CanOpener.Dungeon-Settlers": "Dungeon Settlers",
};

/** Coarse buckets, so "where did my day go" has an answer above app level. */
const CATEGORY: Record<string, string> = {
  Cursor: "Building", "VS Code": "Building", Xcode: "Building", Terminal: "Building",
  iTerm: "Building", Docker: "Building", Figma: "Building",
  Claude: "AI tools", Codex: "AI tools",
  Chrome: "Browsing", Safari: "Browsing",
  Discord: "Communication", Slack: "Communication", Mail: "Communication", Messages: "Communication",
  "MTG Arena": "Games", "Dungeon Settlers": "Games",
  Spotify: "Media", Finder: "System", Settings: "System",
};

const pretty = (bundle: string) =>
  NAMES[bundle] ?? bundle.split(".").pop()?.replace(/[-_]/g, " ") ?? bundle;

export const screenTimeCollector: Collector = {
  kind: "screentime",
  scope: "self",
  dailyGrain: true,
  topics: SELF_TOPICS["screentime"],
  label: "Where your attention goes",
  area: "attention",
  premise: "Every app session macOS recorded — how long, how often, and at what hour your focus actually landed.",
  origin: "macOS knowledgeC.db (read-only, local)",
  units: {
    screen_hours_per_day: "hours", app_switches_per_day: "switches",
    longest_session_min: "min", hours_by_app: "hours", hours_by_category: "hours",
    days_active_by_hour: "days", hours_by_weekday: "hours",
  },

  available: async () => {
    if (!existsSync(DB)) return { ok: false, reason: "knowledgeC.db not present" };
    try {
      const db = new DatabaseSync(DB, { readOnly: true });
      db.prepare("SELECT 1 FROM ZOBJECT LIMIT 1").get();
      db.close();
      return { ok: true };
    } catch {
      return { ok: false, reason: "knowledgeC.db unreadable — grant Full Disk Access to your terminal" };
    }
  },

  collect: async (sinceDays): Promise<CollectorResult> => {
    const t0 = Date.now();
    try {
      const db = new DatabaseSync(DB, { readOnly: true });
      const cutoff = Date.now() / 1000 - sinceDays * 86400 - APPLE_EPOCH;
      const rows = db.prepare(
        `SELECT ZVALUESTRING AS bundle, ZSTARTDATE AS s, ZENDDATE AS e
           FROM ZOBJECT
          WHERE ZSTREAMNAME = '/app/usage' AND ZSTARTDATE > ? AND ZENDDATE > ZSTARTDATE`,
      ).all(cutoff) as { bundle: string; s: number; e: number }[];
      db.close();

      if (!rows.length) {
        return { ok: false, observations: [], error: "no app-usage rows in window", detail: "", duration_ms: Date.now() - t0 };
      }

      const sessions = rows.map((r) => ({
        app: pretty(r.bundle),
        at: new Date((r.s + APPLE_EPOCH) * 1000),
        mins: (r.e - r.s) / 60,
      }));

      const now = new Date().toISOString();
      const byApp = new Map<string, number>();
      const byCat = new Map<string, number>();
      for (const s of sessions) {
        byApp.set(s.app, (byApp.get(s.app) ?? 0) + s.mins / 60);
        const c = CATEGORY[s.app] ?? "Other";
        byCat.set(c, (byCat.get(c) ?? 0) + s.mins / 60);
      }

      // Longest unbroken session per day: the best available proxy for deep focus.
      const longest = new Map<string, number>();
      for (const s of sessions) {
        const k = new Date(s.at.getFullYear(), s.at.getMonth(), s.at.getDate()).toISOString().slice(0, 10);
        longest.set(k, Math.max(longest.get(k) ?? 0, s.mins));
      }

      return {
        ok: true,
        observations: [
          ...daily("screentime", "screen_hours_per_day", sessions.map((s) => ({ at: s.at, value: s.mins / 60 })), "sum"),
          ...daily("screentime", "app_switches_per_day", sessions.map((s) => ({ at: s.at }))),
          ...[...longest].map(([day, mins]) => ({
            source_kind: "screentime", metric: "longest_session_min", dim: "",
            value: mins, observed_at: `${day}T00:00:00.000Z`,
          })),
          ...totals("screentime", "hours_by_app", byApp, now),
          ...totals("screentime", "hours_by_category", byCat, now, 12),
          // Distinct days per hour, for the same burst reason as git: a single
          // marathon afternoon should not look like an afternoon habit.
          ...totals("screentime", "days_active_by_hour",
            [...sessions.reduce((m, s) => {
              const h = HOURS[s.at.getHours()];
              const day = `${s.at.getFullYear()}-${s.at.getMonth()}-${s.at.getDate()}`;
              (m.get(h) ?? m.set(h, new Set<string>()).get(h)!).add(day);
              return m;
            }, new Map<string, Set<string>>())].reduce((m, [h, days]) => m.set(h, days.size), new Map<string, number>()), now, 24),
          ...totals("screentime", "hours_by_weekday",
            sessions.reduce((m, s) => {
              const k = WEEKDAYS[s.at.getDay()];
              return m.set(k, (m.get(k) ?? 0) + s.mins / 60);
            }, new Map<string, number>()), now, 7),
        ],
        detail: `${sessions.length} app sessions across ${byApp.size} apps`,
        duration_ms: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
    }
  },
};
