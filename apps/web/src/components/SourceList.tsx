// =================================================================
// SourceList — the sidebar that replaces the source dropdown
// =================================================================
// A list rather than a select, because a select hides the two things
// worth knowing: how much each source is contributing, and whether it is
// actually running. Grouped by whose data it is, since that is the first
// distinction a reader makes here.
//
// This is the only place a source is chosen. The filter sentence lost its
// "from" dropdown when this arrived — two controls for one job is the
// mistake that put a second search box in the footer.
//
// It is closed by default and gone entirely when closed: 22 source names
// are a reference you consult, not something you read every session, and a
// permanent strip of them is a third vertical column competing with the
// rail. The control that opens it lives in the rail, next to the other
// things that change what you are looking at.
// =================================================================

import { useEffect, useMemo } from "react";
import type { Beat, Status } from "../lib/types.ts";

export function SourceList({
  sources, beats, selected, onSelect, onClose,
}: {
  sources: Status["sources"];
  beats: Beat[];
  selected: string;
  onSelect: (kind: string) => void;
  onClose: () => void;
}) {
  // Escape closes it, the same key that dismisses every other overlay here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A cross-source finding counts for both halves it spans.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of beats) {
      for (const k of b.insight.source_kind.split("+")) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [beats]);

  const groups: { key: "self" | "world"; title: string }[] = [
    { key: "self", title: "About you" },
    { key: "world", title: "The world" },
  ];

  return (
    <aside className="srcbar" aria-label="Sources">
      <div className="srcbar-head">
        <h2 className="srcbar-title">Sources</h2>
        <button className="srcbar-close" onClick={onClose} title="Hide the source list (Esc)" aria-label="Hide the source list">‹</button>
      </div>

      <button
        className="srcbar-all"
        aria-pressed={selected === "all"}
        onClick={() => onSelect("all")}
        title="Every source at once"
      >
        <span className="srcbar-label">All sources</span>
        <span className="srcbar-count">{beats.length}</span>
      </button>

      <div className="srcbar-scroll">
        {groups.map(({ key, title }) => {
          const group = sources.filter((s) => s.scope === key);
          if (!group.length) return null;
          const live = group.filter((s) => s.available.ok).length;
          return (
            <section key={key} className="srcbar-group">
              <h3>
                <span className="srcbar-group-name">{title}</span>
                <span className="srcbar-group-meta">{live}/{group.length}</span>
              </h3>
              {group
                .slice()
                .sort((a, b) => (counts.get(b.kind) ?? 0) - (counts.get(a.kind) ?? 0))
                .map((s) => {
                  const n = counts.get(s.kind) ?? 0;
                  return (
                    <button
                      key={s.kind}
                      className={`srcbar-row${s.available.ok ? "" : " off"}`}
                      aria-pressed={selected === s.kind}
                      onClick={() => onSelect(selected === s.kind ? "all" : s.kind)}
                      title={s.available.ok ? `${s.label}\n\n${s.premise}\n\n${s.origin}` : `${s.label}\n\n${s.available.reason}`}
                    >
                      <span className={`dot ${s.available.ok ? (n ? "ok" : "") : "warn"}`} />
                      <span className="srcbar-label">{s.label}</span>
                      {s.available.ok
                        ? n > 0 && <span className="srcbar-count">{n}</span>
                        : <span className="srcbar-off" aria-hidden>off</span>}
                    </button>
                  );
                })}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
