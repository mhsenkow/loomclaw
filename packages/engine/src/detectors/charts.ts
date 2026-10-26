// =================================================================
// Chart vocabulary — families, kinds, and choosing between them
// =================================================================
// Modelled on Loom's own catalogue: a chart belongs to an analytical
// family that states the question it answers, and a family holds several
// kinds suited to different shapes of data.
//
//   comparison    Who stands out?
//   trend         What is changing?
//   distribution  What is typical?
//   relationship  What moves together?
//   composition   Where is the concentration?
//
// The kind is chosen from what the data IS — cyclic, ordered, summable,
// long-tailed, dense — not from which detector happened to find it. Two
// findings from the same detector should not look alike if their evidence
// does not.
// =================================================================

export type ChartFamily = "comparison" | "trend" | "distribution" | "relationship" | "composition";

export type ChartKind =
  | "bar" | "lollipop" | "orderedBar" | "dumbbell" | "slope"
  | "line" | "area" | "calendar" | "stripes" | "trendFit"
  | "histogram" | "beeswarm"
  | "scatter" | "connectedScatter"
  | "pareto" | "lorenz" | "rose" | "treemap";

export const CHART_FAMILY: Record<ChartKind, ChartFamily> = {
  bar: "comparison", lollipop: "comparison", orderedBar: "comparison",
  dumbbell: "comparison", slope: "comparison",
  line: "trend", area: "trend", calendar: "trend", stripes: "trend", trendFit: "trend",
  histogram: "distribution", beeswarm: "distribution",
  scatter: "relationship", connectedScatter: "relationship",
  pareto: "composition", lorenz: "composition", rose: "composition", treemap: "composition",
};

export const CHART_LABEL: Record<ChartKind, string> = {
  bar: "Bar", lollipop: "Lollipop", orderedBar: "Ordered bar",
  dumbbell: "Dumbbell", slope: "Slope",
  line: "Line", area: "Area", calendar: "Calendar", stripes: "Stripes", trendFit: "Trend fit",
  histogram: "Histogram", beeswarm: "Beeswarm",
  scatter: "Scatter", connectedScatter: "Connected scatter",
  pareto: "Pareto", lorenz: "Lorenz", rose: "Rose", treemap: "Treemap",
};

export const FAMILY_PROMPT: Record<ChartFamily, string> = {
  comparison: "Who stands out?",
  trend: "What is changing?",
  distribution: "What is typical?",
  relationship: "What moves together?",
  composition: "Where is the concentration?",
};

// ---- shared theme ----

export const ACCENT = "#6a5ce0";
export const ACCENT_DIM = "#b4adff";
export const WARN = "#ffb020";
const GRID = "#2a2a30";
const MUTED = "#9e9eac";

export const BASE = {
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  background: "transparent",
  config: {
    axis: { labelColor: MUTED, titleColor: MUTED, gridColor: GRID, domainColor: GRID, labelFontSize: 10, titleFontSize: 10 },
    legend: { labelColor: MUTED, titleColor: MUTED, labelFontSize: 9, titleFontSize: 9 },
    view: { stroke: "transparent" },
  },
};

export type Pt = { label: string; value: number };

const HOURS = Array.from({ length: 24 }, (_, h) =>
  h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const isTemporal = (pts: Pt[]) => /^\d{4}-\d{2}-\d{2}T/.test(pts[0]?.label ?? "");
const isHours = (pts: Pt[]) => pts.length > 6 && pts.every((p) => HOURS.includes(p.label));
const isDays = (pts: Pt[]) => pts.every((p) => DAYS.includes(p.label));

/** Skew tells long-tailed evidence from evenly spread evidence. */
function skew(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / n);
  if (!sd) return 0;
  return xs.reduce((a, x) => a + ((x - m) / sd) ** 3, 0) / n;
}

/**
 * Pick the kind. Order matters: the most specific shape wins, so a cyclic
 * dimension is a rose before it is ever considered a bar.
 */
