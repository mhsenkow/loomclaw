// =================================================================
// CardControls — the small interactive part of a finding
// =================================================================
// A first gesture at treating each card as a tiny app rather than a
// picture: the evidence is already on the client, so the reader can
// re-cut it without a round trip. Deliberately narrow — a couple of
// controls that genuinely change what the chart shows, chosen by what
// kind of evidence the claim rests on.
// =================================================================

import { useMemo, useState } from "react";
import { Chart } from "./Chart.tsx";
import type { Insight } from "../lib/types.ts";

const ACCENT = "#6a5ce0";
const WARN = "#ffb020";

const BASE = {
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  background: "transparent",
  config: {
    axis: { labelColor: "#9e9eac", titleColor: "#9e9eac", gridColor: "#2a2a30", domainColor: "#2a2a30", labelFontSize: 10, titleFontSize: 10 },
    legend: { labelColor: "#9e9eac", titleColor: "#9e9eac" },
    view: { stroke: "transparent" },
  },
};

/** Ranked evidence (peers) versus a series over time. */
const isRanked = (ins: Insight) =>
  !/^\d{4}-\d{2}-\d{2}T/.test(ins.evidence.points[0]?.label ?? "") &&
  ins.evidence.points.length >= 4;

export function CardControls({ insight, height }: { insight: Insight; height: number }) {
  const ranked = isRanked(insight);
  const [topN, setTopN] = useState(Math.min(12, insight.evidence.points.length));
  const [logScale, setLogScale] = useState(false);
  const [window, setWindow] = useState(insight.evidence.points.length);

  const spec = useMemo(() => {
    const pts = insight.evidence.points;
    const unit = insight.evidence.unit ?? "";
    if (ranked) {
      const vals = pts.slice(0, topN).map((p, i) => ({ ...p, rank: i }));
      return {
        ...BASE,
        data: { values: vals },
        mark: { type: "bar", cornerRadiusEnd: 2 },
        encoding: {
          y: { field: "label", type: "nominal", sort: { field: "rank" }, axis: { title: null, labelLimit: 150 } },
          x: {
            field: "value", type: "quantitative",
            axis: { title: unit || null },
            scale: logScale ? { type: "symlog" } : {},
          },
          color: { condition: { test: "datum.rank === 0", value: WARN }, value: ACCENT },
        },
      };
    }
    const tail = pts.slice(-window);
    return {
      ...BASE,
      data: { values: tail },
      mark: { type: "line", color: ACCENT, point: { filled: true, size: 22, color: ACCENT } },
      encoding: {
        x: { field: "label", type: "temporal", axis: { title: null, format: "%b %d" } },
        y: {
          field: "value", type: "quantitative",
          axis: { title: insight.evidence.unit || null },
          scale: logScale ? { type: "symlog" } : { zero: false },
        },
      },
    };
  }, [insight, ranked, topN, logScale, window]);

  return (
    <div className="card-app">
      <Chart spec={spec} height={height} />
      <div className="card-app-controls">
        {ranked ? (
          <label>
            top
            <input
              type="range" min={3} max={insight.evidence.points.length} value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              aria-label="How many to show"
            />
            <span className="card-app-value">{topN}</span>
          </label>
        ) : (
          <label>
            last
            <input
              type="range" min={Math.min(7, insight.evidence.points.length)} max={insight.evidence.points.length} value={window}
              onChange={(e) => setWindow(Number(e.target.value))}
              aria-label="How many days to show"
            />
            <span className="card-app-value">{window}d</span>
          </label>
        )}
        <button
          aria-pressed={logScale}
          onClick={() => setLogScale((v) => !v)}
          title="Log scale — for evidence that spans orders of magnitude"
        >
          log
        </button>
        <span className="card-app-note">re-cut locally · the statistic above is unchanged</span>
      </div>
    </div>
  );
}
