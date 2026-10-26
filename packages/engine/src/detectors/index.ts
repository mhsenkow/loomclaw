// =================================================================
// Detectors — where insights actually come from
// =================================================================
// Two families:
//   cross-sectional  compare peers inside one sweep (fire immediately)
//   longitudinal     compare a series against its own past (need history)
// Every detector returns an effect size, a sample size and a p-value, so
// ranking is comparable across families and a weak claim can be filtered
// out rather than narrated into sounding strong.
// =================================================================

import type { DetectorKind, Insight } from "@loomclaw/core-schema";
import type { GraphStore, Observation } from "../graph.ts";
import { SOURCE_BY_KIND, type SourceDef } from "../sources/registry.ts";
import {
  correlationP, gini, linearTrend, mean, median, pFromChiSquare, pFromZ,
  pearson, scaledRobustZ, sd, uniformGiniNull,
} from "./stats.ts";

const uid = () => Math.random().toString(36).slice(2, 10);

/** Minimum history before a longitudinal detector is allowed to speak. */
const MIN_HISTORY = 8;
/** Claims weaker than this are never published, however novel. */
const MAX_P = 0.01;
/**
 * A statistic can be significant and still be noise in disguise: "2 stories vs
 * a median of 1" clears 5σ on count data and means nothing. A claim must also
 * clear an absolute floor and a real multiple before it is allowed to speak.
 */
const MIN_ABS_TOP = 5;
const MIN_RATIO = 1.5;

function triviallySmall(top: number, med: number): boolean {
  if (top < MIN_ABS_TOP) return true;
  if (med > 0 && top / med < MIN_RATIO) return true;
  return Math.abs(top - med) < 3;
}

const fmt = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  if (a >= 10) return n.toFixed(0);
  return n.toFixed(2);
};

const unitOf = (def: SourceDef | undefined, metric: string) => def?.units?.[metric] ?? "";

/** Metric name -> readable phrase, so headlines don't read like column names. */
const phrase = (metric: string) =>
  metric.replace(/^count_by_/, "").replace(/^(max|mean|total|amount)_/, "").replace(/_by_\w+$/, "").replace(/_/g, " ");

// =================================================================
// 1. Cross-sectional outlier — who is unlike their peers right now
// =================================================================

