// =================================================================
// DiscoverBar — the filter sentence, plus density and layout
// =================================================================
// Reads as a sentence rather than a toolbar: "showing X in Y from Z
// with W by V". Each select narrows the same list, so the grammar is
// the control.
// =================================================================

import {
  DENSITIES, LAYOUTS, SCOPES, SORTS,
  type BrowseState, type Density, type Layout,
} from "../lib/browseState.ts";
import { DETECTOR_LABEL } from "../lib/types.ts";

export function DiscoverBar({
  state, onChange, topics, sources,
}: {
  state: BrowseState;
  onChange: (next: Partial<BrowseState>) => void;
  topics: { id: string; label: string }[];
  sources: { kind: string; label: string }[];
}) {
  return (
    <div className="discover-bar">
      <p className="discover-sentence">
        <span>showing</span>
        <select value={state.scope} onChange={(e) => onChange({ scope: e.target.value as BrowseState["scope"] })} aria-label="Scope">
          {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        <span>in</span>
        <select value={state.topic} onChange={(e) => onChange({ topic: e.target.value })} aria-label="Topic">
          <option value="all">All topics</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>

        <span>from</span>
        <select value={state.source} onChange={(e) => onChange({ source: e.target.value })} aria-label="Source">
          <option value="all">All sources</option>
          {sources.map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
        </select>

        <span>with</span>
        <select value={state.detector} onChange={(e) => onChange({ detector: e.target.value })} aria-label="Test">
          <option value="all">Any test</option>
          {Object.entries(DETECTOR_LABEL).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>

        <span>by</span>
        <select value={state.sort} onChange={(e) => onChange({ sort: e.target.value as BrowseState["sort"] })} aria-label="Sort">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </p>

      <div className="discover-controls">
        <div className="discover-size-picker" role="group" aria-label="Card size">
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              aria-pressed={state.density === d.id}
              onClick={() => onChange({ density: d.id as Density })}
              title={`${d.label} cards`}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="discover-layout-picker" role="group" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              aria-pressed={state.layout === l.id}
              onClick={() => onChange({ layout: l.id as Layout })}
              title={l.label}
            >
              <span aria-hidden>{l.glyph}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
