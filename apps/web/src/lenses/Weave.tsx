// =================================================================
// LENS 1 — The Weave: every finding, browsable
// =================================================================
// Four layouts over one list. Masonry needs measured heights, so each
// card reports its own span; the others are pure CSS grid.
// =================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StoryCard } from "../components/StoryCard.tsx";
import { DiscoverBar } from "../components/DiscoverBar.tsx";
import { DiscoverFooter } from "../components/DiscoverFooter.tsx";
import {
  applyBrowse, loadBrowse, saveBrowse, tierOf, tierSpan,
  type BrowseState,
} from "../lib/browseState.ts";
import type { Beat, Persona } from "../lib/types.ts";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Weave({
  beats, persona, gaps, sources, sweeping, onZoom,
}: {
  beats: Beat[];
  persona: Persona | null;
  gaps: string[];
  sources: { kind: string; label: string }[];
  sweeping: boolean;
  onZoom: (beat: Beat) => void;
}) {
  const [browse, setBrowse] = useState<BrowseState>(() => loadBrowse());
  const gridRef = useRef<HTMLUListElement>(null);
  const [spans, setSpans] = useState<Record<string, number>>({});

  const update = (next: Partial<BrowseState>) =>
    setBrowse((prev) => { const s = { ...prev, ...next }; saveBrowse(s); return s; });

  const topics = useMemo(
    () => Object.keys(persona?.weights ?? {}).map((t) => ({ id: t, label: t })),
    [persona],
  );

  const shown = useMemo(() => applyBrowse(beats, browse), [beats, browse]);

  /*
   * Masonry: CSS grid cannot pack rows of uneven height on its own, so each
   * item is measured and told how many 8px row-tracks to span. Re-measured
   * on resize and whenever the list or density changes.
   */
  useLayoutEffect(() => {
    if (browse.layout !== "masonry" || !gridRef.current) { setSpans({}); return; }
    const grid = gridRef.current;
    const measure = () => {
      const next: Record<string, number> = {};
      for (const li of Array.from(grid.children) as HTMLElement[]) {
        const id = li.dataset.id;
        if (!id) continue;
        const h = li.firstElementChild?.getBoundingClientRect().height ?? 0;
        next[id] = Math.max(8, Math.ceil((h + 9) / 9));
      }
      setSpans(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const li of Array.from(grid.children)) ro.observe(li);
    return () => ro.disconnect();
  }, [browse.layout, browse.density, shown]);

  // Re-measure once charts have actually drawn, which happens async.
  useEffect(() => {
    if (browse.layout !== "masonry") return;
    const t = setTimeout(() => setSpans((s) => ({ ...s })), 400);
    return () => clearTimeout(t);
  }, [browse.layout, shown]);

  const focused = topics.length > 0 && topics.length < 18;

  return (
    <div className="weave">
      <DiscoverBar state={browse} onChange={update} topics={topics} sources={sources} />

      <div className="discover-scroll">
        {gaps.length > 0 && (
          <p className="discover-gap">
            Nothing cleared significance for <strong>{gaps.join(", ")}</strong>. What follows is
            adjacent, not a substitute — the gap is real, not hidden.
          </p>
        )}

        {shown.length === 0 ? (
          <div className="empty">
            {beats.length === 0
              ? "Nothing has cleared the significance floor yet. Run a sweep, or widen what you're asking about."
              : "No finding matches these filters."}
          </div>
        ) : (
          <ul
            ref={gridRef}
            className={`discover-grid discover-layout-${browse.layout}`}
            data-size={browse.density}
            data-masonry={browse.layout === "masonry" ? "true" : undefined}
          >
            {shown.map((b, i) => {
              const tier = browse.layout === "flow" ? tierOf(i, shown.length) : "standard";
              const span = browse.layout === "flow" ? tierSpan(tier) : 1;
              const cls =
                browse.layout === "flow"
                  ? tier === "lead" ? "discover-grid-lead"
                  : tier === "wide" ? "discover-grid-wide"
                  : tier === "brief" ? "discover-grid-brief" : ""
                  : "";
              return (
                <li
                  key={b.node.id}
                  data-id={b.node.id}
                  className={cls}
                  style={{
                    gridColumn: span > 1 ? `span ${span}` : undefined,
                    ["--discover-span" as string]: spans[b.node.id] ?? 24,
                  }}
                >
                  <StoryCard
                    beat={b}
                    tier={tier}
                    density={browse.density}
                    featured={i === 0 && browse.layout !== "list"}
                    layout={browse.layout}
                    onOpen={onZoom}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {focused && persona && (
          <div className="topic-chips" style={{ marginTop: 18 }}>
            {Object.entries(persona.weights)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([t, w]) => <span key={t} className="topic-chip">{t} · {pct(w)}</span>)}
          </div>
        )}
      </div>

      <DiscoverFooter
        shown={shown.length}
        total={beats.length}
        sources={sources.length}
        sweeping={sweeping}
        query={browse.query}
        onQuery={(q) => update({ query: q })}
        onMethod={() => shown[0] && onZoom(shown[0])}
      />
    </div>
  );
}
