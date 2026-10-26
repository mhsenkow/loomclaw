// =================================================================
// LOOM // CLAW — one graph, two lenses
// =================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Weave } from "./lenses/Weave.tsx";
import { Muse } from "./lenses/Muse.tsx";
import { Drawer } from "./components/Drawer.tsx";
import { Onboarding, type TopicOption } from "./components/Onboarding.tsx";
import { DiscoverBar } from "./components/DiscoverBar.tsx";
import { CommandBar } from "./components/CommandBar.tsx";
import {
  applyBrowse, loadBrowse, saveBrowse, type BrowseState,
} from "./lib/browseState.ts";
import * as api from "./lib/api.ts";
import type { Beat, BoardView, GraphNode, Insight, Persona, Status } from "./lib/types.ts";

type Lens = "weave" | "muse";

export default function App() {
  const [lens, setLens] = useState<Lens>("weave");
  const [status, setStatus] = useState<Status | null>(null);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [gaps, setGaps] = useState<string[]>([]);
  const [agentFramed, setAgentFramed] = useState(0);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [homeCity, setHomeCity] = useState("New York");
  /*
   * Browse state lives here rather than inside the Findings lens, because
   * its two halves now sit in different parts of the shell: the filter
   * sentence along the top, the search and counts along the bottom.
   */
  const [browse, setBrowse] = useState<BrowseState>(() => loadBrowse());
  const updateBrowse = (next: Partial<BrowseState>) =>
    setBrowse((prev) => { const s = { ...prev, ...next }; saveBrowse(s); return s; });
  const [boards, setBoards] = useState<BoardView[]>([]);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [presets, setPresets] = useState<{ label: string; goals: string }[]>([]);
  const [open, setOpen] = useState<{ insight: Insight; node: GraphNode | null } | null>(null);
  const [focusBoard, setFocusBoard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [s, w, m] = await Promise.all([api.getStatus(), api.getWeave(), api.getMuse()]);
      setStatus(s); setBeats(w.beats); setBoards(m.boards); setPersona(w.persona); setGaps(w.gaps ?? []); setAgentFramed(w.framed_by_agent ?? 0);
      setError(null);
      loadedOnce.current = true;
    } catch (e) {
      setError(`Engine unreachable at :7717 — ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    api.getProfile()
      .then((p) => { setOnboarded(p.onboarded); setTopics(p.topics); setHomeCity(p.profile.home_city); })
      .catch(() => setOnboarded(true)); // engine unreachable: fall through to the error screen
    refresh();
    api.getPersonas().then((p) => setPresets(p.presets)).catch(() => {});
  }, [refresh]);

  const finishOnboarding = async (interests: string[], city: string) => {
    setBusy(true);
    try {
      await api.onboard(interests, city);
      setOnboarded(true);
      await api.triggerSweep().catch(() => {});
      await refresh();
    } finally { setBusy(false); }
  };

  // Live stream from the engine: a sweep finishing re-projects both lenses.
  useEffect(() => {
    const es = new EventSource("/events");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener("sweep:start", () => setBusy(true));
    es.addEventListener("sweep:done", () => { setBusy(false); refresh(); });
    return () => es.close();
  }, [refresh]);

  // Cmd+/ flips the lens, as specified in the product design.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setLens((l) => (l === "weave" ? "muse" : "weave"));
      }
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyPersona = async (label: string, goals: string) => {
    setBusy(true);
    try {
      const r = await api.setPersona(label, goals);
      setPersona(r.persona);
      setBeats(r.beats);
      setGaps(r.gaps ?? []);
      setAgentFramed(r.framed_by_agent ?? 0);
      setLens("weave");
    } finally { setBusy(false); }
  };

  const sweep = async () => {
    setBusy(true);
    try { await api.triggerSweep(); await refresh(); } finally { setBusy(false); }
  };

  const pin = async (id: string, pinned: boolean) => {
    await api.setPin(id, pinned);
    await refresh();
  };

  /** Macro -> micro: jump to the Board that produced a beat and highlight it. */
  const zoomTo = (beat: Beat) => {
    const boardId = beat.node.parent_board_id;
    setFocusBoard(boardId);
    setLens("muse");
    requestAnimationFrame(() => {
      document.getElementById(`board-${boardId}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
  };

  const rep = status?.last_report;
  const oc = status?.openclaw;
  // Count framings standing in the weave, not just the last sweep's delta.
  const agentFramings = agentFramed;

  const shown = useMemo(() => applyBrowse(beats, browse), [beats, browse]);
  const liveSources = useMemo(
    () => (status?.sources ?? []).filter((c) => c.available.ok),
    [status],
  );
  const topicList = useMemo(
    () => Object.keys(persona?.weights ?? {}).map((t) => ({ id: t, label: t })),
    [persona],
  );

  /** Which scope a board belongs to, from the collector list the engine reports. */
  const scopeOf = useCallback(
    (kind: string): "self" | "world" =>
      status?.sources.find((c) => c.kind === kind)?.scope ?? "world",
    [status],
  );

  const LENSES: { id: Lens; glyph: string; label: string; hint: string }[] = [
    { id: "weave", glyph: "◳", label: "Findings", hint: "Everything that cleared significance, ranked and filterable" },
    { id: "muse", glyph: "⊞", label: "Sources", hint: "Where each finding came from, and the steps that measured it" },
  ];

  return (
    <div className="app">
      {/*
        The lens switch moved out of a top bar and into a vertical rail, so
        the top can belong entirely to filtering and the bottom to counts and
        search. Three bands, three jobs, none of them competing for the top.
      */}
      <nav className="rail" aria-label="Views">
        <span className="rail-mark" title="LOOM // CLAW">L<span>//</span>C</span>

        <div className="rail-lenses">
          {LENSES.map((l) => (
            <button
              key={l.id}
              className="rail-btn"
              aria-pressed={lens === l.id}
              onClick={() => setLens(l.id)}
              title={l.hint}
            >
              <span className="rail-glyph" aria-hidden>{l.glyph}</span>
              <span className="rail-label">{l.label}</span>
            </button>
          ))}
        </div>

        <div className="rail-foot">
          <button
            className="rail-btn"
            onClick={sweep}
            disabled={busy}
            title="Read every source again now"
          >
            <span className="rail-glyph" aria-hidden>{busy ? "◌" : "↻"}</span>
            <span className="rail-label">{busy ? "Sweeping" : "Sweep"}</span>
          </button>
        </div>
      </nav>

      <div className="shell">
        <header className="topbar">
          {lens === "weave" ? (
            <DiscoverBar
              state={browse}
              onChange={updateBrowse}
              topics={topicList}
              sources={liveSources.map((c) => ({ kind: c.kind, label: c.label }))}
            />
          ) : (
            <p className="topbar-static">
              One board per source. Each shows what it reads, what it found this sweep, and the
              steps that measured it — including claims since superseded.
            </p>
          )}
        </header>

        <main className="content">
          {error && <div className="scrim" style={{ color: "var(--loom-error)" }}>{error}</div>}

          {!error && onboarded === false && (
            <Onboarding topics={topics} homeCity={homeCity} onDone={finishOnboarding} busy={busy} />
          )}

          {!error && onboarded !== false && !loadedOnce.current && (
            <div className="scrim">Connecting to the engine…</div>
          )}

          {!error && onboarded !== false && loadedOnce.current && lens === "weave" && (
            <Weave
              shown={shown}
              total={beats.length}
              persona={persona}
              browse={browse}
              gaps={gaps}
              onZoom={zoomTo}
            />
          )}

          {!error && onboarded !== false && loadedOnce.current && lens === "muse" && (
            <Muse
              boards={boards}
              focusBoardId={focusBoard}
              scopeOf={scopeOf}
              onPin={pin}
              onOpen={(insight, node) => setOpen({ insight, node })}
            />
          )}
        </main>

        {onboarded !== false && !error && (
          <footer className="footer">
            {/* The engine's own vital signs, out of the way but never hidden. */}
            <div className="footer-metrics">
              {rep && (
                <span
                  className="metric"
                  title={rep.sources_failed.map((f) => `${f.kind}: ${f.error}`).join("\n") || "all collectors healthy"}
                >
                  <span className={rep.sources_failed.length ? "dot warn" : "dot ok"} />
                  {rep.sources_ok}/{rep.sources_ok + rep.sources_failed.length} sources
                </span>
              )}
              {status && <span className="metric">{status.observations.toLocaleString()} measurements</span>}
              <span className="metric">{beats.length} findings</span>
              {rep && (
                <span className="metric" title={`last sweep took ${(rep.duration_ms / 1000).toFixed(0)}s`}>
                  {(rep.duration_ms / 1000).toFixed(0)}s sweep
                </span>
              )}
              {oc && (
                <span
                  className="metric"
                  title={agentFramings > 0
                    ? `${agentFramings} framing(s) written by OpenClaw`
                    : `${oc.detail} — framings generated locally`}
                >
                  <span className={agentFramings > 0 ? "dot ok" : "dot warn"} />
                  {agentFramings > 0 ? `OpenClaw · ${agentFramings}` : "Framing: local"}
                </span>
              )}
              <span className="metric" title="Every collector reads this machine only, and narration runs on local Ollama. Nothing about you is uploaded.">
                <span className="dot ok" /> local only
              </span>
              <span className="metric">
                <span className={live ? "dot live" : "dot err"} /> {live ? "streaming" : "offline"}
              </span>
            </div>

            {lens === "weave" && (
              <CommandBar
                query={browse.query}
                onQuery={(q) => updateBrowse({ query: q })}
                onAsk={applyPersona}
                presets={presets}
                activePreset={persona?.label ?? null}
                busy={busy}
                shown={shown.length}
                total={beats.length}
                sources={liveSources.length}
                sweeping={busy || !!status?.sweeping}
              />
            )}
          </footer>
        )}
      </div>

      {open && <Drawer insight={open.insight} node={open.node} onClose={() => setOpen(null)} />}
    </div>
  );
}
