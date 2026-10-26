// =================================================================
// LENS 2 — The Muse (micro): the workshop that produced the story
// =================================================================
// The same nodes as the Weave, placed by `spatial.{x,y}` inside their
// Board, each Board anchored to its Execution Spine.
// =================================================================

import { Micro, Sparkline } from "../components/Micro.tsx";
import type { BoardView, GraphNode, Insight, SpineStep } from "../lib/types.ts";

const STATUS_DOT: Record<GraphNode["execution"]["status"], string> = {
  idle: "dot", running: "dot live", blocked_on_human: "dot warn",
  resolved: "dot ok", stale: "dot warn", error: "dot err",
};

function Spine({ steps }: { steps: SpineStep[] }) {
  if (!steps.length) return null;
  return (
    <details className="spine">
      <summary>
        <span className="beads">
          {steps.slice(0, 14).map((s) => (
            <span key={s.step_id} className={`bead ${s.status}`} title={`${s.tool_name}: ${s.status}`} />
          ))}
        </span>
        {steps.length} step{steps.length === 1 ? "" : "s"}
      </summary>
      <div className="spine-steps">
        {steps.map((s) => (
          <div key={s.step_id} className={`spine-step ${s.status}`}>
            <span className="tool">{s.tool_name}</span>
            <span className="out" title={s.stdout_preview}>{s.stdout_preview.split("\n")[0]}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function Artifact({
  node, insight, repeats = 1, onPin, onOpen,
}: {
  node: GraphNode; insight: Insight | null; repeats?: number;
  onPin: (id: string, pinned: boolean) => void;
  onOpen: (insight: Insight, node: GraphNode) => void;
}) {
  return (
    <div className={node.weave.is_pinned ? "artifact pinned" : "artifact"}>
      <div className="artifact-top">
        <button
          className="artifact-title"
          style={{ textAlign: "left", padding: 0 }}
          onClick={() => insight && onOpen(insight, node)}
        >
          {node.title}
        </button>
        {insight && (
          <span className="artifact-micro" title="Shape of the evidence behind this claim">
            <Micro insight={insight} width={74} height={26} />
          </span>
        )}
      </div>
      <div className="artifact-foot">
        <span className="artifact-stat">
          {insight
            ? `${insight.statistic.name.slice(0, 28)} · p=${insight.statistic.p_value.toExponential(0)} · n=${insight.statistic.n}`
            : node.payload.mime_type}
          {repeats > 1 && ` · seen ${repeats}×`}
        </span>
        <button
          className={node.weave.is_pinned ? "pin-btn on" : "pin-btn"}
          title={node.weave.is_pinned ? "Unpin from the Weave" : "Pin to the Weave"}
          onClick={() => onPin(node.id, !node.weave.is_pinned)}
        >
          {node.weave.is_pinned ? "★" : "☆"}
        </button>
      </div>
    </div>
  );
}

export function Muse({
  boards, focusBoardId, onPin, onOpen,
}: {
  boards: BoardView[];
  focusBoardId: string | null;
  onPin: (id: string, pinned: boolean) => void;
  onOpen: (insight: Insight, node: GraphNode) => void;
}) {
  // Boards are tall enough to show their cards; height grows with child count.
  const laid = boards.map((b) => ({
    ...b,
    h: Math.max(b.board.spatial.height, 150 + b.children.length * 58),
  }));
  const width = Math.max(...laid.map((b) => b.board.spatial.x + b.board.spatial.width), 800) + 60;
  const height = Math.max(...laid.map((b) => b.board.spatial.y + b.h), 600) + 60;

  return (
    <div className="muse">
      <div className="canvas" style={{ width, height }}>
        {laid.map(({ board, children, spine, topics, series, h }) => (
          <section
            key={board.id}
            id={`board-${board.id}`}
            className="board"
            style={{
              left: board.spatial.x + 28,
              top: board.spatial.y + 28,
              width: board.spatial.width,
              height: h,
              outline: focusBoardId === board.id ? "2px solid var(--loom-accent)" : undefined,
              outlineOffset: 3,
            }}
          >
            <header className="board-head">
              <span className={STATUS_DOT[board.execution.status]} />
              <span className="board-title">{board.title}</span>
              {series && series.values.length > 1 && (
                <span className="board-spark" title={`${series.metric} across the last ${series.values.length} sweeps`}>
                  <Sparkline values={series.values} width={56} height={16} />
                </span>
              )}
              <span className="board-weight" title="Context weight — tokens this board's inputs would cost">
                {board.execution.token_weight > 999
                  ? `${(board.execution.token_weight / 1000).toFixed(1)}k`
                  : board.execution.token_weight} tok
              </span>
            </header>

            <div className="board-premise">{board.payload.inline_content}</div>

            <div className="board-body">
              {children.length === 0 && (
                <div style={{ fontSize: 10.5, color: "var(--loom-muted)", padding: "6px 2px" }}>
                  No claim cleared the significance floor this sweep.
                </div>
              )}
              {children.map(({ node, insight, repeats }) => (
                <Artifact key={node.id} node={node} insight={insight} repeats={repeats} onPin={onPin} onOpen={onOpen} />
              ))}
            </div>

            {Object.keys(topics).length > 0 && (
              <div style={{ padding: "0 10px 8px", display: "flex", gap: 4, flexWrap: "wrap" }}>
                {Object.keys(topics).slice(0, 4).map((t) => (
                  <span key={t} className="topic-chip">{t}</span>
                ))}
              </div>
            )}

            <Spine steps={spine} />
          </section>
        ))}
      </div>
    </div>
  );
}
