// =================================================================
// Engine server — graph read API + live event stream + sweep scheduler
// =================================================================

import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Insight, UnifiedGraphNode } from "@loomclaw/core-schema";
import { GraphStore } from "./graph.ts";
import { runSweep, type SweepReport } from "./sweep.ts";
import { SOURCES } from "./sources/registry.ts";
import { openclawStatus } from "./openclaw.ts";
import {
  PRESET_PERSONAS, SOURCE_TOPICS, TOPICS, coverageGaps, makePersona, rankForPersona, relevance,
  type Persona,
} from "./interests.ts";

const PORT = Number(process.env.PORT ?? 7717);
const DB_PATH = process.env.LOOMCLAW_DB ?? join(homedir(), ".loomclaw", "graph.db");
const SWEEP_MS = Number(process.env.LOOMCLAW_SWEEP_MS ?? 15 * 60 * 1000);

const store = new GraphStore(DB_PATH);
let persona: Persona = makePersona(PRESET_PERSONAS[4].label, PRESET_PERSONAS[4].goals);
let lastReport: SweepReport | null = null;
let sweeping = false;

// ---- SSE fan-out ----
const clients = new Set<{ write: (s: string) => void }>();
function emit(event: string, data: unknown) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.write(frame); } catch { clients.delete(c); } }
}

async function sweep(): Promise<SweepReport | { skipped: true }> {
  if (sweeping) return { skipped: true };
  sweeping = true;
  try {
    lastReport = await runSweep(store, emit);
    return lastReport;
  } finally {
    sweeping = false;
  }
}

// ---- projections ----

const insightOf = (n: UnifiedGraphNode): Insight | null => {
  if (n.kind !== "output_artifact" || !n.payload.inline_content) return null;
  try { return JSON.parse(n.payload.inline_content) as Insight; } catch { return null; }
};

