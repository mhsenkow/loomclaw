// =================================================================
// CommandBar — one place to type, at the bottom
// =================================================================
// There were two inputs doing adjacent jobs: a goals bar at the top that
// re-ranked everything, and a search box at the bottom that filtered it.
// Two boxes for "tell me what you want" is one box too many.
//
// This is the single bar. Typing filters as you go; pressing Enter (or
// Ask) takes the same words as a statement of interest and re-ranks the
// whole graph around them. The distinction is made visible rather than
// guessed at — the footer's instruction line says what each will do with
// what you typed, and the counts that used to sit beside this input are
// in that same line, which is where a reader looks for them.
// =================================================================

import { useEffect, useRef, useState } from "react";

export function CommandBar({
  query, onQuery, onAsk, presets, activePreset, busy,
}: {
  query: string;
  onQuery: (q: string) => void;
  onAsk: (label: string, goals: string) => void;
  presets: { label: string; goals: string }[];
  activePreset: string | null;
  busy: boolean;
}) {
  const [text, setText] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(query); }, [query]);

  // Typing filters immediately; asking is the deliberate act.
  const type = (v: string) => { setText(v); onQuery(v); };
  const ask = () => {
    const t = text.trim();
    onAsk(t ? t.slice(0, 70) : "Everything, ranked by strength", t);
    onQuery("");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // "/" focuses the bar, the way every search field people already use does.
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="cmd">
      <div className="cmd-presets">
        {presets.map((p) => (
          <button
            key={p.label}
            className="preset"
            aria-pressed={activePreset === p.label}
            onClick={() => onAsk(p.label, p.goals)}
            disabled={busy}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="cmd-row">
        <div className="cmd-field">
          <span className="cmd-icon" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ask(); if (e.key === "Escape") type(""); }}
            placeholder="Filter these findings, or describe what you want watched…"
            aria-label="Filter findings, or describe what to watch"
          />
          {text && (
            <>
              <button className="cmd-clear" onClick={() => type("")} aria-label="Clear">×</button>
              <button className="cmd-ask" onClick={ask} disabled={busy}>
                {busy ? "…" : "Ask ↵"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
