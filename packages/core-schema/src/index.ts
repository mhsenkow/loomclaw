// =================================================================
// LOOM // CLAW — canonical graph contracts
// =================================================================
// One graph, two projections. The Muse canvas renders nodes by
// `spatial.{x,y}` within `parent_board_id`; the Loom weave renders the
// same nodes filtered by `weave.is_pinned` and ordered by
// `weave.sequence_index`. Nothing is duplicated between the lenses.
// =================================================================

export type NodeKind = "board" | "source_artifact" | "output_artifact" | "story_beat";

export type ExecutionStatus =
  | "idle"
  | "running"
  | "blocked_on_human"
  | "resolved"
  | "stale"
  | "error";

export type LayoutVariant = "full_bleed" | "side_by_side" | "inline_card" | "metric_callout";

export type PayloadMime =
  | "text/markdown"
  | "application/vnd.vega.v5+json"
  | "application/parquet"
  | "text/x-python"
  | "application/json";

export interface SpatialProjection {
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  is_collapsed: boolean;
}

export interface WeaveProjection {
  is_pinned: boolean;
  /** Order in the Loom story; null when unpinned. */
  sequence_index: number | null;
  section_group: string | null;
  layout_variant: LayoutVariant;
  /** Framing prose written in the Loom lens — never overwritten by a re-run. */
  narrative_annotation?: string;
}

export interface ExecutionProjection {
  status: ExecutionStatus;
  spine_id: string | null;
  /** SHA-256 of upstream inputs + prompt. Drives staleness. */
  input_hash: string;
  /** Context-window cost of this node, in tokens. */
  token_weight: number;
  last_run_at: string | null;
}

export interface NodePayload {
  mime_type: PayloadMime;
  inline_content?: string;
  fs_path?: string;
  schema_summary?: Record<string, string>;
}

export interface UnifiedGraphNode {
  id: string;
  /** Muse nesting AND OpenClaw context inheritance — the same field. */
  parent_board_id: string | null;
  kind: NodeKind;
  title: string;
  spatial: SpatialProjection;
  weave: WeaveProjection;
  execution: ExecutionProjection;
  payload: NodePayload;
  created_at: string;
}

export interface GraphThreadEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  /** Optional rule applied as data crosses the pipe. */
  transform_prompt?: string;
  /** False by default on high-cost LLM edges — see the runaway-loop guardrail. */
  auto_propagate: boolean;
}

export type SpineStepStatus = "running" | "success" | "failed" | "awaiting_approval";

export interface ExecutionSpineStep {
  step_id: string;
  spine_id: string;
  sequence: number;
  /** e.g. 'loom_fetch', 'duckdb_query', 'zscore_scan', 'openclaw_agent'. */
  tool_name: string;
  input_args: Record<string, unknown>;
  stdout_preview: string;
  status: SpineStepStatus;
  duration_ms: number;
  started_at: string;
}

// ---- Insight layer (what the sweep actually produces) ----

/** Every detector names the statistic it ran, so a claim is auditable. */
export type DetectorKind =
  | "zscore_outlier"
  | "trend_break"
  | "concentration"
  | "distribution_shift"
  | "cross_correlation";

export interface InsightEvidence {
  /** The series the claim is made about, as [label, value] pairs. */
  points: { label: string; value: number }[];
  /** Comparison baseline, when the detector has one. */
  baseline?: { label: string; value: number }[];
  unit?: string;
}

export interface Insight {
  id: string;
  detector: DetectorKind;
  source_kind: string;
  /** The metric the claim is about, so validity can be re-checked later. */
  metric: string;
  /** One-sentence claim, generated deterministically from the statistic. */
  headline: string;
  /** The measured quantity — the thing that makes this analytical, not vibes. */
  statistic: {
    name: string;
    value: number;
    /** Standardized effect size, used for ranking across detectors. */
    effect_size: number;
    /** Rough false-positive probability under the detector's null model. */
    p_value: number;
    /** Sample size behind the statistic. */
    n: number;
  };
  evidence: InsightEvidence;
  /** Vega-Lite spec rendering the evidence. */
  vega_spec: Record<string, unknown>;
  /**
   * 0–1 statistical quality alone: effect size, confidence, sample adequacy and
   * detector depth. Decides whether a claim is worth publishing at all.
   */
  merit: number;
  /** `merit` discounted by novelty. Decides ordering, not publication. */
  score: number;
  detected_at: string;
}

export const SCHEMA_VERSION = 1;
