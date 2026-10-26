// =================================================================
// The statistics, against answers known in advance
// =================================================================
// Every case here corresponds to a claim the engine once published and
// should not have. If one of these fails, that bug is back.
// =================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  benjaminiHochberg, chooseTransform, gini, isInformative, kruskalWallis,
  pFromChiSquare, pFromZ, pearson, poissonExceedance, scaledRobustZ, spearman,
  uniformGiniNull,
} from "../src/detectors/stats.ts";

describe("gini", () => {
  test("is 0 when everything is equal", () => {
    assert.equal(gini([5, 5, 5, 5]), 0);
  });

  test("approaches 1 when one category holds everything", () => {
    assert.ok(gini([0, 0, 0, 100]) > 0.7);
  });

  test("the uniform null falls with the number of categories", () => {
    assert.ok(uniformGiniNull(40) > uniformGiniNull(4));
    assert.ok(uniformGiniNull(1000) < 0.34);
  });
});

describe("robust z with a chosen transform", () => {
  test("picks a log scale for data spanning orders of magnitude", () => {
    // Market caps: this shape once produced "BTC is a 1230σ outlier".
    const caps = [1.6e12, 3e11, 9e10, 4e10, 2e10, 9e9, 5e9, 3e9, 2e9, 1e9];
    assert.equal(chooseTransform(caps), "log");
  });

  test("keeps heavy tails from reporting absurd sigmas", () => {
    const caps = [1.6e12, 3e11, 9e10, 4e10, 2e10, 9e9, 5e9, 3e9, 2e9, 1e9];
    const { z } = scaledRobustZ(caps[0], caps);
    assert.ok(Math.abs(z) < 25, `expected a sane sigma, got ${z}`);
  });

  test("leaves well-behaved data untransformed", () => {
    assert.equal(chooseTransform([10, 11, 12, 13, 14, 15, 16]), "none");
  });
});

describe("informative series", () => {
  test("rejects a series with only two distinct values", () => {
    // Front-page size is always 30; this pair once correlated at r = -1.000.
    assert.equal(isInformative([30, 30, 30, 30, 30, 30, 29, 29, 30, 30, 30, 30]), false);
  });

  test("rejects a series dominated by one repeated value", () => {
    assert.equal(isInformative([5, 5, 5, 5, 5, 5, 5, 1, 2, 3, 4, 6]), false);
  });

  test("accepts a genuinely varying series", () => {
    assert.equal(isInformative([3, 8, 1, 14, 6, 22, 9, 4, 17, 11, 2, 19]), true);
  });
});

describe("Pearson and degeneracy", () => {
  test("two-valued series produce a degenerate perfect correlation", () => {
    const a = [30, 30, 30, 30, 30, 30, 29, 29, 30, 30, 30, 30];
    const b = [186, 186, 186, 186, 186, 186, 187, 187, 186, 186, 186, 186];
    const { r } = pearson(a, b);
    assert.ok(Math.abs(r) > 0.99, "the degenerate case should be detectable");
    // Which is exactly why the informative gate must reject them first.
    assert.equal(isInformative(a), false);
  });
});

describe("Benjamini-Hochberg", () => {
  test("rejects a p-value that only looks significant before correction", () => {
    // The real case: earthquakes against Hacker News points, p = 0.015,
    // "significant" at 0.05 and nowhere near surviving 55 tests.
    const ps = [0.015, ...Array.from({ length: 54 }, (_, i) => 0.1 + i * 0.01)];
    assert.equal(benjaminiHochberg(ps, 0.01).length, 0);
  });

  test("keeps a genuinely small p-value", () => {
    const ps = [1e-9, 0.4, 0.5, 0.6, 0.7];
    assert.deepEqual(benjaminiHochberg(ps, 0.01), [0]);
  });

  test("returns nothing for an empty family", () => {
    assert.deepEqual(benjaminiHochberg([], 0.01), []);
  });
});