function crossSectionalOutliers(def: SourceDef, current: Observation[], now: string): Insight[] {
  const out: Insight[] = [];
  const byMetric = new Map<string, Observation[]>();
  for (const o of current) {
    if (!o.dim) continue; // scalars have no peers to compare against
    (byMetric.get(o.metric) ?? byMetric.set(o.metric, []).get(o.metric)!).push(o);
  }

  for (const [metric, obs] of byMetric) {
    if (obs.length < 6) continue; // too few peers for "unusual" to mean anything
    if (def.structural?.includes(metric)) continue; // ranking here is a domain constant
    const values = obs.map((o) => o.value);
    const ranked = [...obs].sort((a, b) => b.value - a.value);
    const top = ranked[0];
    const { z, transform, median: med, ratio } = scaledRobustZ(top.value, values);
    if (!Number.isFinite(z) || Math.abs(z) < 3.5) continue;
    if (triviallySmall(top.value, med)) continue;

    const p = pFromZ(z);
    if (p > MAX_P) continue;
    const unit = unitOf(def, metric);
    const scaleNote = transform === "none" ? "" : ` on a ${transform} scale`;

    out.push({
      id: `ins_${uid()}`,
      detector: "zscore_outlier",
      source_kind: def.kind,
      headline:
        `${top.dim} stands out in ${phrase(metric)}: ` +
        `${fmt(top.value)}${unit ? " " + unit : ""} against a peer median of ${fmt(med)}` +
        (Number.isFinite(ratio) ? ` — ${ratio.toFixed(1)}× the typical peer` : "") +
        ` (${z.toFixed(1)}σ${scaleNote}, n=${obs.length})`,
      statistic: { name: `robust z (MAD${transform === "none" ? "" : ", " + transform}) across peers`, value: z, effect_size: Math.abs(z), p_value: p, n: obs.length },
      evidence: {
        points: ranked.slice(0, 12).map((o) => ({ label: o.dim, value: o.value })),
        baseline: [{ label: "peer median", value: med }],
        unit,
      },
      vega_spec: barSpec(ranked.slice(0, 12).map((o) => ({ label: o.dim, value: o.value })), med, unit, phrase(metric)),
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 2. Concentration — is this domain dominated by a few actors
// =================================================================

function concentration(def: SourceDef, current: Observation[], now: string): Insight[] {
  const out: Insight[] = [];
  const byMetric = new Map<string, Observation[]>();
  for (const o of current) {
    if (!o.dim || o.value < 0) continue;
    (byMetric.get(o.metric) ?? byMetric.set(o.metric, []).get(o.metric)!).push(o);
  }

  for (const [metric, obs] of byMetric) {
    if (obs.length < 8) continue;
    if (def.structural?.includes(metric)) continue; // concentration here is definitional
    const values = obs.map((o) => o.value);
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;

    const g = gini(values);
    const nullG = uniformGiniNull(values.length);
    // SE of Gini under the uniform null, approximated as ~0.6/sqrt(n).
    const se = 0.6 / Math.sqrt(values.length);
    const z = (g - nullG) / se;
    if (z < 4) continue;
    const p = pFromZ(z);
    if (p > MAX_P) continue;

    const ranked = [...obs].sort((a, b) => b.value - a.value);
    const top3Share = (ranked.slice(0, 3).reduce((s, o) => s + o.value, 0) / total) * 100;
    const unit = unitOf(def, metric);

    out.push({
      id: `ins_${uid()}`,
      detector: "concentration",
      source_kind: def.kind,
      headline:
        `${phrase(metric)} is highly concentrated (Gini ${g.toFixed(2)} vs ${nullG.toFixed(2)} expected if even): ` +
        `${ranked.slice(0, 3).map((o) => o.dim).join(", ")} hold ${top3Share.toFixed(0)}% of ${fmt(total)}${unit ? " " + unit : ""} across ${values.length}`,
      statistic: { name: "Gini vs uniform null", value: g, effect_size: z, p_value: p, n: values.length },
      evidence: {
        points: ranked.slice(0, 12).map((o) => ({ label: o.dim, value: o.value })),
        unit,
      },
      vega_spec: lorenzSpec(values, phrase(metric)),
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 3. Longitudinal level shift — a scalar jumping off its own baseline
// =================================================================

function levelShifts(store: GraphStore, def: SourceDef, current: Observation[], now: string): Insight[] {
  const out: Insight[] = [];
  for (const o of current) {
    if (o.dim) continue; // scalars only
    const hist = store.history(def.kind, o.metric, "", 200);
    const prior = hist.slice(0, -1).map((h) => h.value);
    if (prior.length < MIN_HISTORY) continue;

    const { z, transform, median: base } = scaledRobustZ(o.value, prior);
    if (!Number.isFinite(z) || Math.abs(z) < 3.5) continue;
    if (triviallySmall(Math.max(o.value, base), Math.min(o.value, base))) continue;
    const p = pFromZ(z);
    if (p > MAX_P) continue;

    const unit = unitOf(def, o.metric);
    const dir = o.value > base ? "above" : "below";
    const scaleNote = transform === "none" ? "" : `, ${transform} scale`;

    out.push({
      id: `ins_${uid()}`,
      detector: "zscore_outlier",
      source_kind: def.kind,
      headline:
        `${def.label}: ${phrase(o.metric)} is ${Math.abs(z).toFixed(1)}σ ${dir} its own baseline — ` +
        `${fmt(o.value)}${unit ? " " + unit : ""} vs a ${prior.length}-sweep median of ${fmt(base)}`,
      statistic: { name: `robust z vs own history (MAD${scaleNote})`, value: z, effect_size: Math.abs(z), p_value: p, n: prior.length },
      evidence: {
        points: hist.slice(-60).map((h) => ({ label: h.observed_at, value: h.value })),
        baseline: [{ label: "median", value: base }],
        unit,
      },
      vega_spec: lineSpec(hist.slice(-60).map((h) => ({ label: h.observed_at, value: h.value })), base, unit, phrase(o.metric)),
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 4. Trend break — a sustained direction, not a single spike
// =================================================================

function trends(store: GraphStore, def: SourceDef, current: Observation[], now: string): Insight[] {
  const out: Insight[] = [];
  const targets = current.filter((o) => !o.dim);

  for (const o of targets) {
    const hist = store.history(def.kind, o.metric, "", 120);
    if (hist.length < 12) continue;
    const ys = hist.map((h) => h.value);
    const fit = linearTrend(ys);
    // |t| > 4 on >=12 points is a trend you would rarely get from noise.
    if (!Number.isFinite(fit.t) || Math.abs(fit.t) < 4 || fit.r2 < 0.5) continue;
    const p = pFromZ(fit.t);
    if (p > MAX_P) continue;

    const unit = unitOf(def, o.metric);
    const pctPerSweep = mean(ys) ? (fit.slope / Math.abs(mean(ys))) * 100 : 0;
    const dir = fit.slope > 0 ? "rising" : "falling";

    out.push({
      id: `ins_${uid()}`,
      detector: "trend_break",
      source_kind: def.kind,
      headline:
        `${def.label}: ${phrase(o.metric)} is ${dir} steadily — ` +
        `${fmt(fit.slope)}${unit ? " " + unit : ""} per sweep (${pctPerSweep >= 0 ? "+" : ""}${pctPerSweep.toFixed(1)}%), ` +
        `R²=${fit.r2.toFixed(2)} over ${fit.n} sweeps`,
      statistic: { name: "OLS slope t-statistic", value: fit.slope, effect_size: Math.abs(fit.t), p_value: p, n: fit.n },
      evidence: {
        points: hist.map((h) => ({ label: h.observed_at, value: h.value })),
        unit,
      },
      vega_spec: trendSpec(hist.map((h) => ({ label: h.observed_at, value: h.value })), fit, unit, phrase(o.metric)),
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 5. Distribution shift — the mix changed, not just the total
// =================================================================

function distributionShift(store: GraphStore, def: SourceDef, current: Observation[], now: string): Insight[] {
  const out: Insight[] = [];
  const byMetric = new Map<string, Observation[]>();
  for (const o of current) {
    if (!o.dim || o.value < 0) continue;
    (byMetric.get(o.metric) ?? byMetric.set(o.metric, []).get(o.metric)!).push(o);
  }

  for (const [metric, obs] of byMetric) {
    if (obs.length < 6) continue;
    const nowTotal = obs.reduce((s, o) => s + o.value, 0);
    if (nowTotal < 20) continue; // chi-square is unreliable on tiny counts

    // Expected mix = each dimension's average share across prior sweeps.
    const expected: number[] = [];
    const observed: number[] = [];
    const labels: string[] = [];
    let usable = 0;
    for (const o of obs) {
      const hist = store.history(def.kind, metric, o.dim, 60);
      const prior = hist.slice(0, -1).map((h) => h.value);
      if (prior.length < MIN_HISTORY) continue;
      usable++;
      labels.push(o.dim);
      observed.push(o.value);
      expected.push(Math.max(0.5, mean(prior)));
    }
    if (usable < 6) continue;

    // Rescale expectation to the current total so a pure volume change
    // doesn't masquerade as a change in composition.
    const expTotal = expected.reduce((a, b) => a + b, 0);
    const scale = expTotal > 0 ? nowTotal / expTotal : 1;
    const exp = expected.map((e) => Math.max(0.5, e * scale));

    let chi2 = 0;
    for (let i = 0; i < observed.length; i++) chi2 += (observed[i] - exp[i]) ** 2 / exp[i];
    const df = observed.length - 1;
    const p = pFromChiSquare(chi2, df);
    if (p > MAX_P) continue;
    // Cramér's V for a goodness-of-fit test — effect size independent of n.
    const v = Math.sqrt(chi2 / (nowTotal * df));
    if (v < 0.15) continue;

    const movers = labels
      .map((l, i) => ({ label: l, obs: observed[i], exp: exp[i], d: observed[i] - exp[i] }))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
      .slice(0, 10);

    out.push({
      id: `ins_${uid()}`,
      detector: "distribution_shift",
      source_kind: def.kind,
      headline:
        `${def.label}: the mix of ${phrase(metric)} shifted (Cramér's V ${v.toFixed(2)}, χ²=${chi2.toFixed(0)}, df=${df}) — ` +
        movers.slice(0, 3).map((m) => `${m.label} ${m.d > 0 ? "+" : ""}${fmt(m.d)} vs expected`).join(", "),
      statistic: { name: "χ² goodness-of-fit (Cramér's V)", value: chi2, effect_size: v * 20, p_value: p, n: Math.round(nowTotal) },
      evidence: {
        points: movers.map((m) => ({ label: m.label, value: m.obs })),
        baseline: movers.map((m) => ({ label: m.label, value: m.exp })),
        unit: unitOf(def, metric),
      },
      vega_spec: obsVsExpSpec(movers, phrase(metric)),
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 6. Cross-source correlation — the one that spans domains
// =================================================================

export function crossCorrelations(store: GraphStore, now: string): Insight[] {
  const out: Insight[] = [];
  // Only scalar series, which are directly comparable sweep-to-sweep.
  const series: { kind: string; metric: string; values: number[]; stamps: string[] }[] = [];
  for (const def of SOURCE_BY_KIND.values()) {
    for (const metric of Object.keys(def.units ?? {})) {
      const h = store.history(def.kind, metric, "", 200);
      if (h.length >= 12 && sd(h.map((x) => x.value)) > 0) {
        series.push({ kind: def.kind, metric, values: h.map((x) => x.value), stamps: h.map((x) => x.observed_at) });
      }
    }
  }

  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i], b = series[j];
      if (a.kind === b.kind) continue; // within-source correlation is mostly plumbing
      const n = Math.min(a.values.length, b.values.length);
      if (n < 12) continue;
      const { r } = pearson(a.values.slice(-n), b.values.slice(-n));
      if (Math.abs(r) < 0.8) continue;
      const p = correlationP(r, n);
      if (p > MAX_P) continue;

      const da = SOURCE_BY_KIND.get(a.kind), db = SOURCE_BY_KIND.get(b.kind);
      out.push({
        id: `ins_${uid()}`,
        detector: "cross_correlation",
        source_kind: `${a.kind}+${b.kind}`,
        headline:
          `${da?.label ?? a.kind} ${phrase(a.metric)} and ${db?.label ?? b.kind} ${phrase(b.metric)} ` +
          `move together: r=${r.toFixed(2)} over ${n} aligned sweeps`,
        statistic: { name: "Pearson r (Fisher z)", value: r, effect_size: Math.abs(r) * 8, p_value: p, n },
        evidence: {
          points: a.values.slice(-n).map((v, k) => ({ label: a.stamps.slice(-n)[k], value: v })),
          baseline: b.values.slice(-n).map((v, k) => ({ label: b.stamps.slice(-n)[k], value: v })),
        },
        vega_spec: scatterSpec(a.values.slice(-n), b.values.slice(-n), `${a.kind} ${phrase(a.metric)}`, `${b.kind} ${phrase(b.metric)}`),
        score: 0,
        detected_at: now,
      });
    }
  }
  return out;
}

// =================================================================
// Orchestration + scoring
// =================================================================

export function runDetectors(store: GraphStore, kind: string, current: Observation[], now: string): Insight[] {
  const def = SOURCE_BY_KIND.get(kind);
  if (!def || !current.length) return [];
  return [
    ...crossSectionalOutliers(def, current, now),
    ...concentration(def, current, now),
    ...levelShifts(store, def, current, now),
    ...trends(store, def, current, now),
    ...distributionShift(store, def, current, now),
  ];
}

/**
 * Composite rank. Deliberately multiplicative: a claim must be strong AND
 * well-sampled AND not something we already said. Any one of those at zero
 * sinks it, which is what stops the feed turning into the same five
 * observations repeated forever.
 */
export function scoreInsight(ins: Insight, timesSeen: number): number {
  const effect = Math.min(1, ins.statistic.effect_size / 8);
  const confidence = Math.min(1, 1 - ins.statistic.p_value);
  const sample = Math.min(1, Math.log10(1 + ins.statistic.n) / Math.log10(51));
  const novelty = 1 / (1 + timesSeen);
  // Longitudinal claims say more about the world than a single snapshot does.
  const depth: Record<DetectorKind, number> = {
    zscore_outlier: 0.85,
    concentration: 0.7,
    trend_break: 1.0,
    distribution_shift: 0.95,
    cross_correlation: 1.0,
  };
  return effect * confidence * sample * novelty * depth[ins.detector];
}

/** Stable identity for a claim, so repeats decay instead of re-surfacing. */
export function fingerprint(ins: Insight): string {
  const top = ins.evidence.points.slice(0, 3).map((p) => p.label).join("|");
  return `${ins.detector}:${ins.source_kind}:${ins.statistic.name}:${top}`;
}

// =================================================================
// Vega-Lite specs — charts are part of the claim, not decoration
// =================================================================

const BASE = {
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  background: "transparent",
  config: {
    axis: { labelColor: "#9e9eac", titleColor: "#9e9eac", gridColor: "#2a2a30", domainColor: "#2a2a30", labelFontSize: 10, titleFontSize: 10 },
    legend: { labelColor: "#9e9eac", titleColor: "#9e9eac" },
    view: { stroke: "transparent" },
  },
};

const ACCENT = "#6a5ce0";
const ACCENT_DIM = "#b4adff";
const WARN = "#ffb020";

function barSpec(points: { label: string; value: number }[], baseline: number, unit: string, title: string) {
  return {
    ...BASE,
    data: { values: points.map((p, i) => ({ ...p, rank: i })) },
    layer: [
      {
        mark: { type: "bar", cornerRadiusEnd: 2 },
        encoding: {
          y: { field: "label", type: "nominal", sort: { field: "rank" }, axis: { title: null, labelLimit: 150 } },
          x: { field: "value", type: "quantitative", axis: { title: unit || title } },
          color: { condition: { test: "datum.rank === 0", value: WARN }, value: ACCENT },
        },
      },
      {
        mark: { type: "rule", color: "#9e9eac", strokeDash: [4, 3] },
        encoding: { x: { datum: baseline } },
      },
    ],
  };
}

function lineSpec(points: { label: string; value: number }[], baseline: number, unit: string, title: string) {
  return {
    ...BASE,
    data: { values: points },
    layer: [
      {
        mark: { type: "line", color: ACCENT, point: { filled: true, size: 24, color: ACCENT } },
        encoding: {
          x: { field: "label", type: "temporal", axis: { title: null, format: "%b %d %H:%M" } },
          y: { field: "value", type: "quantitative", axis: { title: unit || title }, scale: { zero: false } },
        },
      },
      { mark: { type: "rule", color: "#9e9eac", strokeDash: [4, 3] }, encoding: { y: { datum: baseline } } },
    ],
  };
}

function trendSpec(points: { label: string; value: number }[], fit: { slope: number; intercept: number }, unit: string, title: string) {
  return {
    ...BASE,
    data: { values: points.map((p, i) => ({ ...p, fitted: fit.intercept + fit.slope * i })) },
    layer: [
      {
        mark: { type: "point", filled: true, size: 28, color: ACCENT },
        encoding: {
          x: { field: "label", type: "temporal", axis: { title: null, format: "%b %d %H:%M" } },
          y: { field: "value", type: "quantitative", axis: { title: unit || title }, scale: { zero: false } },
        },
      },
      {
        mark: { type: "line", color: WARN, strokeWidth: 2 },
        encoding: { x: { field: "label", type: "temporal" }, y: { field: "fitted", type: "quantitative" } },
      },
    ],
  };
}

function obsVsExpSpec(movers: { label: string; obs: number; exp: number }[], title: string) {
  const values = movers.flatMap((m) => [
    { label: m.label, kind: "observed", value: m.obs },
    { label: m.label, kind: "expected", value: m.exp },
  ]);
  return {
    ...BASE,
    data: { values },
    mark: { type: "bar", cornerRadiusEnd: 2 },
    encoding: {
      y: { field: "label", type: "nominal", axis: { title: null, labelLimit: 150 } },
      x: { field: "value", type: "quantitative", axis: { title: title } },
      yOffset: { field: "kind" },
      color: {
        field: "kind",
        type: "nominal",
        scale: { domain: ["observed", "expected"], range: [ACCENT, "#5a5a66"] },
        legend: { title: null, orient: "top" },
      },
    },
  };
}

function lorenzSpec(values: number[], title: string) {
  const xs = [...values].sort((a, b) => a - b);
  const total = xs.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  const curve = [{ pop: 0, share: 0, equality: 0 }];
  xs.forEach((v, i) => {
    cum += v;
    curve.push({ pop: ((i + 1) / xs.length) * 100, share: (cum / total) * 100, equality: ((i + 1) / xs.length) * 100 });
  });
  return {
    ...BASE,
    data: { values: curve },
    layer: [
      {
        mark: { type: "line", color: "#5a5a66", strokeDash: [4, 3] },
        encoding: {
          x: { field: "pop", type: "quantitative", axis: { title: `% of ${title} categories` } },
          y: { field: "equality", type: "quantitative", axis: { title: "% of total" } },
        },
      },
      {
        mark: { type: "area", color: ACCENT, opacity: 0.25, line: { color: ACCENT, strokeWidth: 2 } },
        encoding: {
          x: { field: "pop", type: "quantitative" },
          y: { field: "share", type: "quantitative" },
        },
      },
    ],
  };
}

function scatterSpec(a: number[], b: number[], xTitle: string, yTitle: string) {
  return {
    ...BASE,
    data: { values: a.map((v, i) => ({ a: v, b: b[i] })) },
    layer: [
      {
        mark: { type: "point", filled: true, size: 45, color: ACCENT, opacity: 0.75 },
        encoding: {
          x: { field: "a", type: "quantitative", axis: { title: xTitle }, scale: { zero: false } },
          y: { field: "b", type: "quantitative", axis: { title: yTitle }, scale: { zero: false } },
        },
      },
      {
        mark: { type: "line", color: ACCENT_DIM, strokeWidth: 1.5 },
        transform: [{ regression: "b", on: "a" }],
        encoding: { x: { field: "a", type: "quantitative" }, y: { field: "b", type: "quantitative" } },
      },
    ],
  };
}
