// =================================================================
// stats — the honest arithmetic behind every claim
// =================================================================
// Nothing here calls a model. A claim this file cannot support with an
// effect size, a sample size and a p-value does not get published.
// =================================================================

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** Median absolute deviation, scaled to be a consistent estimator of σ for normal data. */
export function mad(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Robust z-score. Uses MAD so a single extreme value cannot inflate the
 * spread and hide itself — the classic failure of a plain z-score on
 * heavy-tailed social data. Falls back to SD when MAD degenerates (which
 * happens when more than half the sample is identical).
 */
export function robustZ(x: number, xs: number[]): number {
  const scale = mad(xs) || sd(xs);
  if (!scale) return 0;
  return (x - median(xs)) / scale;
}

export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs), s = sd(xs);
  if (!s) return 0;
  return (n / ((n - 1) * (n - 2))) * xs.reduce((a, x) => a + ((x - m) / s) ** 3, 0);
}

export type Transform = "none" | "log" | "sqrt";

/**
 * Pick a variance-stabilizing transform from the data's shape.
 *
 * This is the difference between an accurate claim and a nonsense one.
 * Societal data is overwhelmingly heavy-tailed — market caps, city
 * populations, lobbying spend — and a z-score on raw values reports
 * absurdities like "1200σ" because the normal null is simply the wrong
 * model, not because anything unusual happened. Counts are Poisson-ish,
 * where sqrt stabilizes variance; multiplicative quantities are
 * log-normal-ish, where log does.
 */
export function chooseTransform(xs: number[]): Transform {
  if (xs.length < 4 || xs.some((v) => v < 0)) return "none";
  const sk = skewness(xs);
  if (sk < 1.5) return "none";
  const allIntish = xs.every((v) => Number.isInteger(v));
  const spread = Math.max(...xs) / Math.max(1e-9, median(xs) || 1);
  // Counts over a narrow range: sqrt. Anything spanning orders of magnitude: log.
  return allIntish && spread < 25 ? "sqrt" : "log";
}

export const applyTransform = (v: number, t: Transform) =>
  t === "log" ? Math.log1p(Math.max(0, v)) : t === "sqrt" ? Math.sqrt(Math.max(0, v)) : v;

export interface ScaledZ {
  z: number;
  transform: Transform;
  /** Median on the original scale, for the headline. */
  median: number;
  /** How many times the median the value is — the plain-language effect. */
  ratio: number;
}

/**
 * Robust z computed on the appropriate scale, reported with the transform
 * that was used so the claim can be audited rather than taken on trust.
 */
export function scaledRobustZ(x: number, xs: number[]): ScaledZ {
  const t = chooseTransform(xs);
  const tx = xs.map((v) => applyTransform(v, t));
  const z = robustZ(applyTransform(x, t), tx);
  const med = median(xs);
  return { z, transform: t, median: med, ratio: med > 0 ? x / med : Infinity };
}

// ---- distributions ----

/** Abramowitz & Stegun 7.1.26 — plenty accurate for ranking claims. */
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Two-sided p-value for a z statistic. */
export const pFromZ = (z: number) => Math.max(1e-12, 2 * (1 - normalCdf(Math.abs(z))));

/** Regularized upper incomplete gamma Q(s,x), via series / continued fraction. */
function gammaQ(s: number, x: number): number {
  if (x < 0 || s <= 0) return 1;
  if (x === 0) return 1;
  const lg = lgamma(s);
  if (x < s + 1) {
    // series for P(s,x)
    let ap = s, sum = 1 / s, del = sum;
    for (let i = 0; i < 300; i++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return 1 - sum * Math.exp(-x + s * Math.log(x) - lg);
  }
  // continued fraction for Q(s,x)
  let b = x + 1 - s, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - s);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + s * Math.log(x) - lg) * h;
}

function lgamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Upper-tail p-value for a chi-square statistic with `df` degrees of freedom. */
export const pFromChiSquare = (chi2: number, df: number) => (df <= 0 ? 1 : Math.max(1e-12, gammaQ(df / 2, chi2 / 2)));

// ---- regression & association ----

export interface Fit {
  slope: number;
  intercept: number;
  /** Standard error of the slope. */
  se: number;
  /** slope / se — how many standard errors the trend is from flat. */
  t: number;
  r2: number;
  n: number;
}

/** OLS of y on its index (0..n-1), i.e. trend per sweep. */
export function linearTrend(ys: number[]): Fit {
  const n = ys.length;
  if (n < 3) return { slope: 0, intercept: ys[0] ?? 0, se: 0, t: 0, r2: 0, n };
  const xs = ys.map((_, i) => i);
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return { slope: 0, intercept: my, se: 0, t: 0, r2: 0, n };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
    sst += (ys[i] - my) ** 2;
  }
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
  return { slope, intercept, se, t: se ? slope / se : 0, r2: sst ? 1 - sse / sst : 0, n };
}

