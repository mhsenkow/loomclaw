// =================================================================
// The sweep — one full pass of the insight loop
// =================================================================
// poll every source -> record observations -> run detectors -> rank ->
// materialize survivors as graph nodes inside their source's Board ->
// auto-pin the best into the Weave.
//
// Guardrail from the design spec: agent output is never born at an
// arbitrary canvas position. Every node here is created inside a Board
// and anchored to an Execution Spine.
// =================================================================

import { createHash, randomUUID } from "node:crypto";
import type {
  ExecutionSpineStep, Insight, UnifiedGraphNode,
} from "@loomclaw/core-schema";
import type { GraphStore } from "./graph.ts";
import { COLLECTOR_BY_KIND, WINDOW_DAYS, activeCollectors } from "./collectors/index.ts";
import { crossCorrelations, fingerprint, meritOf, runDetectors, scoreInsight } from "./detectors/index.ts";
import { narrate, narrationStep } from "./openclaw.ts";

/**
 * Publication threshold, applied to *merit* rather than score. A claim is
 * published on its statistical strength; novelty then decides its position.
 */
const PIN_MERIT = 0.3;
/** How many top insights per sweep get sent to OpenClaw — the token circuit-breaker. */
const NARRATE_BUDGET = Number(process.env.LOOMCLAW_NARRATE_BUDGET ?? 3);

const BOARD_W = 420, BOARD_H = 300, BOARD_GAP = 60, COLS = 4;

