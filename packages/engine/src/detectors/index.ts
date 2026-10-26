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
import { CHART_FAMILY, CHART_LABEL, build, chooseKind, type ChartFamily, type Pt } from "./charts.ts";
import { COLLECTOR_BY_KIND, type Collector } from "../collectors/index.ts";
import {
  benjaminiHochberg, correlationP, gini, isCountLike, isInformative, kruskalWallis,
  linearTrend, mean, median, pFromChiSquare, pFromZ, pearson, poissonExceedance,
  scaledRobustZ, sd, spearman, uniformGiniNull,
} from "./stats.ts";

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Pick a chart for this evidence, build it, and record what was picked.
 * Centralised so no detector can quietly hard-code a shape again — which
 * is how twenty-one of twenty-four findings ended up as the same bar.
 */
function chart(
  family: ChartFamily,
  pts: Pt[],
  o: { unit?: string; title?: string; baseline?: number; baselinePts?: Pt[]; fit?: { slope: number; intercept: number }; summable?: boolean; force?: Parameters<typeof build>[0] },
) {
  const kind = o.force ?? chooseKind(pts, { summable: o.summable ?? false, family, span: pts.length });
  return {
    vega_spec: build(kind, pts, o),
    chart: { kind, family: CHART_FAMILY[kind], label: CHART_LABEL[kind] },
  };
}

/** Minimum history before a longitudinal detector is allowed to speak. */
const MIN_HISTORY = 8;
/**
 * Correlation needs far more points than a level shift. At n≈13 a spurious
 * |r| > 0.8 between unrelated series is common, and no amount of p-value
 * decoration fixes an underpowered test.
 */
const MIN_CORR_N = 20;
/** Expected share of false claims tolerated among published correlations. */
const CORR_FDR = 0.01;
/** Materiality floor for a correlation on first differences. */
const MIN_CORR_R = 0.35;

/**
 * First differences of a series.
 *
 * Correlating two autocorrelated time series in *levels* is the classic
 * spurious-regression trap: any two series that happen to drift in the same
 * direction over the window will show a high r with a tiny p-value, which is
 * how a monitor ends up claiming earthquakes track Hacker News comments.
 * Differencing asks the only question worth asking — when one moves, does the
 * other move with it?
 */
const diff = (xs: number[]): number[] =>
  xs.slice(1).map((v, i) => v - xs[i]);
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

const unitOf = (def: Collector | undefined, metric: string) => def?.units?.[metric] ?? "";

/**
 * Units that denote a count of independent events, for which Poisson's
 * variance = mean assumption actually holds.
 *
 * Line counts and hours are integers too, but they are magnitudes, not event
 * counts: one commit can carry four thousand lines. Applying Poisson to them
 * reports absurdities like 136σ, because the real variance dwarfs the mean.
 */
const COUNT_UNITS = new Set([
  "commits", "sessions", "visits", "switches", "events", "repos", "domains",
  "messages", "stories", "papers", "requests", "alerts", "filings", "recalls",
  "quakes", "products", "inspections", "violations", "vehicles",
  // Days active is the burst-proof count: one day contributes at most one,
  // which is exactly the independence Poisson needs.
  "days",
]);

/**
 * Verb agreement for a metric phrase. "Your sleep hours is falling" reads as
 * a bug even when the statistic behind it is sound.
 */
const plural = (metric: string) => (/s$/.test(phrase(metric)) ? "are" : "is");

/** Metric name -> readable phrase, so headlines don't read like column names. */
const phrase = (metric: string) =>
  metric.replace(/^count_by_/, "").replace(/^(max|mean|total|amount)_/, "").replace(/_by_\w+$/, "").replace(/_/g, " ");

// =================================================================
// 1. Cross-sectional outlier — who is unlike their peers right now
// =================================================================