export function pearson(a: number[], b: number[]): { r: number; n: number } {
  const n = Math.min(a.length, b.length);
  if (n < 3) return { r: 0, n };
  const x = a.slice(-n), y = b.slice(-n);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const d = Math.sqrt(sxx * syy);
  return { r: d ? sxy / d : 0, n };
}

/** Fisher z-transform — turns r into something approximately normal, so r gets a real p-value. */
export function correlationP(r: number, n: number): number {
  if (n < 4 || Math.abs(r) >= 1) return 1;
  const z = 0.5 * Math.log((1 + r) / (1 - r)) * Math.sqrt(n - 3);
  return pFromZ(z);
}

// ---- inequality ----

/** Gini coefficient: 0 = perfectly even, 1 = one dimension holds everything. */
export function gini(values: number[]): number {
  const xs = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n < 2) return 0;
  const total = xs.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * xs[i];
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/** Herfindahl–Hirschman index on shares (0–1). */
export function hhi(values: number[]): number {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return 0;
  return values.reduce((s, v) => s + (Math.max(0, v) / total) ** 2, 0);
}

/**
 * Expected Gini for `n` draws from a uniform distribution, by simulation-free
 * approximation. Used as the null so "concentrated" means concentrated
 * *relative to chance*, not just "above 0.4".
 */
export const uniformGiniNull = (n: number) => (n < 2 ? 0 : 1 / 3 - 1 / (3 * n));


/**
 * Whether a series carries enough variation to be worth testing.
 *
 * Several feeds return a fixed page size, so a metric like "stories on the
 * front page" is 30 every single sweep. Correlating two such series yields
 * r = ±1.000 at p < 1e-11 — a perfect, perfectly meaningless result, because
 * Pearson on two-valued data is determined by the two values alone. Requiring
 * real spread rejects that class of claim before it is ever made.
 */
export function isInformative(xs: number[], minDistinct = 6): boolean {
  if (xs.length < minDistinct) return false;
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  if (counts.size < minDistinct) return false;
  // A single repeated value must not dominate the series.
  return Math.max(...counts.values()) / xs.length <= 0.5;
}


/**
 * Benjamini-Hochberg false-discovery-rate control.
 *
 * The correlation scan tests every pair of scalar series across sources —
 * on the order of 200 tests per sweep. At an uncorrected p < 0.01 you expect
 * ~2 "significant" results from pure noise every single time, which is how a
 * monitor ends up reporting that earthquakes track Hacker News points. BH
 * controls the expected share of false claims among those published, and is
 * less brutal than Bonferroni on genuinely correlated families.
 *
 * Returns the indices that survive at the given FDR.
 */
export function benjaminiHochberg(pValues: number[], q = 0.01): number[] {
  const m = pValues.length;
  if (!m) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let cutoff = -1;
  for (let k = 0; k < m; k++) {
    if (order[k].p <= ((k + 1) / m) * q) cutoff = k;
  }
  return cutoff < 0 ? [] : order.slice(0, cutoff + 1).map((o) => o.i);
}


/**
 * Standardized exceedance of the largest category over an even split.
 *
 * For counts — commits per weekday, sessions per project, hours per app — the
 * natural question is "is this more than its share?", and the natural null is
 * that the total is spread evenly across the categories observed. Under that
 * null each category is Poisson(total/k), so the standardized residual is
 * (observed - expected)/sqrt(expected).
 *
 * This matters because a robust z is close to useless here: with seven
 * weekdays, MAD is computed from seven points and a genuinely lopsided week
 * cannot reach 3.5σ. The Poisson form has no such problem and asks a question
 * that actually means something about a person's rhythm.
 */
export interface Exceedance {
  z: number;
  expected: number;
  observed: number;
  /** Bonferroni-adjusted for having picked the largest of k categories. */
  p: number;
  k: number;
}

export function poissonExceedance(values: number[], top: number): Exceedance | null {
  const k = values.length;
  const total = values.reduce((a, b) => a + b, 0);
  if (k < 3 || total < 30) return null;
  const expected = total / k;
  if (expected <= 0) return null;
  const z = (top - expected) / Math.sqrt(expected);
  // The maximum of k categories was chosen *because* it was the maximum, so
  // its p-value must be corrected for that selection.
  const p = Math.min(1, k * pFromZ(z));
  return { z, expected, observed: top, p, k };
}

/** True when a series is count-like: non-negative whole numbers. */
export const isCountLike = (xs: number[]) =>
  xs.every((v) => Number.isInteger(v) && v >= 0);
