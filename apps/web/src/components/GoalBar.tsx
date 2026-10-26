import { useEffect, useState } from "react";
import type { Persona } from "../lib/types.ts";

/**
 * The persona control. Goals are free text; presets are starting points.
 * Submitting re-ranks the Weave without re-fetching any data — the graph is
 * already there, only the projection changes.
 */
export function GoalBar({
  presets, persona, onApply, busy,
}: {
  presets: { label: string; goals: string }[];
  persona: Persona | null;
  onApply: (label: string, goals: string) => void;
  busy: boolean;
}) {
  const [text, setText] = useState(persona?.goals ?? "");
  useEffect(() => { setText(persona?.goals ?? ""); }, [persona?.id]);

  const submit = () => onApply(text.trim() ? text.slice(0, 70) : "Everything, ranked by strength", text);

  return (
    <div className="goalbar">
      <span className="kicker">I care about</span>
      <input
        value={text}
        placeholder="politics and who's paying for it · food safety · my city · where science is heading…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        aria-label="Describe what you want this to watch for you"
      />
      <button className="btn primary" onClick={submit} disabled={busy}>Re-weave</button>
      <div className="preset-row">
        {presets.map((p) => (
          <button
            key={p.label}
            className="preset"
            aria-pressed={persona?.label === p.label}
            onClick={() => onApply(p.label, p.goals)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
