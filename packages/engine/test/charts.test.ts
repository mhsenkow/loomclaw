// =================================================================
// Every chart kind must actually compile
// =================================================================
// Nine published charts once failed silently in the browser because an x2
// channel paired with a `datum` x needs its own explicit type. Looking at
// the page did not reveal it; compiling the specs did.
// =================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compile } from "vega-lite";
import { CHART_FAMILY, CHART_LABEL, build, chooseKind, type ChartKind, type Pt } from "../src/detectors/charts.ts";

const ranked: Pt[] = [
  { label: "alpha", value: 48 }, { label: "bravo", value: 22 }, { label: "charlie", value: 17 },
  { label: "delta", value: 12 }, { label: "echo", value: 9 }, { label: "foxtrot", value: 7 },
  { label: "golf", value: 5 }, { label: "hotel", value: 4 },
];
const series: Pt[] = Array.from({ length: 90 }, (_, i) => ({
  label: new Date(Date.UTC(2026, 5, 1 + i)).toISOString(),
  value: 100 + Math.sin(i / 7) * 20 + i,
}));
const hours: Pt[] = Array.from({ length: 24 }, (_, h) => ({
  label: h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`,
  value: 5 + (h % 7),
}));
const days: Pt[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  .map((label, i) => ({ label, value: 10 + i }));

const ALL: ChartKind[] = Object.keys(CHART_LABEL) as ChartKind[];

function pointsFor(kind: ChartKind): Pt[] {
  if (["line", "area", "calendar", "stripes", "trendFit"].includes(kind)) return series;
  if (kind === "rose") return hours;
  if (kind === "orderedBar") return days;
  return ranked;
}

describe("every chart kind compiles", () => {
  for (const kind of ALL) {
    test(kind, () => {
      const pts = pointsFor(kind);
      const spec = build(kind, pts, {
        unit: "things",
        title: "a measured thing",
        baseline: 10,
        baselinePts: pts.map((p) => ({ ...p, value: p.value * 0.8 })),
        fit: { slope: 1.2, intercept: 90 },
      });
      // compile throws on a malformed spec, which is the whole point.
      assert.doesNotThrow(() => compile(spec as Parameters<typeof compile>[0]));
    });
  }
});

describe("every kind belongs to a family and has a label", () => {
  for (const kind of ALL) {
    test(kind, () => {
      assert.ok(CHART_FAMILY[kind], `${kind} has no family`);
      assert.ok(CHART_LABEL[kind], `${kind} has no label`);
    });
  }
});

describe("choosing a kind from the shape of the evidence", () => {
  test("hours become a rose, because a day is a circle", () => {
    assert.equal(chooseKind(hours, { summable: true, family: "comparison" }), "rose");
  });

  test("weekdays keep their order", () => {
    assert.equal(chooseKind(days, { summable: true, family: "comparison" }), "orderedBar");
  });

  test("a long dated series becomes a calendar", () => {
    assert.equal(chooseKind(series, { summable: true, family: "trend" }), "calendar");
  });

  test("a short dated series stays a line or an area", () => {
    const short = series.slice(0, 14);
    assert.ok(["line", "area"].includes(chooseKind(short, { summable: false, family: "trend" })));
  });

  test("heavy concentration becomes a Pareto", () => {
    const concentrated = [
      { label: "a", value: 900 }, { label: "b", value: 40 }, { label: "c", value: 20 },
      { label: "d", value: 15 }, { label: "e", value: 10 }, { label: "f", value: 8 },
      { label: "g", value: 5 }, { label: "h", value: 2 },
    ];
    assert.equal(chooseKind(concentrated, { summable: true, family: "comparison" }), "pareto");
  });

  test("a flat spread becomes a distribution, not a ranking", () => {
    const flat = Array.from({ length: 14 }, (_, i) => ({ label: `x${i}`, value: 10 + (i % 3) }));
    assert.equal(chooseKind(flat, { summable: true, family: "comparison" }), "beeswarm");
  });

  test("the same evidence never resolves to two different kinds", () => {
    const a = chooseKind(ranked, { summable: true, family: "comparison" });
    const b = chooseKind(ranked, { summable: true, family: "comparison" });
    assert.equal(a, b);
  });
});