export function chooseKind(
  pts: Pt[], opts: { summable: boolean; family: ChartFamily; span?: number },
): ChartKind {
  const { summable, family } = opts;
  const n = pts.length;
  const sk = skew(pts.map((p) => p.value));

  if (family === "relationship") return (opts.span ?? 0) >= 40 ? "connectedScatter" : "scatter";

  // --- time first: a dated series is never a ranking ---
  if (isTemporal(pts)) {
    if (n >= 70) return "calendar";   // months of days: the grid shows seasonality
    if (n >= 28) return "stripes";    // long, but a grid would be sparse
    return summable ? "area" : "line";
  }

  // --- cyclic and ordered dimensions have one right answer ---
  if (isHours(pts)) return "rose";
  if (isDays(pts)) return "orderedBar";

  if (family === "composition") {
    return n >= 8 && sk > 1.2 ? "pareto" : "treemap";
  }

  /*
   * Within comparison, the shape of the distribution decides.
   *
   * A heavy tail is not really a ranking question — when one category holds
   * most of the total, "where is the concentration" is the honest reading,
   * and a Pareto answers it where a bar chart of twenty-four categories just
   * shows one tall bar and a lawn. A near-flat spread is not a ranking
   * either: nothing stands out, so show the spread. Only the middle — a few
   * distinguishable categories — is genuinely a ranking.
   */
  // Concentration measured directly, not inferred from skew: almost every
  // real-world ranking is skewed, so a skew gate sends everything to the
  // same chart. "Do the top three hold most of it" is the actual question
  // a Pareto answers, so ask that.
  const total = pts.reduce((a, p) => a + p.value, 0) || 1;
  const top3 = pts.slice(0, 3).reduce((a, p) => a + p.value, 0) / total;

  /*
   * Cuts taken from the measured spread of real findings rather than
   * guessed: across the current corpus the top-three share runs 0.35 to
   * 0.87 with terciles near 0.51 and 0.74, and skew runs 0.13 to 2.81 with
   * terciles near 1.28 and 1.71. Splitting at those terciles gives three
   * roughly equal groups, each of which genuinely wants a different chart.
   */
  if (n >= 6 && top3 >= 0.74) return "pareto";      // a few hold most of it
  if (n >= 6 && Math.abs(sk) <= 1.28) return "beeswarm"; // nothing stands far out
  if (n >= 10) return "lollipop";                   // a readable ranking, long
  return summable ? "bar" : "treemap";              // short: magnitudes, or shares
}

// ---- builders ----

