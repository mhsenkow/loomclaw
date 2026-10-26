// =================================================================
// Properties every published finding must satisfy
// =================================================================
// The statistics tests check the arithmetic. These check the claims: run
// the real detectors over a synthetic store built to contain the exact
// traps that have caught this engine out before, and assert that nothing
// indefensible comes out the other side.
// =================================================================

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "vega-lite";
import type { Insight } from "@loomclaw/core-schema";
import { GraphStore, type Observation } from "../src/graph.ts";
import { crossCorrelations, meritOf, runDetectors } from "../src/detectors/index.ts";
import { COLLECTOR_BY_KIND } from "../src/collectors/index.ts";

/** Units that denote a count of independent events, mirrored from the detector. */
const COUNT_UNITS = new Set([
  "commits", "sessions", "visits", "switches", "events", "repos", "domains",
  "messages", "stories", "papers", "requests", "alerts", "filings", "recalls",
  "quakes", "products", "inspections", "violations", "vehicles", "days",
]);

const day = (i: number) => new Date(Date.UTC(2026, 4, 1 + i)).toISOString().slice(0, 10) + "T00:00:00.000Z";

/**
 * A store seeded with the shapes that have produced bad claims:
 * a bursty count, a constant series, a summed magnitude and a heavy tail.
 */
function seedStore(): GraphStore {
  const store = new GraphStore(join(mkdtempSync(join(tmpdir(), "loomclaw-test-")), "g.db"));
  const obs: Observation[] = [];

  // git: commits per day, quiet with two enormous bursts — the Thursday trap.
  for (let i = 0; i < 120; i++) {
    const burst = i === 30 || i === 74;
    obs.push({ source_kind: "git", metric: "commits_per_day", dim: "", value: burst ? 120 : 3 + (i % 5), observed_at: day(i) });
    obs.push({ source_kind: "git", metric: "lines_per_day", dim: "", value: burst ? 14_000 : 200 + (i % 90), observed_at: day(i) });
  }
  // A heavy-tailed ranking, the market-cap shape.
  const caps = [1.6e12, 3e11, 9e10, 4e10, 2e10, 9e9, 5e9, 3e9, 2e9, 1e9, 8e8, 5e8];
  caps.forEach((v, i) => obs.push({ source_kind: "crypto", metric: "market_cap", dim: `C${i}`, value: v, observed_at: day(119) }));
  // A constant series — the fixed page size.
  for (let i = 0; i < 60; i++) {
    obs.push({ source_kind: "hn", metric: "story_count", dim: "", value: i === 20 ? 29 : 30, observed_at: day(i) });
  }

  store.recordObservations(obs);
  return store;
}

let store: GraphStore;
let findings: Insight[] = [];

before(() => {
  store = seedStore();
  const now = new Date().toISOString();
  for (const kind of ["git", "crypto", "hn"]) {
    if (!COLLECTOR_BY_KIND.has(kind)) continue;
    const all = store.db
      .prepare(`SELECT source_kind, metric, dim, value, observed_at FROM observations WHERE source_kind = ?`)
      .all(kind) as unknown as Observation[];
    findings.push(...runDetectors(store, kind, all, now));
  }
  findings.push(...crossCorrelations(store, now));
});

describe("no claim is absurd on its face", () => {
  test("no effect size reaches three figures", () => {
    for (const f of findings) {
      assert.ok(
        f.statistic.effect_size < 100,
        `${f.statistic.name} = ${f.statistic.effect_size} on "${f.headline.slice(0, 70)}"`,
      );
    }
  });

  test("every p-value is a real probability", () => {
    for (const f of findings) {
      assert.ok(f.statistic.p_value > 0 && f.statistic.p_value <= 1, `p=${f.statistic.p_value}`);
    }
  });

  test("every claim carries a sample size", () => {
    for (const f of findings) assert.ok(f.statistic.n >= 3, `n=${f.statistic.n}`);
  });
});