export interface SweepReport {
  sweep_id: string;
  started_at: string;
  duration_ms: number;
  sources_ok: number;
  sources_failed: { kind: string; error: string }[];
  observations: number;
  /** Sources whose payload was identical to last sweep, so nothing was recorded. */
  sources_unchanged: number;
  insights_found: number;
  insights_published: number;
  pinned: number;
  retired: number;
  narrated_via: Record<string, number>;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** One Board per source, laid out on a stable grid so the canvas never reshuffles. */
function ensureBoard(store: GraphStore, kind: string, label: string, premise: string, index: number): string {
  const id = `board_${kind}`;
  const existing = store.getNode(id);
  const node: UnifiedGraphNode = existing ?? {
    id,
    parent_board_id: null,
    kind: "board",
    title: label,
    spatial: {
      x: (index % COLS) * (BOARD_W + BOARD_GAP),
      y: Math.floor(index / COLS) * (BOARD_H + BOARD_GAP * 2),
      width: BOARD_W,
      height: BOARD_H,
      z_index: 0,
      is_collapsed: false,
    },
    weave: { is_pinned: false, sequence_index: null, section_group: null, layout_variant: "inline_card" },
    execution: { status: "idle", spine_id: null, input_hash: "", token_weight: 0, last_run_at: null },
    payload: { mime_type: "text/markdown", inline_content: premise },
    created_at: new Date().toISOString(),
  };
  // Refresh the human-facing copy: a board created under an older label
  // would otherwise keep it forever, since boards are created once.
  node.title = label;
  node.payload.inline_content = premise;
  node.execution.status = "running";
  node.execution.last_run_at = new Date().toISOString();
  store.upsertNode(node);
  return id;
}

/**
 * Un-publish standing claims that no longer pass current validity rules.
 *
 * Tightening a detector has to apply retroactively: a degenerate correlation
 * pinned under the old rules is just as wrong now, and leaving it in the
 * Weave would mean the story quietly contradicts the engine that produced it.
 */
function retireInvalid(store: GraphStore, emit: (e: string, d: unknown) => void): number {
  let retired = 0;
  for (const n of store.allNodes()) {
    if (n.kind !== "output_artifact" || !n.weave.is_pinned || !n.payload.inline_content) continue;
    let ins: Insight;
    try { ins = JSON.parse(n.payload.inline_content) as Insight; } catch { continue; }

    // A record written before the current schema cannot be checked against the
    // current rules. Retire it rather than grandfather it: if it still holds,
    // this very sweep republishes it, and if it does not, it should be gone.
    const unverifiable = typeof ins.metric !== "string" || typeof ins.merit !== "number";

    const invalid =
      unverifiable ||
      // Degenerate or underpowered correlation.
      (ins.detector === "cross_correlation" &&
        (Math.abs(ins.statistic.value) > 0.995 ||
          ins.statistic.n < 20 ||
          // Published before the switch to first differences, so it is a
          // levels correlation between autocorrelated series.
          !ins.statistic.name.includes("first differences"))) ||
      // A metric since marked structural: its cross-sectional ranking is a
      // property of the domain, not a finding.
      (["zscore_outlier", "concentration"].includes(ins.detector) &&
        (COLLECTOR_BY_KIND.get(ins.source_kind)?.structural ?? []).includes(ins.metric)) ||
      // Below the current publication bar.
      ins.merit < PIN_MERIT;
    if (!invalid) continue;

    n.weave.is_pinned = false;
    n.weave.sequence_index = null;
    n.execution.status = "stale";
    store.upsertNode(n);
    emit("node:update", n);
    retired++;
  }
  return retired;
}

export async function runSweep(
  store: GraphStore,
  emit: (event: string, data: unknown) => void = () => {},
): Promise<SweepReport> {
  const sweepId = randomUUID();
  const now = new Date().toISOString();
  const t0 = Date.now();

  const report: SweepReport = {
    sweep_id: sweepId, started_at: now, duration_ms: 0,
    sources_ok: 0, sources_failed: [], observations: 0, sources_unchanged: 0,
    insights_found: 0, insights_published: 0, pinned: 0, retired: 0, narrated_via: {},
  };

  // Only what the profile switched on: an unpicked world feed is never polled.
  const COLLECTORS = activeCollectors();
  emit("sweep:start", { sweep_id: sweepId, sources: COLLECTORS.length });

  // Boards left behind by a collector that no longer exists would otherwise
  // sit on the canvas forever, showing findings nothing can refresh.
  const live = new Set([...COLLECTORS.map((c) => `board_${c.kind}`), "board__cross"]);
  for (const n of store.allNodes()) {
    if (n.kind === "board" && !live.has(n.id)) store.deleteSubtree(n.id);
  }

  store.pruneObservations(COLLECTORS.map((c) => c.kind));
  report.retired = retireInvalid(store, emit);
  const retired = report.retired;
  if (retired) console.log(`[sweep] retired ${retired} claim(s) that no longer pass validity rules`);

  // ---- 1. read every collector in parallel; one failure never stops a sweep ----
  const results = await Promise.all(
    COLLECTORS.map(async (c) => {
      const av = await c.available();
      if (!av.ok) {
        return { ok: false as const, observations: [], error: av.reason ?? "unavailable", detail: "", duration_ms: 0 };
      }
      return c.collect(WINDOW_DAYS);
    }),
  );
  const candidates: { insight: Insight; boardId: string; spineId: string }[] = [];

  for (const [i, def] of COLLECTORS.entries()) {
    const res = results[i];
    const boardId = ensureBoard(store, def.kind, def.label, def.premise, i);
    const spineId = `spine_${def.kind}_${sweepId.slice(0, 8)}`;
    let seq = 0;

    const step = (s: Partial<ExecutionSpineStep> & Pick<ExecutionSpineStep, "tool_name" | "status" | "stdout_preview">) => {
      const full: ExecutionSpineStep = {
        step_id: `step_${randomUUID().slice(0, 8)}`,
        spine_id: spineId,
        sequence: seq++,
        input_args: {},
        duration_ms: 0,
        started_at: new Date().toISOString(),
        ...s,
      } as ExecutionSpineStep;
      store.addSpineStep(full);
      emit("spine:step", full);
      return full;
    };

    step({
      tool_name: "collect",
      input_args: { source: def.origin, window_days: WINDOW_DAYS },
      stdout_preview: res.ok
        ? `${res.detail} -> ${res.observations.length} observations`
        : `unavailable: ${res.error}`,
      status: res.ok ? "success" : "failed",
      duration_ms: res.duration_ms,
    });

    const board = store.getNode(boardId)!;
    board.execution.spine_id = spineId;

    if (!res.ok) {
      report.sources_failed.push({ kind: def.kind, error: res.error ?? "unknown" });
      board.execution.status = "error";
      store.upsertNode(board);
      continue;
    }

    report.sources_ok++;

    // ---- 2. detectors run against history BEFORE the new rows land ----
    const td = Date.now();
    const found = runDetectors(store, def.kind, res.observations, now);

    /*
     * Collectors replay real history every sweep — a git repository holds
     * months of dated commits. Writes are keyed on
     * (source, metric, dim, observed_at), so replaying is idempotent: past
     * days are rewritten identically and today's partial day is corrected as
     * it fills in. That is what lets a trend be real on the first run instead
     * of accumulating one sweep at a time.
     */
    const contentHash = hash(JSON.stringify(res.observations.map((o) => [o.metric, o.dim, o.value])));
    const unchanged = contentHash === store.getNode(boardId)?.execution.input_hash;
    if (unchanged) report.sources_unchanged++;
    store.recordObservations(res.observations);
    report.observations += res.observations.length;

    step({
      tool_name: "detector_scan",
      input_args: {
        detectors: ["zscore_outlier", "concentration", "trend_break", "distribution_shift"],
        observations: res.observations.length,
      },
      stdout_preview:
        (unchanged ? "no change since last sweep\n" : "") +
        (found.length
          ? found.map((f) => `${f.detector}: effect ${f.statistic.effect_size.toFixed(1)}, p=${f.statistic.p_value.toExponential(1)}`).join("\n")
          : "no claim cleared the significance floor"),
      status: "success",
      duration_ms: Date.now() - td,
    });

    report.insights_found += found.length;
    for (const insight of found) candidates.push({ insight, boardId, spineId });

    board.execution.status = found.length ? "resolved" : "idle";
    board.execution.input_hash = contentHash;
    board.execution.token_weight = res.observations.length;
    store.upsertNode(board);
    emit("node:update", board);
  }

  // ---- 3. cross-source correlations, on their own Board ----
  const xBoard = ensureBoard(store, "_cross", "Connections across your life", "Relationships that only appear when two different records of you are lined up on the same days — whether your sleep tracks your output, whether screen time tracks shipping.", COLLECTORS.length);
  const xSpine = `spine_cross_${sweepId.slice(0, 8)}`;
  const tx = Date.now();
  const xFound = crossCorrelations(store, now);
  store.addSpineStep({
    step_id: `step_${randomUUID().slice(0, 8)}`,
    spine_id: xSpine, sequence: 0, tool_name: "cross_correlation_scan",
    input_args: { pairs_tested: "all scalar series across distinct sources", min_r: 0.8 },
    stdout_preview: xFound.length ? `${xFound.length} pair(s) above threshold` : "no pair cleared r>=0.8 at p<0.01",
    status: "success", duration_ms: Date.now() - tx, started_at: new Date().toISOString(),
  });
  report.insights_found += xFound.length;
  for (const insight of xFound) candidates.push({ insight, boardId: xBoard, spineId: xSpine });
  const xb = store.getNode(xBoard)!;
  xb.execution.status = xFound.length ? "resolved" : "idle";
  xb.execution.spine_id = xSpine;
  store.upsertNode(xb);

  // ---- 4. score, de-duplicate, rank ----
  for (const c of candidates) {
    const fp = fingerprint(c.insight);
    const times = store.noteFingerprint(fp, now);
    c.insight.merit = meritOf(c.insight);
    c.insight.score = scoreInsight(c.insight, times);
    /*
     * A claim's node id is derived from its fingerprint, so the same claim
     * occupies the same node across sweeps. Re-detection then updates it in
     * place — the wording refreshes, a manual pin survives, and the canvas
     * never accumulates twins of one finding that differ only in phrasing.
     */
    c.insight.id = `ins_${hash(fp)}`;
  }
  candidates.sort((a, b) => b.insight.score - a.insight.score);

  // ---- 5. frame every publishable insight; only the top few cost tokens ----
  // Local framing is free and instant, so the Weave is never truncated to the
  // agent budget — the budget only decides which claims get an agent's read.
  const narrations = new Map<string, { text: string; via: string }>();
  const publishable = candidates.filter((c) => c.insight.merit >= PIN_MERIT);
  for (const [i, c] of publishable.entries()) {
    const res = await narrate(c.insight, i < NARRATE_BUDGET);
    narrations.set(c.insight.id, { text: res.text, via: res.via });
    report.narrated_via[res.via] = (report.narrated_via[res.via] ?? 0) + 1;
    const stepRec = narrationStep(c.spineId, 90 + i, c.insight, res);
    store.addSpineStep(stepRec);
    emit("spine:step", stepRec);
  }

  // ---- 6. materialize as artifact cards inside their Board ----
  let pinIndex = store.nextWeaveIndex();
  for (const [i, c] of candidates.entries()) {
    const { insight, boardId } = c;
    const shouldPin = insight.merit >= PIN_MERIT && narrations.has(insight.id);

    const prior = store.getNode(insight.id);
    const node: UnifiedGraphNode = {
      id: insight.id,
      parent_board_id: boardId,
      kind: "output_artifact",
      title: insight.headline,
      spatial: {
        x: 24 + (i % 2) * 190,
        y: 92 + Math.floor(i / 2) * 96,
        width: 180, height: 88, z_index: 1, is_collapsed: false,
      },
      weave: {
        // A card you pinned by hand stays pinned even if its score dips.
        is_pinned: shouldPin || (prior?.weave.is_pinned ?? false),
        sequence_index: prior?.weave.sequence_index ?? (shouldPin ? pinIndex++ : null),
        section_group: insight.detector,
        layout_variant: insight.detector === "cross_correlation" ? "side_by_side" : "full_bleed",
        narrative_annotation: narrations.get(insight.id)?.text,
      },
      execution: {
        status: "resolved",
        spine_id: c.spineId,
        input_hash: hash(fingerprint(insight)),
        token_weight: Math.round(insight.headline.length / 4),
        last_run_at: now,
      },
      payload: {
        mime_type: "application/json",
        inline_content: JSON.stringify(insight),
        schema_summary: {
          detector: insight.detector,
          statistic: insight.statistic.name,
          p_value: insight.statistic.p_value.toExponential(2),
          n: String(insight.statistic.n),
          // Who wrote the framing, so the UI can report it per beat rather
          // than only for the most recent sweep.
          framed_by: narrations.get(insight.id)?.via ?? "none",
        },
      },
      created_at: prior?.created_at ?? now,
    };

    store.upsertNode(node);
    store.upsertEdge({
      id: `edge_${boardId}_${insight.id}`,
      source_node_id: boardId,
      target_node_id: insight.id,
      // High-cost LLM edge: stale, not auto-rerun. The design spec's runaway guardrail.
      auto_propagate: false,
    });
    report.insights_published++;
    if (shouldPin) report.pinned++;
    emit("node:update", node);
  }

  /*
   * Anything this sweep did not re-detect is no longer true.
   *
   * Collectors rebuild the full picture from source every sweep, so a claim
   * that still holds is necessarily among this sweep's candidates. One that
   * is absent has been superseded — by changed data, a renamed dimension, or
   * a tightened rule — and leaving it pinned would let the story drift away
   * from the evidence underneath it.
   */
  const fresh = new Set(candidates.map((c) => fingerprint(c.insight)));
  for (const n of store.allNodes()) {
    if (n.kind !== "output_artifact" || !n.weave.is_pinned || !n.payload.inline_content) continue;
    if (n.created_at === now) continue;
    let ins: Insight;
    try { ins = JSON.parse(n.payload.inline_content) as Insight; } catch { continue; }
    if (fresh.has(fingerprint(ins))) continue;
    n.weave.is_pinned = false;
    n.weave.sequence_index = null;
    n.execution.status = "stale";
    store.upsertNode(n);
    report.retired++;
    emit("node:update", n);
  }

  report.duration_ms = Date.now() - t0;
  emit("sweep:done", report);
  return report;
}
