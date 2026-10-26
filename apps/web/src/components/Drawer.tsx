import { Chart } from "./Chart.tsx";
import type { GraphNode, Insight } from "../lib/types.ts";

/** Full provenance for one claim — the audit trail behind the headline. */
export function Drawer({
  insight, node, onClose,
}: {
  insight: Insight; node: GraphNode | null; onClose: () => void;
}) {
  const s = insight.statistic;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <h3>{insight.headline}</h3>

        <section>
          <h4>Statistic</h4>
          <dl className="kv">
            <dt>Test</dt><dd>{s.name}</dd>
            <dt>Value</dt><dd>{s.value}</dd>
            <dt>Effect size</dt><dd>{s.effect_size.toFixed(3)}</dd>
            <dt>p-value</dt><dd>{s.p_value.toExponential(3)}</dd>
            <dt>Sample size</dt><dd>{s.n}</dd>
            <dt>Composite score</dt><dd>{insight.score.toFixed(4)}</dd>
            <dt>Detector</dt><dd>{insight.detector}</dd>
            <dt>Source</dt><dd>{insight.source_kind}</dd>
            <dt>Measured at</dt><dd>{new Date(insight.detected_at).toLocaleString()}</dd>
          </dl>
        </section>

        <section>
          <h4>Evidence</h4>
          <Chart spec={insight.vega_spec} height={240} />
        </section>

        {node?.weave.narrative_annotation && (
          <section>
            <h4>Framing</h4>
            <div className="framing">{node.weave.narrative_annotation}</div>
          </section>
        )}

        <section>
          <h4>Values behind the claim</h4>
          <dl className="kv">
            {insight.evidence.points.slice(0, 20).map((p) => (
              <div key={p.label} style={{ display: "contents" }}>
                <dt>{p.label}</dt>
                <dd>{p.value.toLocaleString()} {insight.evidence.unit ?? ""}</dd>
              </div>
            ))}
          </dl>
        </section>
      </aside>
    </>
  );
}
