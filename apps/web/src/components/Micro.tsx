// =================================================================
// Micro-charts — the shape of the evidence, inline
// =================================================================
// Hand-rolled SVG rather than Vega: these render dozens at a time inside
// cards, and a full chart runtime per card is not worth it. They carry no
// axes or labels on purpose — a micro-chart's job is to let you see the
// shape and judge the claim yourself, not to be read off precisely.
// =================================================================

import type { Insight } from "../lib/types.ts";

const ACCENT = "var(--loom-accent)";
const WARN = "var(--loom-warning)";
const MUTED = "var(--loom-muted)";

/** A series over time. The last point is marked; the median is a dashed rule. */
export function Sparkline({
  values, width = 96, height = 24, showBaseline = true,
}: {
  values: number[]; width?: number; height?: number; showBaseline?: boolean;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const sorted = [...values].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const last = values[values.length - 1];
  const rising = last >= values[0];

  return (
    <svg width={width} height={height} className="micro" aria-hidden>
      {showBaseline && (
        <line x1={2} x2={width - 2} y1={y(med)} y2={y(med)} stroke={MUTED} strokeWidth={0.75} strokeDasharray="2 2" opacity={0.6} />
      )}
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2} fill={rising ? WARN : ACCENT} />
    </svg>
  );
}

/**
 * Ranked peers, leader highlighted, with the median as a vertical rule.
 * This is the one that makes an outlier claim self-evident: you see the bar
 * that broke away and how far the rest of the field sits behind it.
 */
export function MicroBars({
  points, width = 96, height = 24, max: cap = 12,
}: {
  points: { label: string; value: number }[]; width?: number; height?: number; max?: number;
}) {
  const vals = points.slice(0, cap).map((p) => p.value);
  if (vals.length < 2) return null;
  const max = Math.max(...vals, 0) || 1;
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const gap = 1;
  const bw = Math.max(1.5, (width - gap * (vals.length - 1)) / vals.length);

  return (
    <svg width={width} height={height} className="micro" aria-hidden>
      {vals.map((v, i) => {
        const h = Math.max(1, (v / max) * (height - 2));
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={height - h}
            width={bw}
            height={h}
            rx={0.8}
            fill={i === 0 ? WARN : ACCENT}
            opacity={i === 0 ? 1 : 0.55}
          />
        );
      })}
      <line
        x1={0} x2={width}
        y1={height - (med / max) * (height - 2)}
        y2={height - (med / max) * (height - 2)}
        stroke={MUTED} strokeWidth={0.75} strokeDasharray="2 2" opacity={0.75}
      />
    </svg>
  );
}

/** Lorenz curve against the line of equality — concentration at a glance. */
export function MicroLorenz({ points, width = 96, height = 24 }: { points: { value: number }[]; width?: number; height?: number }) {
  const xs = points.map((p) => p.value).filter((v) => v >= 0).sort((a, b) => a - b);
  if (xs.length < 3) return null;
  const total = xs.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  const pts = xs.map((v, i) => {
    cum += v;
    return [((i + 1) / xs.length) * width, height - (cum / total) * (height - 2)] as const;
  });
  const d = `M0,${height} ` + pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <svg width={width} height={height} className="micro" aria-hidden>
      <line x1={0} y1={height} x2={width} y2={2} stroke={MUTED} strokeWidth={0.75} strokeDasharray="2 2" opacity={0.7} />
      <path d={`${d} L${width},${height} Z`} fill={ACCENT} opacity={0.22} />
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={1.4} />
    </svg>
  );
}

/** Observed vs expected, paired — shows that the mix moved, not just the total. */
export function MicroPaired({
  points, baseline, width = 96, height = 24,
}: {
  points: { value: number }[]; baseline: { value: number }[]; width?: number; height?: number;
}) {
  const n = Math.min(points.length, baseline.length, 8);
  if (n < 2) return null;
  const max = Math.max(...points.slice(0, n).map((p) => p.value), ...baseline.slice(0, n).map((b) => b.value)) || 1;
  const slot = width / n;
  const bw = Math.max(1.2, slot / 2 - 0.6);

  return (
    <svg width={width} height={height} className="micro" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const ho = Math.max(1, (points[i].value / max) * (height - 2));
        const he = Math.max(1, (baseline[i].value / max) * (height - 2));
        return (
          <g key={i}>
            <rect x={i * slot} y={height - he} width={bw} height={he} rx={0.8} fill={MUTED} opacity={0.5} />
            <rect x={i * slot + bw + 0.6} y={height - ho} width={bw} height={ho} rx={0.8} fill={ACCENT} />
          </g>
        );
      })}
    </svg>
  );
}

/** Two aligned series as a scatter — the shape of a correlation. */
export function MicroScatter({
  a, b, width = 96, height = 24,
}: {
  a: { value: number }[]; b: { value: number }[]; width?: number; height?: number;
}) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const xs = a.slice(0, n).map((p) => p.value), ys = b.slice(0, n).map((p) => p.value);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const sx = (v: number) => ((v - xmin) / (xmax - xmin || 1)) * (width - 4) + 2;
  const sy = (v: number) => height - 2 - ((v - ymin) / (ymax - ymin || 1)) * (height - 4);

  return (
    <svg width={width} height={height} className="micro" aria-hidden>
      {xs.map((v, i) => <circle key={i} cx={sx(v)} cy={sy(ys[i])} r={1.4} fill={ACCENT} opacity={0.8} />)}
    </svg>
  );
}

/**
 * The right micro-chart for the claim being made. Each detector has a shape
 * that makes its own statistic legible — a correlation wants a scatter, a
 * concentration wants a Lorenz curve.
 */
export function Micro({ insight, width = 96, height = 24 }: { insight: Insight; width?: number; height?: number }) {
  const { evidence, detector } = insight;
  switch (detector) {
    case "concentration":
      return <MicroLorenz points={evidence.points} width={width} height={height} />;
    case "cross_correlation":
      return evidence.baseline
        ? <MicroScatter a={evidence.points} b={evidence.baseline} width={width} height={height} />
        : null;
    case "distribution_shift":
      return evidence.baseline
        ? <MicroPaired points={evidence.points} baseline={evidence.baseline} width={width} height={height} />
        : null;
    case "trend_break":
      return <Sparkline values={evidence.points.map((p) => p.value)} width={width} height={height} />;
    case "zscore_outlier":
    default: {
      // A longitudinal outlier's points are a time series; a cross-sectional
      // one's are ranked peers. Timestamps in the labels tell them apart.
      const temporal = /^\d{4}-\d{2}-\d{2}T/.test(evidence.points[0]?.label ?? "");
      return temporal
        ? <Sparkline values={evidence.points.map((p) => p.value)} width={width} height={height} />
        : <MicroBars points={evidence.points} width={width} height={height} />;
    }
  }
}
