// =================================================================
// LOOM // CLAW — one graph, two lenses
// =================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Weave } from "./lenses/Weave.tsx";
import { Muse } from "./lenses/Muse.tsx";
import { Drawer } from "./components/Drawer.tsx";
import { Onboarding, type TopicOption } from "./components/Onboarding.tsx";
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

  /** Which scope a board belongs to, from the collector list the engine reports. */
  const scopeOf = useCallback(
    (kind: string): "self" | "world" =>
      status?.sources.find((c) => c.kind === kind)?.scope ?? "world",
    [status],
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">LOOM <span>//</span> CLAW</span>
        <span className="subtitle">{lens === "weave" ? "what your data says about you" : "every source, and how each finding was measured"}</span>

        {/*
          These were "Weave" and "Workshop", carried over from the design docs.
          Nobody could tell what either one meant without being told, which is
          a failure of the label rather than of the reader.
        */}
        <div className="lens-toggle">
          <button
            aria-pressed={lens === "weave"}
            onClick={() => setLens("weave")}
            title="Every finding, ranked and filterable"
          >
            Findings
          </button>
          <button
            aria-pressed={lens === "muse"}
            onClick={() => setLens("muse")}
            title="Where each finding came from, and the steps that measured it"
          >
            Where it comes from
          </button>
        </div>

        <span className="spacer" />

        {rep && (
          <span
            className="status-pill"
            title={rep.sources_failed.map((f) => `${f.kind}: ${f.error}`).join("\n") || "all collectors healthy"}
          >
            <span className={rep.sources_failed.length ? "dot warn" : "dot ok"} />
            {rep.sources_ok}/{rep.sources_ok + rep.sources_failed.length} sources ·{" "}
            {status?.observations.toLocaleString()} measurements
          </span>
        )}

        <span
          className="status-pill"
          title="Every collector reads this machine only, and narration runs on local Ollama. Nothing about you is uploaded."
        >
          <span className="dot ok" /> local only
        </span>

        {rep && (
          // Weave size is the live projection, not the last sweep's delta — a
          // sweep that re-finds a standing condition correctly pins nothing new.
          <span className="status-pill" title={`last sweep: ${rep.insights_published} found, ${rep.pinned} newly woven`}>
            {beats.length} in the weave
          </span>
        )}

        {oc && (
          // Reflect what actually happened, not just whether the binary exists:
          // the agent can be installed and still fail to produce a framing.
          <span
            className="status-pill"
            title={
              agentFramings > 0
                ? `${agentFramings} framing(s) written by OpenClaw`
                : `${oc.detail} — framings generated locally`
            }
          >
            <span className={agentFramings > 0 ? "dot ok" : "dot warn"} />
            {agentFramings > 0 ? `OpenClaw · ${agentFramings}` : "Framing: local"}
          </span>
        )}

        <span className="status-pill">
          <span className={live ? "dot live" : "dot err"} /> {live ? "streaming" : "offline"}
        </span>

        <button className="btn" onClick={sweep} disabled={busy}>
          {busy ? "Sweeping…" : "Sweep now"}
        </button>
      </header>


      {error && <div className="scrim" style={{ color: "var(--loom-error)" }}>{error}</div>}

      {!error && onboarded === false && (
        <Onboarding topics={topics} homeCity={homeCity} onDone={finishOnboarding} busy={busy} />
      )}

      {!error && onboarded !== false && !loadedOnce.current && <div className="scrim">Connecting to the engine…</div>}

      {!error && onboarded !== false && loadedOnce.current && lens === "weave" && (
        <Weave
          beats={beats}
          persona={persona}
          presets={presets}
          onAsk={applyPersona}
          busy={busy}
          gaps={gaps}
          sources={(status?.sources ?? []).filter((c) => c.available.ok).map((c) => ({ kind: c.kind, label: c.label }))}
          sweeping={busy || !!status?.sweeping}
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

      {open && <Drawer insight={open.insight} node={open.node} onClose={() => setOpen(null)} />}
    </div>
  );
}
