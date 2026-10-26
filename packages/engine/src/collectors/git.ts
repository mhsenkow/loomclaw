// =================================================================
// Your own commit history, across every repository on this machine
// =================================================================
// Most repositories here are forks of other people's work, so filtering
// to your identity is not a refinement — without it this measures
// strangers. Identities are discovered from git config and can be
// overridden with LOOMCLAW_ME.
// =================================================================

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { basename, dirname } from "node:path";
import type { Collector, CollectorResult } from "./types.ts";
import { HOURS, WEEKDAYS, daily, totals } from "./types.ts";

const exec = promisify(execFile);

const run = async (cmd: string, args: string[], cwd?: string, timeout = 20_000) => {
  try {
    const { stdout } = await exec(cmd, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch { return ""; }
};

/** Your git identities. Explicit override wins; otherwise git's own config. */
async function identities(): Promise<string[]> {
  const override = process.env.LOOMCLAW_ME;
  if (override) return override.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const email = (await run("git", ["config", "--global", "user.email"])).trim().toLowerCase();
  const out = new Set<string>();
  if (email) {
    out.add(email);
    // Work and personal addresses usually share a surname; catch the obvious pair.
    const local = email.split("@")[0];
    if (local.length > 4) out.add(local);
  }
  return [...out];
}

let repoCache: string[] | null = null;
async function repos(): Promise<string[]> {
  if (repoCache) return repoCache;
  const root = process.env.LOOMCLAW_CODE_ROOT ?? homedir();
  const out = await run("find", [root, "-maxdepth", "3", "-name", ".git", "-type", "d"], undefined, 30_000);
  repoCache = out.split("\n")
    .filter((l) => l.trim() && !l.includes("/Library/"))
    .map((l) => dirname(l.trim()));
  return repoCache;
}

/** Map a changed file to the language it represents. */
const LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", rs: "Rust", go: "Go", swift: "Swift", java: "Java", kt: "Kotlin",
  rb: "Ruby", php: "PHP", c: "C", h: "C", cpp: "C++", cs: "C#", sh: "Shell",
  css: "CSS", scss: "CSS", html: "HTML", md: "Markdown", json: "Config",
  yml: "Config", yaml: "Config", toml: "Config", sql: "SQL",
};

export const gitCollector: Collector = {
  kind: "git",
  label: "What you build",
  area: "work",
  premise: "Every commit you have authored, across every repository on this machine — when you work, on what, and in what rhythm.",
  origin: "git history in ~ (local only)",
  units: {
    commits_per_day: "commits", repos_per_day: "repos", lines_per_day: "lines",
    late_night_share: "%", message_length: "chars",
    commits_by_repo: "commits", commits_by_hour: "commits",
    commits_by_weekday: "commits", lines_by_language: "lines",
  },

  available: async () => {
    const me = await identities();
    if (!me.length) return { ok: false, reason: "no git identity configured (set user.email or LOOMCLAW_ME)" };
    return { ok: true };
  },

  collect: async (sinceDays): Promise<CollectorResult> => {
    const t0 = Date.now();
    const me = await identities();
    if (!me.length) {
      return { ok: false, observations: [], error: "no git identity", detail: "", duration_ms: Date.now() - t0 };
    }

    const all = await repos();
    const since = `${sinceDays} days ago`;
    const SEP = "\u0001";

    type Commit = { at: Date; repo: string; msgLen: number; files: string[]; added: number };
    const commits: Commit[] = [];

    // Repositories are independent; reading them in parallel keeps a sweep
    // over ~70 repos near a second rather than a minute.
    await Promise.all(all.map(async (repo) => {
      const log = await run("git", [
        "-C", repo, "log", `--since=${since}`,
        `--pretty=format:${SEP}%ae%x02%at%x02%s`, "--numstat", "--no-merges",
      ]);
      if (!log) return;

      for (const chunk of log.split(SEP)) {
        if (!chunk.trim()) continue;
        const [header, ...statLines] = chunk.split("\n");
        const [email, at, subject = ""] = header.split("\u0002");
        if (!email || !me.some((m) => email.toLowerCase().includes(m))) continue;
        const ts = Number(at) * 1000;
        if (!Number.isFinite(ts)) continue;

        let added = 0;
        const files: string[] = [];
        for (const l of statLines) {
          const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (!m) continue;
          if (m[1] !== "-") added += Number(m[1]);
          files.push(m[3]);
        }
        commits.push({ at: new Date(ts), repo: basename(repo), msgLen: subject.length, files, added });
      }
    }));

    if (!commits.length) {
      return {
        ok: false, observations: [],
        error: `no commits by ${me.join(", ")} in the last ${sinceDays} days across ${all.length} repositories`,
        detail: "", duration_ms: Date.now() - t0,
      };
    }

    const now = new Date().toISOString();
    const obs = [
      // --- daily series: the rhythm ---
      ...daily("git", "commits_per_day", commits.map((c) => ({ at: c.at }))),
      ...daily("git", "lines_per_day", commits.map((c) => ({ at: c.at, value: c.added })), "sum"),
      ...daily("git", "message_length", commits.map((c) => ({ at: c.at, value: c.msgLen })), "mean"),
      // Work after midnight and before 05:00 is the clearest signal of a bad week.
      ...daily("git", "late_night_share",
        commits.map((c) => ({ at: c.at, value: c.at.getHours() < 5 ? 100 : 0 })), "mean"),
      // --- cross-sectional: the shape ---
      ...totals("git", "commits_by_repo", tallyBy(commits, (c) => c.repo), now),
      ...totals("git", "commits_by_hour", tallyBy(commits, (c) => HOURS[c.at.getHours()]), now, 24),
      ...totals("git", "commits_by_weekday", tallyBy(commits, (c) => WEEKDAYS[c.at.getDay()]), now, 7),
      ...totals("git", "lines_by_language", sumBy(commits.flatMap((c) =>
        c.files.map((f) => [LANG[f.split(".").pop()?.toLowerCase() ?? ""] ?? null, 1] as [string | null, number]),
      )), now),
    ];

    // Distinct repositories touched per day — a breadth measure, not volume.
    const perDayRepos = new Map<string, Set<string>>();
    for (const c of commits) {
      const k = new Date(c.at.getFullYear(), c.at.getMonth(), c.at.getDate()).toISOString().slice(0, 10);
      (perDayRepos.get(k) ?? perDayRepos.set(k, new Set()).get(k)!).add(c.repo);
    }
    for (const [day, set] of perDayRepos) {
      obs.push({ source_kind: "git", metric: "repos_per_day", dim: "", value: set.size, observed_at: `${day}T00:00:00.000Z` });
    }

    return {
      ok: true, observations: obs,
      detail: `${commits.length} commits by ${me[0]} across ${new Set(commits.map((c) => c.repo)).size} repositories`,
      duration_ms: Date.now() - t0,
    };
  },
};

function tallyBy<T>(xs: T[], key: (x: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) { const k = key(x); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

function sumBy(pairs: [string | null, number][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of pairs) { if (k) m.set(k, (m.get(k) ?? 0) + v); }
  return m;
}