function crossSectionalOutliers(def: Collector, current: Observation[], now: string): Insight[] {
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
    const unit = unitOf(def, metric);

    // Counts get a Poisson test against an even split; continuous values get
    // a robust z against their peers. Using one test for both is what made a
    // lopsided working week look unremarkable.
    const counts =
      COUNT_UNITS.has(unit) && isCountLike(values) ? poissonExceedance(values, top.value) : null;

    let z: number, p: number, statName: string, comparison: string;
    if (counts) {
      if (counts.z < 4) continue;
      z = counts.z;
      p = counts.p;
      statName = `Poisson exceedance vs even split (Bonferroni over ${counts.k})`;
      comparison =
        `${fmt(top.value)}${unit ? " " + unit : ""} against ${fmt(counts.expected)} if spread evenly ` +
        `across ${counts.k} — ${(top.value / counts.expected).toFixed(1)}× its share (${z.toFixed(1)}σ)`;
    } else {
      const r = scaledRobustZ(top.value, values);
      if (!Number.isFinite(r.z) || Math.abs(r.z) < 3.5) continue;
      if (triviallySmall(top.value, r.median)) continue;
      z = r.z;
      p = pFromZ(r.z);
      statName = `robust z (MAD${r.transform === "none" ? "" : ", " + r.transform}) across peers`;
      // Share of the total is the honest framing for a magnitude: "37% of your
      // tracked hours" says something, where "249× the typical app" mostly
      // reflects how many barely-used apps are in the list.
      const total = values.reduce((a, b) => a + b, 0);
      const share = total > 0 ? (top.value / total) * 100 : 0;
      comparison =
        `${fmt(top.value)}${unit ? " " + unit : ""} — ${share.toFixed(0)}% of ` +
        `${def.scope === "self" ? "your " : "the "}${fmt(total)}` +
        `${unit ? " " + unit : ""} across ${values.length} (${z.toFixed(1)}σ vs the rest)`;
    }
    if (p > MAX_P) continue;
    const med = median(values);

    out.push({
      id: `ins_${uid()}`,
      detector: "zscore_outlier",
      source_kind: def.kind,
      metric,
      headline: def.scope === "self"
        ? `${top.dim} leads your ${phrase(metric)}: ${comparison}`
        : `${def.label}: ${top.dim} leads ${phrase(metric)} — ${comparison}`,
      statistic: { name: statName, value: z, effect_size: Math.abs(z), p_value: p, n: obs.length },
      evidence: {
        points: ranked.slice(0, 12).map((o) => ({ label: o.dim, value: o.value })),
        baseline: [{ label: "peer median", value: med }],
        unit,
      },
      ...chart("comparison", ranked.slice(0, 12).map((o) => ({ label: o.dim, value: o.value })), {
        unit, title: phrase(metric), baseline: med,
        summable: COUNT_UNITS.has(unit) || unit === "USD" || unit === "lines" || unit === "hours",
      }),
      merit: 0,
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 2. Concentration — is this domain dominated by a few actors
// =================================================================

function concentration(def: Collector, current: Observation[], now: string): Insight[] {
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
      metric,
      headline:
        (def.scope === "self"
          ? `Your ${phrase(metric)}: concentrated in a few places `
          : `${def.label}: ${phrase(metric)} is concentrated `) +
        `(Gini ${g.toFixed(2)} vs ${nullG.toFixed(2)} if even) — ` +
        `${ranked.slice(0, 3).map((o) => o.dim).join(", ")} hold ${top3Share.toFixed(0)}% of ${fmt(total)}${unit ? " " + unit : ""} across ${values.length}`,
      statistic: { name: "Gini vs uniform null", value: g, effect_size: z, p_value: p, n: values.length },
      evidence: {
        points: ranked.slice(0, 12).map((o) => ({ label: o.dim, value: o.value })),
        unit,
      },
      ...chart("composition", ranked.slice(0, 12).map((o) => ({ label: o.dim, value: o.value })), {
        unit, title: phrase(metric),
      }),
      merit: 0,
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 3. Longitudinal level shift — a scalar jumping off its own baseline
// =================================================================

function levelShifts(store: GraphStore, def: Collector, current: Observation[], now: string): Insight[] {
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
      metric: o.metric,
      headline:
        (def.scope === "self"
          ? `Your ${phrase(o.metric)} ${plural(o.metric)} ${Math.abs(z).toFixed(1)}σ ${dir} your own baseline — `
          : `${def.label}: ${phrase(o.metric)} ${plural(o.metric)} ${Math.abs(z).toFixed(1)}σ ${dir} its baseline — `) +
        `${fmt(o.value)}${unit ? " " + unit : ""} vs a ${prior.length}-day median of ${fmt(base)}`,
      statistic: { name: `robust z vs own history (MAD${scaleNote})`, value: z, effect_size: Math.abs(z), p_value: p, n: prior.length },
      evidence: {
        points: hist.slice(-60).map((h) => ({ label: h.observed_at, value: h.value })),
        baseline: [{ label: "median", value: base }],
        unit,
      },
      ...chart("trend", hist.slice(-90).map((h) => ({ label: h.observed_at, value: h.value })), {
        unit, title: phrase(o.metric), baseline: base,
        summable: COUNT_UNITS.has(unit),
      }),
      merit: 0,
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 4. Trend break — a sustained direction, not a single spike
// =================================================================

function trends(store: GraphStore, def: Collector, current: Observation[], now: string): Insight[] {
  const out: Insight[] = [];
  const targets = current.filter((o) => !o.dim);

  for (const o of targets) {
    const hist = store.history(def.kind, o.metric, "", 120);
    if (hist.length < 12) continue;
    const ys = hist.map((h) => h.value);
    if (!isInformative(ys)) continue;
    const fit = linearTrend(ys);
    // |t| > 4 on >=12 points is a slope you would rarely get from noise.
    if (!Number.isFinite(fit.t) || Math.abs(fit.t) < 4) continue;
    /*
     * R² was the wrong second gate and it silenced this detector entirely.
     *
     * R² is a descriptive goodness-of-fit, not a test: it reports how much
     * variance the line explains, which is naturally low in any noisy
     * real-world series even when the slope is certain. Global Wikipedia
     * readership trends at |t| = 9.1 over 181 days with R² = 0.31 — that is
     * an overwhelming slope buried in daily noise, and requiring R² ≥ 0.5
     * threw it away along with every other real trend.
     *
     * The t-statistic already establishes the slope is non-zero. What it
     * does not establish is that the slope MATTERS, so the second gate is
     * now effect size: the trend must move the series by a visible fraction
     * of its own level across the window.
     */
    const level = Math.abs(mean(ys));
    const totalChange = Math.abs(fit.slope) * ys.length;
    if (level > 0 && totalChange / level < 0.05) continue;
    const p = pFromZ(fit.t);
    if (p > MAX_P) continue;

    const unit = unitOf(def, o.metric);
    const pctPerSweep = mean(ys) ? (fit.slope / Math.abs(mean(ys))) * 100 : 0;
    const dir = fit.slope > 0 ? "rising" : "falling";

    out.push({
      id: `ins_${uid()}`,
      detector: "trend_break",
      source_kind: def.kind,
      metric: o.metric,
      headline:
        (def.scope === "self"
          ? `Your ${phrase(o.metric)} ${plural(o.metric)} ${dir} steadily — `
          : `${def.label}: ${phrase(o.metric)} ${plural(o.metric)} ${dir} steadily — `) +
        `${fmt(fit.slope)}${unit ? " " + unit : ""} per day (${pctPerSweep >= 0 ? "+" : ""}${pctPerSweep.toFixed(1)}%), ` +
        `R²=${fit.r2.toFixed(2)} over ${fit.n} days`,
      statistic: { name: "OLS slope t-statistic", value: fit.slope, effect_size: Math.abs(fit.t), p_value: p, n: fit.n },
      evidence: {
        points: hist.map((h) => ({ label: h.observed_at, value: h.value })),
        unit,
      },
      /*
       * A fitted line is the most direct evidence for a slope, but only
       * while the points are still legible. At 181 days it is a smear of
       * dots with a line through it, where a calendar grid shows the same
       * decline AND the weekly rhythm underneath it. So the fit is forced
       * only for series short enough to read as points.
       */
      ...chart("trend", hist.map((h) => ({ label: h.observed_at, value: h.value })), {
        unit, title: phrase(o.metric), fit,
        ...(hist.length < 60 ? { force: "trendFit" as const } : {}),
        summable: COUNT_UNITS.has(unit),
      }),
      merit: 0,
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 5. Distribution shift — the mix changed, not just the total
// =================================================================

function distributionShift(store: GraphStore, def: Collector, current: Observation[], now: string): Insight[] {
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
      metric,
      headline:
        (def.scope === "self"
          ? `The mix of your ${phrase(metric)} shifted `
          : `${def.label}: the mix of ${phrase(metric)} shifted `) +
        `(Cramér's V ${v.toFixed(2)}, χ²=${chi2.toFixed(0)}, df=${df}) — ` +
        movers.slice(0, 3).map((m) => `${m.label} ${m.d > 0 ? "+" : ""}${fmt(m.d)} vs expected`).join(", "),
      statistic: { name: "χ² goodness-of-fit (Cramér's V)", value: chi2, effect_size: v * 20, p_value: p, n: Math.round(nowTotal) },
      evidence: {
        points: movers.map((m) => ({ label: m.label, value: m.obs })),
        baseline: movers.map((m) => ({ label: m.label, value: m.exp })),
        unit: unitOf(def, metric),
      },
      ...chart("comparison", movers.map((m) => ({ label: m.label, value: m.obs })), {
        unit: unitOf(def, metric), title: phrase(metric),
        baselinePts: movers.map((m) => ({ label: m.label, value: m.exp })),
        force: movers.length <= 6 ? "slope" : "dumbbell",
      }),
      merit: 0,
      score: 0,
      detected_at: now,
    });
  }
  return out;
}

// =================================================================
// 6. Weekly rhythm — does the day of the week decide this?
// =================================================================

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Minimum complete days before a weekday profile is worth computing. */
const MIN_RHYTHM_DAYS = 28;

/** Mean value per weekday, and the raw groups the test needs. */
function weekdayProfile(obs: { value: number; observed_at: string }[]) {
  const groups: number[][] = Array.from({ length: 7 }, () => []);
  for (const o of obs) {
    // dayKey stamps the local date at UTC midnight, so UTC day is the local day.
    const d = new Date(o.observed_at).getUTCDay();
    if (Number.isFinite(d)) groups[d].push(o.value);
  }
  const profile = groups.map((g, i) => ({
    label: WEEKDAYS[i],
    value: g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0,
    n: g.length,
  }));
  return { groups, profile };
}

/**
 * Does this series depend on the day of the week?
 *
 * Distinct from the Poisson weekday test, which asks whether one day holds
 * more of a total than an even split would give. This asks whether the
 * day-to-day values are drawn from different distributions at all — a
 * weekend that is reliably quieter shows up here and not there, because its
 * share can look ordinary while its level never does.
 */
function weeklyRhythms(store: GraphStore, def: Collector, current: Observation[], now: string): Insight[] {
  if (!def.dailyGrain) return [];
  const out: Insight[] = [];

  for (const o of current) {
    if (o.dim) continue;
    const hist = store.history(def.kind, o.metric, "", 400);
    if (hist.length < MIN_RHYTHM_DAYS) continue;

    const { groups, profile } = weekdayProfile(hist);
    if (profile.filter((p) => p.n >= 3).length < 5) continue;

    const kw = kruskalWallis(groups);
    if (!kw || kw.p > MAX_P) continue;
    // Explaining under a tenth of the rank variance is a rhythm nobody feels.
    if (kw.epsilonSq < 0.1) continue;

    const ranked = [...profile].filter((p) => p.n > 0).sort((a, b) => b.value - a.value);
    const high = ranked[0], low = ranked[ranked.length - 1];
    if (!high || !low || low.value <= 0) continue;
    const ratio = high.value / low.value;
    if (ratio < 1.3) continue;

    const unit = unitOf(def, o.metric);
    out.push({
      id: `ins_${uid()}`,
      detector: "weekly_rhythm",
      source_kind: def.kind,
      metric: o.metric,
      headline:
        (def.scope === "self"
          ? `Your week has a shape: ${phrase(o.metric)} runs `
          : `${def.label}: ${phrase(o.metric)} runs `) +
        `${ratio.toFixed(1)}× higher on ${high.label} than ${low.label} ` +
        `(${fmt(high.value)} vs ${fmt(low.value)}${unit ? " " + unit : ""}, across ${kw.n} days)`,
      statistic: {
        name: `Kruskal–Wallis across weekdays (ε²=${kw.epsilonSq.toFixed(2)})`,
        value: kw.h,
        effect_size: kw.epsilonSq * 20,
        p_value: kw.p,
        n: kw.n,
      },
      evidence: { points: profile.filter((p) => p.n > 0).map(({ label, value }) => ({ label, value })), unit },
      merit: 0,
      score: 0,
      detected_at: now,
      ...chart("comparison", profile.filter((p) => p.n > 0).map(({ label, value }) => ({ label, value })), {
        unit, title: phrase(o.metric), force: "orderedBar",
      }),
    });
  }
  return out;
}

// =================================================================
// 7. Shared rhythm — two records of you keeping the same week
// =================================================================

/**
 * Do two series keep the same week?
 *
 * A better relationship hypothesis than day-to-day correlation, and for a
 * concrete reason: differenced daily series are dominated by noise, so real
 * associations sit near r = 0.3 and never survive multiplicity correction.
 * Weekly profiles average that noise away. Seven points is a small sample,
 * so the bar is deliberately high and the claim is about shape — whether the
 * two rise and fall on the same days — not about level.
 */
export function sharedRhythms(store: GraphStore, rhythms: Insight[], now: string): Insight[] {
  // Only series that have already been shown to have a rhythm of their own.
  const withRhythm = rhythms.filter((r) => r.detector === "weekly_rhythm");
  if (withRhythm.length < 2) return [];

  const tested: { a: Insight; b: Insight; rho: number }[] = [];
  for (let i = 0; i < withRhythm.length; i++) {
    for (let j = i + 1; j < withRhythm.length; j++) {
      const a = withRhythm[i], b = withRhythm[j];
      if (a.source_kind === b.source_kind) continue;
      const days = a.evidence.points.map((p) => p.label)
        .filter((d) => b.evidence.points.some((q) => q.label === d));
      if (days.length < 6) continue;
      const av = days.map((d) => a.evidence.points.find((p) => p.label === d)!.value);
      const bv = days.map((d) => b.evidence.points.find((p) => p.label === d)!.value);
      tested.push({ a, b, rho: spearman(av, bv) });
    }
  }
  if (!tested.length) return [];

  const out: Insight[] = [];
  for (const { a, b, rho } of tested) {
    // Seven points: only a near-identical shape is worth claiming, and the
    // p-value is Bonferroni-corrected for every pair considered.
    if (Math.abs(rho) < 0.82) continue;
    const raw = correlationP(rho, 7);
    const p = Math.min(1, raw * tested.length);
    if (p > MAX_P) continue;

    const da = COLLECTOR_BY_KIND.get(a.source_kind), db = COLLECTOR_BY_KIND.get(b.source_kind);
    const agree = rho > 0;
    const days = a.evidence.points.map((x) => x.label);
    out.push({
      id: `ins_${uid()}`,
      detector: "shared_rhythm",
      source_kind: `${a.source_kind}+${b.source_kind}`,
      metric: `${a.metric}+${b.metric}`,
      headline:
        `${da?.label ?? a.source_kind} ${phrase(a.metric)} and ${db?.label ?? b.source_kind} ${phrase(b.metric)} ` +
        `keep ${agree ? "the same week" : "opposite weeks"}: their weekday shapes ` +
        `${agree ? "rise and fall together" : "move against each other"} at ρ=${rho.toFixed(2)} ` +
        `(Bonferroni over ${tested.length} pairs)`,
      statistic: {
        name: `Spearman ρ on weekday profiles (Bonferroni over ${tested.length})`,
        value: rho,
        effect_size: Math.abs(rho) * 8,
        p_value: p,
        n: days.length,
      },
      evidence: {
        points: a.evidence.points.map((x) => ({ label: x.label, value: x.value })),
        baseline: days.map((d) => b.evidence.points.find((q) => q.label === d)!),
        unit: a.evidence.unit,
      },
      merit: 0,
      score: 0,
      detected_at: now,
      ...chart("relationship", a.evidence.points.map((x) => ({ label: x.label, value: x.value })), {
        title: `${a.source_kind} ${phrase(a.metric)}`,
        unit: `${b.source_kind} ${phrase(b.metric)}`,
        baselinePts: days.map((d) => b.evidence.points.find((q) => q.label === d)!),
        force: "scatter",
      }),
    });
  }
  return out;
}

// =================================================================
// 8. Cross-source correlation — the one that spans domains
// =================================================================

export function crossCorrelations(store: GraphStore, now: string): Insight[] {
  const out: Insight[] = [];
  // Only scalar series, which are directly comparable sweep-to-sweep.
  const series: { kind: string; metric: string; values: number[]; stamps: string[] }[] = [];
  for (const def of COLLECTOR_BY_KIND.values()) {
    for (const metric of Object.keys(def.units ?? {})) {
      const h = store.history(def.kind, metric, "", 200);
      // A flat or two-valued series is an API constant, not a measurement.
      if (h.length >= 12 && sd(h.map((x) => x.value)) > 0 && isInformative(h.map((x) => x.value))) {
        series.push({ kind: def.kind, metric, values: h.map((x) => x.value), stamps: h.map((x) => x.observed_at) });
      }
    }
  }

  // Every pair is tested first, then the whole family is corrected together.
  // Filtering pair-by-pair on a raw p-value is precisely the mistake that
  // manufactures cross-domain coincidences.
  const tested: { a: typeof series[number]; b: typeof series[number]; r: number; n: number; p: number }[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i], b = series[j];
      if (a.kind === b.kind) continue; // within-source correlation is mostly plumbing
      const n = Math.min(a.values.length, b.values.length);
      if (n < MIN_CORR_N) continue;
      const da = diff(a.values.slice(-n)), db2 = diff(b.values.slice(-n));
      if (!isInformative(da, 5) || !isInformative(db2, 5)) continue;
      const { r } = pearson(da, db2);
      // |r| this close to 1 across independent societal feeds is numerical
      // degeneracy, not a discovery.
      if (Math.abs(r) > 0.995) continue;
      tested.push({ a, b, r, n: n - 1, p: correlationP(r, n - 1) });
    }
  }

  const survivors = new Set(benjaminiHochberg(tested.map((t) => t.p), CORR_FDR));
  for (const [idx, { a, b, r, n, p }] of tested.entries()) {
    if (!survivors.has(idx)) continue;
    /*
     * 0.8 was a floor borrowed from correlations on levels. Differencing
     * strips the shared trend that inflates those, so what remains is
     * genuinely weaker even when real — behavioural series correlate around
     * 0.2–0.4, not 0.8. The floor is a materiality bar; the FDR correction
     * above is what controls false positives, and it is strict.
     */
    if (Math.abs(r) < MIN_CORR_R) continue;
    {
      const da = COLLECTOR_BY_KIND.get(a.kind), db = COLLECTOR_BY_KIND.get(b.kind);
      /*
       * A correlation spanning your own data and a world feed is worth
       * naming as such: it is the only kind of finding neither half of this
       * could have produced alone. The statistic is identical either way —
       * only the framing changes.
       */
      const crossScope = !!da && !!db && da.scope !== db.scope;
      const selfIsA = da?.scope === "self";
      const selfLabel = selfIsA ? phrase(a.metric) : phrase(b.metric);
      const worldSide = selfIsA ? db : da;
      const worldMetric = selfIsA ? phrase(b.metric) : phrase(a.metric);

      out.push({
        id: `ins_${uid()}`,
        detector: "cross_correlation",
        source_kind: `${a.kind}+${b.kind}`,
        metric: `${a.metric}+${b.metric}`,
        headline: crossScope
          ? `You and the world: your ${selfLabel} moves with ` +
            `${worldSide?.label ?? "a world feed"} ${worldMetric} — day-to-day changes ` +
            `correlate at r=${r.toFixed(2)} over ${n} days ` +
            `(survives FDR correction across ${tested.length} pairs tested)`
          : `${da?.label ?? a.kind} ${phrase(a.metric)} and ${db?.label ?? b.kind} ${phrase(b.metric)} ` +
            `move together: day-to-day changes correlate at r=${r.toFixed(2)} over ${n} days ` +
            `(survives FDR correction across ${tested.length} pairs tested)`,
        statistic: {
          name: `Pearson r on first differences (Fisher z, BH-FDR ${CORR_FDR} over ${tested.length} tests)`,
          value: r, effect_size: Math.abs(r) * 8, p_value: p, n,
        },
        evidence: {
          points: diff(a.values.slice(-n)).map((v, k) => ({ label: a.stamps.slice(-n).slice(1)[k], value: v })),
          baseline: diff(b.values.slice(-n)).map((v, k) => ({ label: b.stamps.slice(-n).slice(1)[k], value: v })),
        },
        ...chart("relationship",
          diff(a.values.slice(-n)).map((v, k) => ({ label: String(k), value: v })), {
            title: `Δ ${a.kind} ${phrase(a.metric)}`,
            unit: `Δ ${b.kind} ${phrase(b.metric)}`,
            baselinePts: diff(b.values.slice(-n)).map((v, k) => ({ label: String(k), value: v })),
          }),
        merit: 0,
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

/**
 * Reduce a backfill to the single most recent observation per series.
 *
 * Collectors replay months of dated history on every sweep, so `current`
 * holds ~110 days at once rather than one snapshot. Handed that directly, a
 * longitudinal detector would test every historical day against the same
 * history and emit a hundred near-identical claims. The question these
 * detectors answer is "where does the series stand *now*", so they get the
 * latest point and read the rest out of the store.
 */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Drop the still-filling day from a daily-grain series.
 *
 * Collectors bucket by real calendar day, so "today" holds only the hours
 * elapsed so far. Compared against complete days it reads as a collapse —
 * the engine reported "lines per day 6.3σ below baseline: 1 vs 6,700"
 * at breakfast. Only longitudinal tests need this; a cross-sectional
 * comparison of today's dimensions against each other is unaffected.
 */
function completeDaysOnly(obs: Observation[], daily: boolean): Observation[] {
  if (!daily) return obs;
  const today = todayKey();
  const withoutToday = obs.filter((o) => !o.observed_at.startsWith(today));
  // If today is all there is, there is no complete day to compare against.
  return withoutToday.length ? withoutToday : [];
}

function latestPerSeries(current: Observation[]): Observation[] {
  const best = new Map<string, Observation>();
  for (const o of current) {
    const key = `${o.metric}\u0000${o.dim}`;
    const prev = best.get(key);
    if (!prev || o.observed_at > prev.observed_at) best.set(key, o);
  }
  return [...best.values()];
}

export function runDetectors(store: GraphStore, kind: string, current: Observation[], now: string): Insight[] {
  const def = COLLECTOR_BY_KIND.get(kind);
  if (!def || !current.length) return [];
  const latest = latestPerSeries(current);
  // Cross-sectional tests compare today's dimensions with each other, so a
  // partial day is fine. Longitudinal tests compare days, so it is not.
  const longitudinal = latestPerSeries(completeDaysOnly(current, def.dailyGrain ?? false));
  return [
    ...crossSectionalOutliers(def, latest, now),
    ...concentration(def, latest, now),
    ...levelShifts(store, def, longitudinal, now),
    ...trends(store, def, longitudinal, now),
    ...distributionShift(store, def, latest, now),
    ...weeklyRhythms(store, def, longitudinal, now),
  ];
}

/**
 * Statistical quality, independent of whether we have said it before.
 *
 * Merit and novelty must stay separate. Folding novelty into a single number
 * and then gating publication on it means a standing condition — a city whose
 * restaurants keep failing inspections — eventually drops out of the feed
 * entirely, not because it stopped being true but because it stopped being
 * new. Merit decides whether a claim is worth publishing; novelty only decides
 * where it ranks among the claims that are.
 */
export function meritOf(ins: Insight): number {
  const effect = Math.min(1, ins.statistic.effect_size / 8);
  const confidence = Math.min(1, 1 - ins.statistic.p_value);
  const sample = Math.min(1, Math.log10(1 + ins.statistic.n) / Math.log10(51));
  // Longitudinal claims say more about the world than a single snapshot does.
  const depth: Record<DetectorKind, number> = {
    zscore_outlier: 0.85,
    concentration: 0.7,
    trend_break: 1.0,
    distribution_shift: 0.95,
    cross_correlation: 1.0,
    // A rhythm is a standing fact about how you live, which outlasts any
    // single day's outlier; a shared one is rarer still.
    weekly_rhythm: 1.0,
    shared_rhythm: 1.0,
  };
  return effect * confidence * sample * depth[ins.detector];
}

/** Ranking value: merit discounted by how often we have already said this. */
export function scoreInsight(ins: Insight, timesSeen: number): number {
  const novelty = Math.max(0.25, 1 / (1 + timesSeen));
  return meritOf(ins) * novelty;
}

/** Stable identity for a claim, so repeats decay instead of re-surfacing. */
export function fingerprint(ins: Insight): string {
  const top = ins.evidence.points.slice(0, 3).map((p) => p.label).join("|");
  return `${ins.detector}:${ins.source_kind}:${ins.statistic.name}:${top}`;
}
