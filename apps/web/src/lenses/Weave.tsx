// =================================================================
// LENS 1 — The Weave (macro): the story, ranked for your goals
// =================================================================

import { Chart } from "../components/Chart.tsx";
import { DETECTOR_LABEL, type Beat, type Persona } from "../lib/types.ts";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Stat({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="stat-cell">
      <span className="k">{k}</span>
      <span className={strong ? "v strong" : "v"}>{v}</span>
    </div>
  );
}

export function Weave({
  beats, persona, gaps, onZoom,
}: {
  beats: Beat[];
  persona: Persona | null;
  gaps: string[];
  onZoom: (beat: Beat) => void;
}) {
  const topics = Object.entries(persona?.weights ?? {})
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);
  const focused = topics.length > 0 && topics.length < 11;

  return (
    <div className="weave">
      <div className="weave-inner">
        <header className="weave-head">
          <h1>{persona?.label ?? "The Weave"}</h1>
          <p>
            {beats.length} finding{beats.length === 1 ? "" : "s"} that cleared significance, ranked{" "}
            {focused ? "for your goals" : "by statistical strength"}. Every number below was computed
            from live public data before any model saw it.
          </p>
          {focused && (
            <div className="topic-chips" style={{ marginTop: 12 }}>
              {topics.slice(0, 8).map(([t, w]) => (
                <span key={t} className="topic-chip">{t} · {pct(w)}</span>
              ))}
            </div>
          )}
          {persona?.uncovered?.length ? (
            <p style={{ marginTop: 10, color: "var(--loom-warning)" }}>
              Couldn't map that to a topic any feed covers — showing the strongest findings instead.
            </p>
          ) : null}
          {gaps.length > 0 && (
            <p style={{ marginTop: 10, color: "var(--loom-warning)" }}>
              Nothing cleared significance for <strong>{gaps.join(", ")}</strong> this sweep. What follows is
              adjacent, not a substitute — the gap is real, not hidden.
            </p>
          )}
        </header>

        {beats.length === 0 && (
          <div className="empty">
            Nothing has cleared the significance floor yet. Run a sweep, or widen your goals.
          </div>
        )}

        {beats.map((b, i) => {
          const s = b.insight.statistic;
          return (
            <article key={b.node.id} className={i === 0 ? "beat featured" : "beat"}>
              <span className="beat-index">#{i + 1}</span>

              <div className="beat-meta">
                <span className="detector-pill">{DETECTOR_LABEL[b.insight.detector]}</span>
                <span className="source-pill">{b.insight.source_kind}</span>
                {b.relevance > 0 && focused && (
                  <span className="source-pill">· {pct(b.relevance)} goal match</span>
                )}
              </div>

              <h2>{b.insight.headline}</h2>

              <div className="stat-strip">
                <Stat k="statistic" v={s.name} />
                <Stat k="value" v={s.value.toFixed(3)} strong />
                <Stat k="p-value" v={s.p_value < 1e-11 ? "<1e-11" : s.p_value.toExponential(1)} />
                <Stat k="sample" v={`n = ${s.n}`} />
                <Stat k="effect" v={s.effect_size.toFixed(2)} />
              </div>

              <Chart spec={b.insight.vega_spec} height={b.insight.detector === "concentration" ? 190 : 210} />

              {b.node.weave.narrative_annotation && (
                <div className="framing">
                  {b.node.weave.narrative_annotation}
                  <span className="by">Framing only — the statistic above was computed independently</span>
                </div>
              )}

              <div className="beat-foot">
                <span className="provenance">
                  ⚡ {b.insight.evidence.points.length} values · {new Date(b.insight.detected_at).toLocaleTimeString()}
                </span>
                <span className="spacer" />
                <button className="linkish" onClick={() => onZoom(b)}>
                  Zoom into the board that produced this →
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
