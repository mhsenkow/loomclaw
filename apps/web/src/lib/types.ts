export interface Insight {
  id: string;
  detector: "zscore_outlier" | "trend_break" | "concentration" | "distribution_shift" | "cross_correlation";
  source_kind: string;
  headline: string;
  statistic: { name: string; value: number; effect_size: number; p_value: number; n: number };
  evidence: { points: { label: string; value: number }[]; baseline?: { label: string; value: number }[]; unit?: string };
  vega_spec: Record<string, unknown>;
  score: number;
  detected_at: string;
}

export interface GraphNode {
  id: string;
  parent_board_id: string | null;
  kind: "board" | "source_artifact" | "output_artifact" | "story_beat";
  title: string;
  spatial: { x: number; y: number; width: number; height: number; z_index: number; is_collapsed: boolean };
  weave: {
    is_pinned: boolean; sequence_index: number | null; section_group: string | null;
    layout_variant: string; narrative_annotation?: string;
  };
  execution: {
    status: "idle" | "running" | "blocked_on_human" | "resolved" | "stale" | "error";
    spine_id: string | null; input_hash: string; token_weight: number; last_run_at: string | null;
  };
  payload: { mime_type: string; inline_content?: string; schema_summary?: Record<string, string> };
  created_at: string;
}

export interface SpineStep {
  step_id: string; spine_id: string; sequence: number; tool_name: string;
  input_args: Record<string, unknown>; stdout_preview: string;
  status: "running" | "success" | "failed" | "awaiting_approval";
  duration_ms: number; started_at: string;
}

export interface Beat { node: GraphNode; insight: Insight; relevance: number; rank: number }

export interface BoardView {
  board: GraphNode;
  topics: Record<string, number>;
  /** The board's first scalar metric across sweeps, for the header sparkline. */
  series: { metric: string; values: number[] } | null;
  children: { node: GraphNode; insight: Insight | null; repeats?: number }[];
  spine: SpineStep[];
}

export interface Persona {
  id: string; label: string; goals: string;
  weights: Record<string, number>; uncovered: string[];
}

export interface Status {
  sweeping: boolean;
  last_report: {
    sweep_id: string; duration_ms: number; sources_ok: number;
    sources_failed: { kind: string; error: string }[];
    observations: number; insights_found: number; insights_published: number;
    pinned: number; narrated_via: Record<string, number>;
  } | null;
  observations: number;
  sources: { kind: string; label: string; group: string; premise: string; attribution: string }[];
  openclaw: { ok: boolean; detail: string };
  persona: Persona;
  db: string;
}

export const DETECTOR_LABEL: Record<Insight["detector"], string> = {
  zscore_outlier: "Outlier",
  trend_break: "Trend",
  concentration: "Concentration",
  distribution_shift: "Mix shift",
  cross_correlation: "Correlation",
};