describe("Poisson exceedance with dispersion priced in", () => {
  test("leaves well-behaved counts near their raw sigma", () => {
    // Evenly spread counts: dispersion should be about 1.
    const even = [12, 11, 13, 12, 10, 14, 12, 11, 13, 12];
    const r = poissonExceedance(even, 25)!;
    assert.ok(r.phi < 2, `expected no real dispersion, got ${r.phi}`);
  });

  test("shrinks the sigma of bursty counts", () => {
    /*
     * The actual commits-per-weekday totals that produced
     * "Thursday leads your commits — 12.1σ" while Kruskal-Wallis on the
     * daily values found no weekday effect at all.
     */
    const bursty = [337, 264, 185, 142, 121, 108, 86];
    const r = poissonExceedance(bursty, 337)!;
    assert.ok(r.phi > 10, `expected heavy dispersion, got ${r.phi}`);
    // Uncorrected this is 12.1σ. Priced correctly it must fall far below that,
    // not merely under it — a threshold that close is not a guard.
    assert.ok(r.z < 6, `dispersion should shrink 12.1σ well below 6, got ${r.z}`);
  });

  test("never reports an absurd sigma for a magnitude masquerading as a count", () => {
    // Vehicles affected per manufacturer: once reported at 7038σ.
    const magnitudes = [4_900_000, 1_300_000, 900_000, 400_000, 200_000, 90_000, 40_000, 9_000];
    const r = poissonExceedance(magnitudes, magnitudes[0])!;
    assert.ok(r.z < 20, `a summed magnitude must not reach tens of sigma, got ${r.z}`);
  });

  test("declines to speak on a tiny sample", () => {
    assert.equal(poissonExceedance([2, 1, 1], 2), null);
  });

  test("excludes the leader from its own dispersion estimate", () => {
    // Otherwise a single dominant category inflates the null that tests it
    // and suppresses every true finding along with the false ones.
    const withLeader = poissonExceedance([500, 10, 11, 9, 12, 10, 11], 500)!;
    assert.ok(withLeader.phi < 5, `leader must not set its own null, got φ=${withLeader.phi}`);
    assert.ok(withLeader.z > 4, "a real outlier over quiet peers should still speak");
  });
});

describe("Kruskal-Wallis", () => {
  test("finds no effect when groups are drawn alike", () => {
    const g = [[3, 5, 4, 6, 5], [4, 6, 3, 5, 4], [5, 4, 6, 3, 5]];
    const r = kruskalWallis(g)!;
    assert.ok(r.p > 0.2, `expected no effect, got p=${r.p}`);
    assert.ok(r.epsilonSq < 0.15);
  });

  test("finds an effect when one group genuinely differs", () => {
    const g = [[1, 2, 1, 2, 1], [2, 1, 2, 1, 2], [20, 22, 21, 23, 20]];
    const r = kruskalWallis(g)!;
    assert.ok(r.p < 0.01, `expected a clear effect, got p=${r.p}`);
    assert.ok(r.epsilonSq > 0.3);
  });

  test("is unmoved by a single burst inside one group", () => {
    /*
     * This is the test that caught the weekday bug: one enormous day in an
     * otherwise ordinary group must not read as a group difference.
     */
    const quiet = [4, 3, 5, 4, 3, 5, 4, 4];
    const withBurst = [4, 3, 5, 4, 3, 5, 4, 113];
    const r = kruskalWallis([quiet, [...quiet], withBurst])!;
    assert.ok(r.p > 0.1, `a lone burst must not become a pattern, got p=${r.p}`);
  });

  test("declines when there are too few groups or rows", () => {
    assert.equal(kruskalWallis([[1, 2], [3, 4]]), null);
  });
});

describe("Spearman", () => {
  test("is 1 for identical orderings regardless of scale", () => {
    assert.equal(Math.round(spearman([1, 2, 3, 4, 5], [10, 200, 3000, 40_000, 500_000])), 1);
  });

  test("is -1 for exactly reversed orderings", () => {
    assert.equal(Math.round(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])), -1);
  });
});

describe("p-values", () => {
  test("a two-sided z of 1.96 is about 0.05", () => {
    assert.ok(Math.abs(pFromZ(1.96) - 0.05) < 0.005);
  });

  test("chi-square with 1 df at 3.84 is about 0.05", () => {
    assert.ok(Math.abs(pFromChiSquare(3.84, 1) - 0.05) < 0.01);
  });

  test("never returns exactly zero, however extreme", () => {
    assert.ok(pFromZ(50) > 0);
  });
});
