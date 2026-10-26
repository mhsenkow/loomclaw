// =================================================================
// How you work with AI
// =================================================================
// Reads Claude Code's own session transcripts. METADATA ONLY — the
// timestamp, the project and the message count. Prompt text is never read
// into an observation, because none of it would survive as a statistic
// anyway and all of it is private.
// =================================================================

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Collector, CollectorResult } from "./types.ts";
import { HOURS, daily, totals } from "./types.ts";

const ROOT = join(homedir(), ".claude", "projects");

/** "-Users-powerox-loomclaw" -> "loomclaw" */
const projectName = (dir: string) => dir.split("-").filter(Boolean).pop() ?? dir;

export const aiCollector: Collector = {
  kind: "ai",
  label: "How you work with AI",
  area: "learning",
  premise: "Your Claude Code sessions — when you reach for an agent, on which projects, and how long you stay with it.",
  origin: "~/.claude/projects (metadata only; prompt text is never read)",
  units: {
    sessions_per_day: "sessions", messages_per_day: "messages",
    session_minutes: "min", sessions_by_project: "sessions", sessions_by_hour: "sessions",
  },

  available: async () =>
    existsSync(ROOT) ? { ok: true } : { ok: false, reason: "no Claude Code sessions found" },

  collect: async (sinceDays): Promise<CollectorResult> => {
    const t0 = Date.now();
    try {
      const cutoff = Date.now() - sinceDays * 86400_000;
      const projects = await readdir(ROOT, { withFileTypes: true });
      type S = { at: Date; project: string; messages: number; minutes: number };
      const sessions: S[] = [];

      for (const p of projects) {
        if (!p.isDirectory()) continue;
        const dir = join(ROOT, p.name);
        let files: string[];
        try { files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")); } catch { continue; }

        for (const f of files) {
          const path = join(dir, f);
          try {
            const st = await stat(path);
            if (st.mtimeMs < cutoff) continue;
            const text = await readFile(path, "utf8");
            // Only timestamps are parsed out; content is deliberately ignored.
            const stamps: number[] = [];
            let messages = 0;
            for (const line of text.split("\n")) {
              if (!line.startsWith("{")) continue;
              const m = line.match(/"timestamp":"([^"]+)"/);
              if (m) { const t = Date.parse(m[1]); if (Number.isFinite(t)) stamps.push(t); }
              messages++;
            }
            if (!stamps.length) continue;
            const first = Math.min(...stamps), last = Math.max(...stamps);
            if (first < cutoff) continue;
            sessions.push({
              at: new Date(first),
              project: projectName(p.name),
              messages,
              minutes: Math.min((last - first) / 60000, 600),
            });
          } catch { /* a malformed transcript is skipped, not fatal */ }
        }
      }

      if (!sessions.length) {
        return { ok: false, observations: [], error: `no sessions in the last ${sinceDays} days`, detail: "", duration_ms: Date.now() - t0 };
      }

      const now = new Date().toISOString();
      return {
        ok: true,
        observations: [
          ...daily("ai", "sessions_per_day", sessions.map((s) => ({ at: s.at }))),
          ...daily("ai", "messages_per_day", sessions.map((s) => ({ at: s.at, value: s.messages })), "sum"),
          ...daily("ai", "session_minutes", sessions.map((s) => ({ at: s.at, value: s.minutes })), "mean"),
          ...totals("ai", "sessions_by_project",
            sessions.reduce((m, s) => m.set(s.project, (m.get(s.project) ?? 0) + 1), new Map<string, number>()), now),
          ...totals("ai", "sessions_by_hour",
            sessions.reduce((m, s) => {
              const k = HOURS[s.at.getHours()];
              return m.set(k, (m.get(k) ?? 0) + 1);
            }, new Map<string, number>()), now, 24),
        ],
        detail: `${sessions.length} sessions across ${new Set(sessions.map((s) => s.project)).size} projects`,
        duration_ms: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, observations: [], error: (e as Error).message, detail: "", duration_ms: Date.now() - t0 };
    }
  },
};
