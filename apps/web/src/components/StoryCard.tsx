// =================================================================
// StoryCard — one finding, evidence first
// =================================================================
// The chart sits above the words on purpose: the shape of the evidence
// is the claim, and the headline only names it. Ported from Loom's
// Discover card so the two products read alike.
// =================================================================

import { Chart } from "./Chart.tsx";
import { Micro } from "./Micro.tsx";
import { CardControls } from "./CardControls.tsx";
import { DETECTOR_LABEL, type Beat } from "../lib/types.ts";
import type { Density, Tier } from "../lib/browseState.ts";

const SCOPE_LABEL: Record<string, string> = { self: "you", world: "world", both: "you × world" };

const PREVIEW_HEIGHT: Record<Tier, number> = { lead: 230, wide: 180, standard: 150, brief: 110 };

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
};

export function StoryCard({
  beat, tier, density, featured, layout, onOpen,
}: {
  beat: Beat;
  tier: Tier;
  density: Density;
  featured: boolean;
  layout: string;
  onOpen: (beat: Beat) => void;
}) {
  const { insight, node } = beat;
  const s = insight.statistic;
  const scope = beat.scope ?? "self";
  // Tiles are square and small; a full Vega render there is unreadable and
  // expensive, so the micro-chart stands in.
  const useMicro = layout === "tiles" || tier === "brief";
  // Feed is the reading layout: one card at a time, room to think, and the
  // only place the card is interactive rather than illustrative.
  const isFeed = layout === "feed";
  const height = isFeed ? 240 : PREVIEW_HEIGHT[tier];

  return (
    <article className={`discover-story discover-tier-${tier} ${featured ? "discover-story-featured" : ""}`}>
      {isFeed && (
        <div className="discover-story-preview">
          <CardControls insight={insight} height={height} />
          <span className="discover-story-kind">{DETECTOR_LABEL[insight.detector]}</span>
          {featured && <span className="discover-story-spotlight">Worth a closer look</span>}
        </div>
      )}
      <button className="discover-story-open" onClick={() => onOpen(beat)} aria-label={`Open: ${insight.headline}`}>
        {!isFeed && (
        <div className="discover-story-preview">
          {useMicro ? (
            <div className="story-micro-wrap" style={{ height }}>
              <Micro insight={insight} width={260} height={Math.min(height - 16, 92)} />
            </div>
          ) : (
            <Chart spec={insight.vega_spec} height={height} />
          )}
          <span className="discover-story-kind">{DETECTOR_LABEL[insight.detector]}</span>
          {featured && <span className="discover-story-spotlight">Worth a closer look</span>}
          <span className="discover-story-cta" aria-hidden>Open ↗</span>
        </div>
        )}

        <div className="discover-story-copy">
          <p className="discover-story-eyebrow">
            <span className={`scope-pill ${scope}`}>{SCOPE_LABEL[scope]}</span>
            <span aria-hidden>·</span>
            {insight.source_kind.replace("+", " × ")}
          </p>

          <h3>{insight.headline}</h3>

          {node.weave.narrative_annotation && (
            <p className="discover-story-blurb">{node.weave.narrative_annotation}</p>
          )}

          <div className="discover-story-insight">
            <strong>{s.name}</strong>
            <span>
              {s.value.toFixed(2)} · p={s.p_value < 1e-11 ? "<1e-11" : s.p_value.toExponential(1)} · n={s.n}
            </span>
          </div>
        </div>
      </button>

      <div className="discover-story-proof">
        <span className="discover-story-meta">
          {insight.evidence.points.length} values <span aria-hidden>·</span> {ago(insight.detected_at)} ago
          <span aria-hidden> · </span> effect {s.effect_size.toFixed(1)}
        </span>
        <button className="discover-story-more" onClick={() => onOpen(beat)} title="How this was measured">
          ⋯
        </button>
      </div>
    </article>
  );
}