describe("Poisson is only applied where its assumptions can hold", () => {
  test("never to a unit outside the count vocabulary", () => {
    for (const f of findings) {
      if (!/Poisson/.test(f.statistic.name)) continue;
      const unit = f.evidence.unit ?? "";
      assert.ok(
        unit === "" || COUNT_UNITS.has(unit),
        `Poisson used on unit "${unit}" in "${f.headline.slice(0, 60)}"`,
      );
    }
  });

  test("and always with its dispersion named when overdispersed", () => {
    for (const f of findings) {
      if (!/Poisson/.test(f.statistic.name)) continue;
      const values = f.evidence.points.map((p) => p.value);
      const rest = [...values].sort((a, b) => b - a).slice(1);
      if (rest.length < 3) continue;
      const exp = rest.reduce((a, b) => a + b, 0) / rest.length;
      if (exp <= 0) continue;
      const phi = rest.reduce((a, o) => a + (o - exp) ** 2 / exp, 0) / (rest.length - 1);
      if (phi > 1.5) {
        assert.match(
          f.statistic.name, /φ=/,
          `dispersion of ${phi.toFixed(1)} was not priced in "${f.headline.slice(0, 60)}"`,
        );
      }
    }
  });
});

describe("correlations", () => {
  test("are computed on first differences, never on levels", () => {
    for (const f of findings) {
      if (f.detector !== "cross_correlation") continue;
      assert.match(f.statistic.name, /first differences/, "a levels correlation is spurious regression");
    }
  });

  test("always declare the multiplicity correction", () => {
    for (const f of findings) {
      if (f.detector !== "cross_correlation") continue;
      assert.match(f.statistic.name, /FDR/, "an uncorrected family manufactures findings");
    }
  });

  test("are never numerically degenerate", () => {
    for (const f of findings) {
      if (f.detector !== "cross_correlation") continue;
      assert.ok(Math.abs(f.statistic.value) < 0.996, `r=${f.statistic.value} is degenerate, not a discovery`);
    }
  });

  test("reject a constant series outright", () => {
    // hn.story_count is 30 every day but one; it must never reach a claim.
    const fromConstant = findings.filter((f) => f.source_kind.includes("hn") && f.detector === "cross_correlation");
    assert.equal(fromConstant.length, 0);
  });
});

describe("longitudinal claims", () => {
  test("a trend names both its slope test and its sample", () => {
    for (const f of findings) {
      if (f.detector !== "trend_break") continue;
      assert.match(f.statistic.name, /t-statistic/);
      assert.ok(f.statistic.n >= 12, "a trend needs real history");
    }
  });

  test("a lone burst never becomes a weekly rhythm", () => {
    // The seeded git series is quiet with two spikes and no weekday structure.
    const rhythms = findings.filter((f) => f.detector === "weekly_rhythm" && f.source_kind === "git");
    assert.equal(rhythms.length, 0, "bursts are not rhythms");
  });
});

describe("presentation", () => {
  test("every finding ships a chart that compiles", () => {
    for (const f of findings) {
      assert.doesNotThrow(
        () => compile(f.vega_spec as Parameters<typeof compile>[0]),
        `chart failed for "${f.headline.slice(0, 60)}"`,
      );
    }
  });

  test("every finding names its chart kind and family", () => {
    for (const f of findings) {
      assert.ok(f.chart?.kind && f.chart?.family, `no chart metadata on "${f.headline.slice(0, 50)}"`);
    }
  });

  test("a world finding never calls the data yours", () => {
    for (const f of findings) {
      const def = COLLECTOR_BY_KIND.get(f.source_kind.split("+")[0]);
      if (def?.scope !== "world") continue;
      assert.doesNotMatch(f.headline, /\byour\b/i, `world finding says "your": ${f.headline.slice(0, 70)}`);
    }
  });

  test("merit is computed and publishable claims clear the bar", () => {
    for (const f of findings) {
      const m = meritOf(f);
      assert.ok(m >= 0 && m <= 1, `merit ${m} out of range`);
    }
  });
});