export function build(kind: ChartKind, pts: Pt[], o: {
  unit?: string; title?: string; baseline?: number;
  baselinePts?: Pt[]; fit?: { slope: number; intercept: number };
}): Record<string, unknown> {
  const unit = o.unit || "";
  const title = o.title || "";
  const axis = unit || title || null;

  switch (kind) {
    case "rose": {
      const top = pts.reduce((a, b) => (b.value > a.value ? b : a)).label;
      const hour = (l: string) => {
        const m = l.match(/^(\d{1,2}) (AM|PM)$/);
        if (!m) return 0;
        const h = Number(m[1]) % 12;
        return m[2] === "PM" ? h + 12 : h;
      };
      return {
        ...BASE,
        data: { values: pts.map((p) => ({ ...p, hour: hour(p.label) })) },
        mark: { type: "arc", innerRadius: 24, stroke: "transparent" },
        encoding: {
          theta: { field: "hour", type: "quantitative", scale: { domain: [0, 24] }, axis: null },
          radius: { field: "value", type: "quantitative", scale: { type: "sqrt", zero: true }, axis: null },
          color: { condition: { test: `datum.label === '${top}'`, value: WARN }, value: ACCENT },
          tooltip: [{ field: "label", type: "nominal" }, { field: "value", type: "quantitative", title: axis }],
        },
        view: { stroke: null },
      };
    }

    case "treemap": {
      // Vega-Lite has no treemap mark; a stacked share bar carries the same
      // "parts of a whole" reading without pretending to be one.
      const total = pts.reduce((a, p) => a + p.value, 0) || 1;
      return {
        ...BASE,
        data: { values: pts.map((p) => ({ ...p, share: (p.value / total) * 100 })) },
        mark: { type: "bar", stroke: "#0a0a0c", strokeWidth: 1 },
        encoding: {
          x: { field: "share", type: "quantitative", stack: "normalize", axis: { title: "% of total", format: ".0f" } },
          color: {
            field: "label", type: "nominal",
            scale: { scheme: "purples" },
            legend: { title: null, orient: "bottom", columns: 3, symbolSize: 60 },
          },
          order: { field: "value", sort: "descending" },
          tooltip: [{ field: "label", type: "nominal" }, { field: "value", type: "quantitative", title: axis }],
        },
      };
    }

    case "calendar": {
      return {
        ...BASE,
        data: { values: pts },
        mark: { type: "rect", cornerRadius: 1.5 },
        encoding: {
          x: { field: "label", type: "ordinal", timeUnit: "week", axis: { title: null, labelOverlap: true, labelFontSize: 8 } },
          y: { field: "label", type: "ordinal", timeUnit: "day", axis: { title: null, labelFontSize: 8 } },
          color: {
            field: "value", type: "quantitative",
            scale: { scheme: "purples" },
            legend: { title: axis, orient: "right", gradientLength: 90 },
          },
          tooltip: [
            { field: "label", type: "temporal", title: "day", format: "%b %d" },
            { field: "value", type: "quantitative", title: axis },
          ],
        },
      };
    }

    case "stripes": {
      return {
        ...BASE,
        data: { values: pts },
        mark: { type: "rect" },
        encoding: {
          x: { field: "label", type: "temporal", axis: { title: null, format: "%b" } },
          color: {
            field: "value", type: "quantitative",
            scale: { scheme: "purpleblue" },
            legend: { title: axis, orient: "right", gradientLength: 80 },
          },
          tooltip: [
            { field: "label", type: "temporal", format: "%b %d" },
            { field: "value", type: "quantitative", title: axis },
          ],
        },
      };
    }

    case "beeswarm": {
      return {
        ...BASE,
        data: { values: pts },
        mark: { type: "circle", size: 90, opacity: .8 },
        encoding: {
          x: { field: "value", type: "quantitative", axis: { title: axis } },
          yOffset: { field: "label", type: "nominal" },
          color: { value: ACCENT },
          tooltip: [{ field: "label", type: "nominal" }, { field: "value", type: "quantitative", title: axis }],
        },
        height: 90,
      };
    }

    case "histogram": {
      return {
        ...BASE,
        data: { values: pts },
        mark: { type: "bar", cornerRadiusEnd: 1, color: ACCENT },
        encoding: {
          x: { field: "value", type: "quantitative", bin: { maxbins: 18 }, axis: { title: axis } },
          y: { aggregate: "count", type: "quantitative", axis: { title: "days" } },
        },
      };
    }

    case "area": {
      return {
        ...BASE,
        data: { values: pts },
        mark: { type: "area", line: { color: ACCENT, strokeWidth: 1.5 }, color: ACCENT, opacity: .28 },
        encoding: {
          x: { field: "label", type: "temporal", axis: { title: null, format: "%b %d" } },
          y: { field: "value", type: "quantitative", axis: { title: axis } },
        },
      };
    }

    case "line": {
      return {
        ...BASE,
        data: { values: pts },
        layer: [
          {
            mark: { type: "line", color: ACCENT, point: { filled: true, size: 22, color: ACCENT } },
            encoding: {
              x: { field: "label", type: "temporal", axis: { title: null, format: "%b %d" } },
              y: { field: "value", type: "quantitative", axis: { title: axis }, scale: { zero: false } },
            },
          },
          ...(o.baseline !== undefined
            ? [{ mark: { type: "rule", color: MUTED, strokeDash: [4, 3] }, encoding: { y: { datum: o.baseline } } }]
            : []),
        ],
      };
    }

    case "trendFit": {
      const vals = pts.map((p, i) => ({ ...p, fitted: (o.fit?.intercept ?? 0) + (o.fit?.slope ?? 0) * i }));
      return {
        ...BASE,
        data: { values: vals },
        layer: [
          {
            mark: { type: "point", filled: true, size: 26, color: ACCENT, opacity: .75 },
            encoding: {
              x: { field: "label", type: "temporal", axis: { title: null, format: "%b %d" } },
              y: { field: "value", type: "quantitative", axis: { title: axis }, scale: { zero: false } },
            },
          },
          {
            mark: { type: "line", color: WARN, strokeWidth: 2 },
            encoding: { x: { field: "label", type: "temporal" }, y: { field: "fitted", type: "quantitative" } },
          },
        ],
      };
    }

    case "orderedBar": {
      const order = isHours(pts) ? HOURS : DAYS;
      const top = pts.reduce((a, b) => (b.value > a.value ? b : a)).label;
      return {
        ...BASE,
        data: { values: pts },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 2 },
            encoding: {
              x: { field: "label", type: "ordinal", sort: order.filter((l) => pts.some((p) => p.label === l)), axis: { title: null, labelAngle: 0, labelOverlap: true } },
              y: { field: "value", type: "quantitative", axis: { title: axis } },
              color: { condition: { test: `datum.label === '${top}'`, value: WARN }, value: ACCENT },
            },
          },
          ...(o.baseline !== undefined
            ? [{ mark: { type: "rule", color: MUTED, strokeDash: [4, 3] }, encoding: { y: { datum: o.baseline } } }]
            : []),
        ],
      };
    }

    case "lollipop": {
      const vals = pts.map((p, i) => ({ ...p, rank: i }));
      return {
        ...BASE,
        data: { values: vals },
        layer: [
          {
            // x needs an explicit type here: paired with x2 and a `datum`
            // rather than a field, Vega-Lite cannot infer one and throws.
            mark: { type: "rule", color: "#4a4a56", strokeWidth: 1 },
            encoding: {
              y: { field: "label", type: "nominal", sort: { field: "rank" }, axis: { title: null, labelLimit: 140 } },
              // Both x and x2 need an explicit type. Paired with a `datum`
              // x, Vega-Lite cannot infer x2's and throws during compile.
              x: { datum: 0, type: "quantitative" },
              x2: { field: "value", type: "quantitative" },
            },
          },
          {
            mark: { type: "point", filled: true, size: 58 },
            encoding: {
              y: { field: "label", type: "nominal", sort: { field: "rank" } },
              x: { field: "value", type: "quantitative", axis: { title: axis } },
              color: { condition: { test: "datum.rank === 0", value: WARN }, value: ACCENT },
            },
          },
        ],
      };
    }

    case "dumbbell": {
      const vals = (o.baselinePts ?? []).map((b, i) => ({ label: b.label, exp: b.value, obs: pts[i]?.value ?? 0 }));
      return {
        ...BASE,
        data: { values: vals },
        layer: [
          {
            mark: { type: "rule", color: "#5a5a66", strokeWidth: 1.5 },
            encoding: {
              y: { field: "label", type: "nominal", sort: { field: "obs", order: "descending" }, axis: { title: null, labelLimit: 140 } },
              x: { field: "exp", type: "quantitative", axis: { title: axis } },
              x2: { field: "obs", type: "quantitative" },
            },
          },
          { mark: { type: "point", filled: true, size: 55, color: "#5a5a66" }, encoding: { y: { field: "label", type: "nominal" }, x: { field: "exp", type: "quantitative" } } },
          { mark: { type: "point", filled: true, size: 70, color: ACCENT }, encoding: { y: { field: "label", type: "nominal" }, x: { field: "obs", type: "quantitative" } } },
        ],
      };
    }

    case "pareto": {
      const total = pts.reduce((a, p) => a + p.value, 0) || 1;
      let run = 0;
      const vals = pts.map((p, i) => { run += p.value; return { ...p, rank: i, cumulative: (run / total) * 100 }; });
      return {
        ...BASE,
        data: { values: vals },
        resolve: { scale: { y: "independent" } },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 2, color: ACCENT, opacity: .85 },
            encoding: {
              x: { field: "label", type: "nominal", sort: { field: "rank" }, axis: { title: null, labelAngle: -35, labelLimit: 80 } },
              y: { field: "value", type: "quantitative", axis: { title: axis } },
            },
          },
          {
            mark: { type: "line", color: WARN, strokeWidth: 2, point: { filled: true, size: 18, color: WARN } },
            encoding: {
              x: { field: "label", type: "nominal", sort: { field: "rank" } },
              y: { field: "cumulative", type: "quantitative", axis: { title: "cumulative %", orient: "right" }, scale: { domain: [0, 100] } },
            },
          },
        ],
      };
    }

    case "lorenz": {
      const xs = pts.map((p) => p.value).sort((a, b) => a - b);
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
          { mark: { type: "line", color: "#5a5a66", strokeDash: [4, 3] }, encoding: { x: { field: "pop", type: "quantitative", axis: { title: "% of categories" } }, y: { field: "equality", type: "quantitative", axis: { title: "% of total" } } } },
          { mark: { type: "area", color: ACCENT, opacity: .25, line: { color: ACCENT, strokeWidth: 2 } }, encoding: { x: { field: "pop", type: "quantitative" }, y: { field: "share", type: "quantitative" } } },
        ],
      };
    }

    case "connectedScatter":
    case "scatter": {
      const b = o.baselinePts ?? [];
      const vals = pts.map((p, i) => ({ a: p.value, b: b[i]?.value ?? 0, i }));
      const layers: Record<string, unknown>[] = [
        {
          mark: { type: "point", filled: true, size: 45, color: ACCENT, opacity: .75 },
          encoding: {
            x: { field: "a", type: "quantitative", axis: { title: o.title ?? "" }, scale: { zero: false } },
            y: { field: "b", type: "quantitative", axis: { title: o.unit ?? "" }, scale: { zero: false } },
          },
        },
      ];
      if (kind === "connectedScatter") {
        layers.unshift({
          mark: { type: "line", color: ACCENT_DIM, strokeWidth: 1, opacity: .45 },
          encoding: {
            x: { field: "a", type: "quantitative" }, y: { field: "b", type: "quantitative" },
            order: { field: "i" },
          },
        });
      } else {
        layers.push({
          mark: { type: "line", color: ACCENT_DIM, strokeWidth: 1.5 },
          transform: [{ regression: "b", on: "a" }],
          encoding: { x: { field: "a", type: "quantitative" }, y: { field: "b", type: "quantitative" } },
        });
      }
      return { ...BASE, data: { values: vals }, layer: layers };
    }

    case "slope": {
      const vals = (o.baselinePts ?? []).flatMap((b, i) => [
        { label: b.label, side: "expected", value: b.value },
        { label: b.label, side: "observed", value: pts[i]?.value ?? 0 },
      ]);
      return {
        ...BASE,
        data: { values: vals },
        mark: { type: "line", point: { filled: true, size: 50 }, strokeWidth: 1.5 },
        encoding: {
          x: { field: "side", type: "ordinal", sort: ["expected", "observed"], axis: { title: null, labelAngle: 0 } },
          y: { field: "value", type: "quantitative", axis: { title: axis } },
          color: { field: "label", type: "nominal", scale: { scheme: "purples" }, legend: { title: null, orient: "right", symbolSize: 50 } },
          detail: { field: "label", type: "nominal" },
        },
      };
    }

    case "bar":
    default: {
      const vals = pts.map((p, i) => ({ ...p, rank: i }));
      return {
        ...BASE,
        data: { values: vals },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 2 },
            encoding: {
              y: { field: "label", type: "nominal", sort: { field: "rank" }, axis: { title: null, labelLimit: 150 } },
              x: { field: "value", type: "quantitative", axis: { title: axis } },
              color: { condition: { test: "datum.rank === 0", value: WARN }, value: ACCENT },
            },
          },
          ...(o.baseline !== undefined
            ? [{ mark: { type: "rule", color: MUTED, strokeDash: [4, 3] }, encoding: { x: { datum: o.baseline } } }]
            : []),
        ],
      };
    }
  }
}