/** The Loom lens: pinned nodes, re-ranked for the active persona. */
function weaveProjection() {
  const beats = store
    .allNodes()
    .filter((n) => n.weave.is_pinned)
    .map((n) => {
      const insight = insightOf(n);
      return {
        node: n,
        insight,
        relevance: insight ? relevance(persona, insight) : 0,
        rank: insight ? rankForPersona(persona, insight) : 0,
      };
    })
    .filter((b) => b.insight)
    .sort((a, b) => b.rank - a.rank);

  // Successive sweeps re-detect the same standing condition. Collapse repeats
  // to the newest observation so the story reads as a story, not a log.
  const seen = new Set<string>();
  return beats.filter((b) => {
    const key = `${b.insight!.detector}:${b.insight!.source_kind}:${b.insight!.evidence.points[0]?.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Topics the person asked for that nothing measured this sweep. */
const weaveGaps = (beats: ReturnType<typeof weaveProjection>) =>
  coverageGaps(persona, beats.map((b) => b.insight!).filter(Boolean));

/**
 * A standing condition is re-detected every sweep. Keeping one card per claim
 * — the newest, tagged with how many times it has recurred — is the design
 * spec's "no autonomous canvas sprawl" guardrail: the workshop stays messy by
 * nature, but not duplicated.
 */
function collapseRepeats(children: { node: UnifiedGraphNode; insight: Insight | null }[]) {
  const byClaim = new Map<string, { node: UnifiedGraphNode; insight: Insight | null; repeats: number }>();
  for (const c of children) {
    const key = c.insight
      ? `${c.insight.detector}:${c.insight.evidence.points[0]?.label ?? ""}`
      : c.node.id;
    const prev = byClaim.get(key);
    if (!prev) { byClaim.set(key, { ...c, repeats: 1 }); continue; }
    prev.repeats++;
    // Keep the most recent observation of the claim, and any manual pin on it.
    if (c.node.created_at > prev.node.created_at) {
      byClaim.set(key, { ...c, repeats: prev.repeats, node: { ...c.node, weave: prev.node.weave.is_pinned ? prev.node.weave : c.node.weave } });
    }
  }
  return [...byClaim.values()];
}

/** The Muse lens: every board with its children and spine. */
function museProjection() {
  const nodes = store.allNodes();
  const boards = nodes.filter((n) => n.kind === "board");
  return boards.map((b) => ({
    board: b,
    topics: SOURCE_TOPICS[b.id.replace(/^board_/, "")] ?? {},
    children: collapseRepeats(
      nodes
        .filter((n) => n.parent_board_id === b.id)
        .map((n) => ({ node: n, insight: insightOf(n) })),
    ).sort((x, y) => (y.insight?.score ?? 0) - (x.insight?.score ?? 0)),
    spine: b.execution.spine_id ? store.spine(b.execution.spine_id) : [],
  }));
}

// ---- http ----

const json = (res: import("node:http").ServerResponse, body: unknown, code = 200) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(s);
};

const readBody = (req: import("node:http").IncomingMessage) =>
  new Promise<string>((resolve) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  // --- live event stream ---
  if (url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ sweeping, lastReport })}\n\n`);
    const client = { write: (s: string) => res.write(s) };
    clients.add(client);
    const ka = setInterval(() => { try { res.write(": keepalive\n\n"); } catch {} }, 20_000);
    req.on("close", () => { clearInterval(ka); clients.delete(client); });
    return;
  }

  if (url.pathname === "/api/status") {
    const oc = await openclawStatus();
    return json(res, {
      sweeping,
      last_report: lastReport,
      next_sweep_ms: SWEEP_MS,
      observations: store.observationCount(),
      sources: SOURCES.map((s) => ({ kind: s.kind, label: s.label, group: s.group, premise: s.premise, attribution: s.attribution })),
      openclaw: oc,
      persona,
      db: DB_PATH,
    });
  }

  if (url.pathname === "/api/weave") {
    const beats = weaveProjection();
    return json(res, { persona, beats, gaps: weaveGaps(beats) });
  }
  if (url.pathname === "/api/muse") return json(res, { boards: museProjection(), edges: store.allEdges() });
  if (url.pathname === "/api/personas") return json(res, { presets: PRESET_PERSONAS, topics: TOPICS, active: persona });

  if (url.pathname === "/api/persona" && req.method === "POST") {
    const { label, goals } = JSON.parse((await readBody(req)) || "{}");
    persona = makePersona(String(label ?? "Custom"), String(goals ?? ""));
    emit("persona:change", persona);
    const beats = weaveProjection();
    return json(res, { persona, beats, gaps: weaveGaps(beats) });
  }

  if (url.pathname === "/api/sweep" && req.method === "POST") {
    return json(res, await sweep());
  }

  // Manual pin toggle — the Weave Pin from the design spec.
  if (url.pathname === "/api/pin" && req.method === "POST") {
    const { id, pinned } = JSON.parse((await readBody(req)) || "{}");
    const n = store.getNode(String(id));
    if (!n) return json(res, { error: "no such node" }, 404);
    n.weave.is_pinned = Boolean(pinned);
    n.weave.sequence_index = n.weave.is_pinned ? store.nextWeaveIndex() : null;
    store.upsertNode(n);
    emit("node:update", n);
    return json(res, { node: n });
  }

  if (url.pathname.startsWith("/api/spine/")) {
    return json(res, { steps: store.spine(url.pathname.replace("/api/spine/", "")) });
  }

  return json(res, { error: "not found" }, 404);
});

server.listen(PORT, () => {
  console.log(`[engine] http://localhost:${PORT}  db=${DB_PATH}`);
  console.log(`[engine] ${SOURCES.length} sources · sweep every ${Math.round(SWEEP_MS / 60000)} min`);
  openclawStatus().then((s) =>
    console.log(`[engine] openclaw: ${s.ok ? s.detail : `unavailable (${s.detail}) — using deterministic framing`}`),
  );
  // First sweep immediately so the UI has something real on first paint.
  sweep().then((r) => "skipped" in r || console.log(`[engine] first sweep: ${r.insights_published} insights, ${r.pinned} pinned`));
  setInterval(sweep, SWEEP_MS);
});
