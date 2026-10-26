// =================================================================
// Onboarding — pick what you want watched
// =================================================================
// Shown until a profile exists. Interests do two things, and the screen
// says both plainly: they rank what you see, and they decide which world
// feeds get polled at all. An interest you don't pick is never fetched.
// =================================================================

import { useMemo, useState } from "react";

export interface TopicOption {
  id: string;
  label: string;
  blurb: string;
  scope: "self" | "shared" | "world";
  feeds: { kind: string; label: string; scope: "self" | "world" }[];
}

const SECTIONS: { scope: TopicOption["scope"]; title: string; note: string }[] = [
  { scope: "self",   title: "About you",       note: "Read from this machine. Always on — nothing leaves it." },
  { scope: "shared", title: "Both",            note: "These have a personal side and a world side. Picking one gets you both." },
  { scope: "world",  title: "About the world", note: "Live public feeds. Only the ones you pick are ever fetched." },
];

export function Onboarding({
  topics, homeCity, onDone, busy,
}: {
  topics: TopicOption[];
  homeCity: string;
  onDone: (interests: string[], city: string) => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [city, setCity] = useState(homeCity);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Show the consequence of the current selection, not a count of labels.
  const feeds = useMemo(() => {
    const seen = new Map<string, { label: string; scope: "self" | "world" }>();
    for (const t of topics) {
      if (!picked.has(t.id)) continue;
      for (const f of t.feeds) seen.set(f.kind, { label: f.label, scope: f.scope });
    }
    return [...seen.values()];
  }, [picked, topics]);

  const worldFeeds = feeds.filter((f) => f.scope === "world");
  const wantsCity = [...picked].some((p) => p === "environment" || p === "cities" || p === "health");

  return (
    <div className="onboard">
      <div className="onboard-inner">
        <header className="onboard-head">
          <span className="kicker">First, the shape of it</span>
          <h1>What should this watch?</h1>
          <p>
            It reads your own machine and a set of live public feeds, runs real statistical
            tests over both, and tells you what holds up. What you pick decides two things:
            how findings are ranked, and <strong>which world feeds get fetched at all</strong>.
            Anything you don&rsquo;t pick is never polled.
          </p>
        </header>

        {SECTIONS.map((section) => {
          const group = topics.filter((t) => t.scope === section.scope);
          if (!group.length) return null;
          return (
            <section key={section.scope} className="onboard-section">
              <h2>{section.title}</h2>
              <p className="onboard-note">{section.note}</p>
              <div className="topic-grid">
                {group.map((t) => (
                  <button
                    key={t.id}
                    className="topic-card"
                    aria-pressed={picked.has(t.id)}
                    onClick={() => toggle(t.id)}
                  >
                    <span className="topic-card-label">{t.label}</span>
                    <span className="topic-card-blurb">{t.blurb}</span>
                    {t.feeds.length > 0 && (
                      <span className="topic-card-feeds">
                        {t.feeds.length} source{t.feeds.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        {wantsCity && (
          <section className="onboard-section">
            <h2>Where do you live?</h2>
            <p className="onboard-note">
              Used to scope air quality and anything local to you. Nothing else uses it.
            </p>
            <input
              className="onboard-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="New York"
              aria-label="Your city"
            />
          </section>
        )}

        <footer className="onboard-foot">
          <div className="onboard-summary">
            {picked.size === 0 ? (
              <span className="muted">
                Pick at least one. With nothing picked, no world feed is fetched and you
                only see findings about yourself.
              </span>
            ) : (
              <>
                <strong>{feeds.length} sources</strong> will run
                {worldFeeds.length > 0 && (
                  <span className="muted">
                    {" "}— {worldFeeds.map((f) => f.label).join(", ")}
                  </span>
                )}
              </>
            )}
          </div>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => onDone([...picked], city.trim() || homeCity)}
          >
            {busy ? "Setting up…" : picked.size ? "Start watching" : "Just watch me"}
          </button>
        </footer>
      </div>
    </div>
  );
}
