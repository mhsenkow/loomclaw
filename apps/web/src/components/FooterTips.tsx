// =================================================================
// FooterTips — the instruction line, rotating
// =================================================================
// The bottom line used to say one thing forever ("Press / to jump here"),
// which is read once and then stops being read at all. The affordances in
// here are not discoverable — the slider that re-cuts a chart, the sort
// that surfaces the least expected finding, what Enter does differently
// from typing — and a line nobody reads twice is the wrong place to put
// them. So it cycles.
//
// Two rules keep it from becoming noise. It holds still while you are
// typing, because what is on screen then is the live filter count, which
// is information rather than advice. And it pauses on hover, so a tip you
// started reading does not leave mid-sentence.
//
// Every tip here describes something that actually exists. A hint for a
// feature that is not there is worse than no hint.
// =================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";

const TIPS: ReactNode[] = [
  <>Press <kbd>/</kbd> from anywhere to jump to the box above.</>,
  <>Type a few words and press <kbd>↵</kbd> to make them what this watches, not just a filter.</>,
  <>Open <strong>Filter</strong> in the left rail to see every source and how much each one found.</>,
  <>Drag the <strong>top N</strong> slider on any chart to re-cut it — the statistic above it does not change.</>,
  <>Sort by <strong>Most surprising</strong> to see what you would least have predicted.</>,
  <>Every claim shows its own test: the statistic, the p-value and the sample it rests on.</>,
  <>A greyed source is off. Open <strong>Filter</strong> to see what it is waiting on.</>,
  <>Press <kbd>Esc</kbd> to clear the box and get the whole feed back.</>,
  <><strong>Sweep</strong> in the rail re-reads every source now rather than at the next interval.</>,
  <>Cards marked <strong>you</strong> come off this machine. Nothing in them was uploaded anywhere.</>,
];

const EVERY_MS = 9000;

export function FooterTips({ filtering, shown, total }: {
  filtering: boolean;
  shown: number;
  total: number;
}) {
  // A fresh index each load, so the same tip is not always the first seen.
  const [i, setI] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [paused, setPaused] = useState(false);
  const reduced = useRef(
    typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (paused || filtering) return;
    const t = setInterval(() => setI((v) => (v + 1) % TIPS.length), EVERY_MS);
    return () => clearInterval(t);
  }, [paused, filtering]);

  if (filtering) {
    return (
      <p className="footer-tip is-live">
        Filtering <strong>{shown}</strong> of {total} — press <kbd>↵</kbd> to make it what this watches instead.
      </p>
    );
  }

  return (
    <p
      className="footer-tip"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* The key is the animation trigger: a new tip is a new node. */}
      <span key={reduced.current ? "static" : i} className="footer-tip-text">
        {TIPS[i]}
      </span>
    </p>
  );
}
