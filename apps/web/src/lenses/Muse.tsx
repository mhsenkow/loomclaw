// =================================================================
// LENS 2 — The Workshop: how each finding was actually made
// =================================================================
// The same nodes as the Weave, grouped by the collector that produced
// them and anchored to the Execution Spine that measured them.
//
// Boards are packed rather than placed on a fixed grid. With twenty-odd
// collectors of wildly different content height, a fixed grid leaves
// half the canvas empty; measuring each board and letting it span the
// rows it needs keeps the canvas dense and scannable.
// =================================================================

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Micro, Sparkline } from "../components/Micro.tsx";
import { DETECTOR_LABEL, type BoardView, type GraphNode, type Insight, type SpineStep } from "../lib/types.ts";

const STATUS_DOT: Record<GraphNode["execution"]["status"], string> = {
  idle: "dot", running: "dot live", blocked_on_human: "dot warn",
  resolved: "dot ok", stale: "dot warn", error: "dot err",
};

function Spine({ steps }: { steps: SpineStep[] }) {
  if (!steps.length) return null;
  const failed = steps.filter((s) => s.status === "failed").length;
  return (
    <details className="spine">
      <summary>
        <span className="beads">
          {steps.slice(0, 16).map((s) => (
            <span key={s.step_id} className={`bead ${s.status}`} title={`${s.tool_name}: ${s.status}`} />
          ))}
        </span>
        <span>{steps.length} step{steps.length === 1 ? "" : "s"}</span>
        {failed > 0 && <span className="spine-failed">{failed} fell back</span>}
      </summary>
      <div className="spine-steps">
        {steps.map((s) => (
          <div key={s.step_id} className={`spine-step ${s.status}`}>
            <span className="tool">{s.tool_name}</span>
            <span className="out" title={s.stdout_preview}>{s.stdout_preview.split("\n")[0]}</span>
            <span className="ms">{s.duration_ms < 1000 ? `${s.duration_ms}ms` : `${(s.duration_ms / 1000).toFixed(1)}s`}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

/** An artifact card: the Weave's story card, scaled to canvas density. */
function Artifact({
  node, insight, repeats = 1, onPin, onOpen,
}: {
  node: GraphNode; insight: Insight | null; repeats?: number;
  onPin: (id: string, pinned: boolean) => void;
  onOpen: (insight: Insight, node: GraphNode) => void;
}) {
  const s = insight?.statistic;
  /*
   * A retired claim stays on the canvas — this is the workshop, and what was
   * superseded is part of how the current answer was reached. But it must not
   * look live: shown identically, a claim the engine has already withdrawn
   * reads as a current finding.
   */
  const stale = node.execution.status === "stale";
  return (
    <article className={`wk-card${node.weave.is_pinned ? " pinned" : ""}${stale ? " stale" : ""}`}>
      <button
        className="wk-card-open"
        onClick={() => insight && onOpen(insight, node)}
        aria-label={insight ? `Open: ${node.title}` : node.title}
      >
        {insight && (
          <div className="wk-card-preview">
            <Micro insight={insight} width={200} height={44} />
            <span className="wk-card-kind">{DETECTOR_LABEL[insight.detector]}</span>
          </div>
        )}
        <div className="wk-card-copy">
          {stale && <span className="wk-superseded">superseded</span>}
          <h4>{node.title}</h4>
          {s && (
            <div className="wk-card-stat">
              <strong>{s.name}</strong>
              <span>{s.value.toFixed(2)} · p={s.p_value.toExponential(0)} · n={s.n}</span>
            </div>
          )}
        </div>
      </button>
      <div className="wk-card-foot">
        <span className="wk-card-meta">
          {repeats > 1 ? `seen ${repeats}×` : "new"}
          {insight && <> <span aria-hidden>·</span> effect {insight.statistic.effect_size.toFixed(1)}</>}
        </span>
        <button
          className={node.weave.is_pinned ? "pin-btn on" : "pin-btn"}
          title={node.weave.is_pinned ? "Unpin from the Weave" : "Pin to the Weave"}
          onClick={() => onPin(node.id, !node.weave.is_pinned)}
        >
          {node.weave.is_pinned ? "★" : "☆"}
        </button>
      </div>
    </article>
  );
}

export function Muse({
  boards, focusBoardId, scopeOf, onPin, onOpen,
}: {
  boards: BoardView[];
  focusBoardId: string | null;
  scopeOf: (kind: string) => "self" | "world";
  onPin: (id: string, pinned: boolean) => void;
  onOpen: (insight: Insight, node: GraphNode) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [spans, setSpans] = useState<Record<string, number>>({});

  // Boards about you come first: this is a tool about you that also
  // watches the world, not a dashboard that happens to include you.
  const ordered = [...boards].sort((a, b) => {
    const ka = a.board.id.replace(/^board_/, ""), kb = b.board.id.replace(/^board_/, "");
    const sa = scopeOf(ka) === "self" ? 0 : 1, sb = scopeOf(kb) === "self" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return b.children.length - a.children.length;
  });

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const next: Record<string, number> = {};
      for (const el of Array.from(grid.children) as HTMLElement[]) {
        const id = el.dataset.id;
        if (!id) continue;
        next[id] = Math.max(8, Math.ceil((el.getBoundingClientRect().height + 10) / 10));
      }
      setSpans(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of Array.from(grid.children)) ro.observe(el);
    return () => ro.disconnect();
  }, [boards]);

  // Charts and sparklines draw async; re-measure once they have.
  useEffect(() => {
    const t = setTimeout(() => setSpans((s) => ({ ...s })), 400);
    return () => clearTimeout(t);
  }, [boards]);

  return (
    <div className="muse">
      <p className="lens-explainer">
        One board per source. Each shows what it reads, what it found this sweep, and the
        steps that measured it — including claims since superseded. Star a card to pin it
        into Findings.
      </p>
      <div className="wk-grid" ref={gridRef}>
        {ordered.map(({ board, children, spine, topics, series }) => {
          const kind = board.id.replace(/^board_/, "");
          const scope = scopeOf(kind);
          return (
            <section
              key={board.id}
              id={`board-${board.id}`}
              data-id={board.id}
              className={`wk-board ${scope} ${focusBoardId === board.id ? "focused" : ""}`}
              style={{ ["--wk-span" as string]: spans[board.id] ?? 30 }}
            >
              <header className="wk-board-head">
                <span className={STATUS_DOT[board.execution.status]} />
                <span className={`scope-pill ${scope}`}>{scope === "self" ? "you" : "world"}</span>
                <h3>{board.title}</h3>
                {series && series.values.length > 1 && (
                  <span className="wk-spark" title={`${series.metric} across ${series.values.length} days`}>
                    <Sparkline values={series.values} width={52} height={15} />
                  </span>
                )}
                <span className="wk-obs" title="Measurements this collector contributed">
                  {board.execution.token_weight > 999
                    ? `${(board.execution.token_weight / 1000).toFixed(1)}k`
                    : board.execution.token_weight}
                </span>
              </header>

              <p className="wk-premise">{board.payload.inline_content}</p>

              <div className="wk-board-body">
                {children.length === 0 ? (
                  <p className="wk-empty">Nothing here cleared the significance floor this sweep.</p>
                ) : (
                  [...children]
                    .sort((a, b) =>
                      Number(a.node.execution.status === "stale") -
                      Number(b.node.execution.status === "stale"))
                    .map(({ node, insight, repeats }) => (
                      <Artifact
                        key={node.id} node={node} insight={insight}
                        repeats={repeats} onPin={onPin} onOpen={onOpen}
                      />
                    ))
                )}
              </div>

              {Object.keys(topics).length > 0 && (
                <div className="wk-topics">
                  {Object.keys(topics).slice(0, 5).map((t) => (
                    <span key={t} className="topic-chip">{t}</span>
                  ))}
                </div>
              )}

              <Spine steps={spine} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
