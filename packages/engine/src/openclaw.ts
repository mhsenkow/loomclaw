// =================================================================
// OpenClaw bridge — the narrator, never the analyst
// =================================================================
// The statistic is computed before OpenClaw is ever invoked. The agent's
// only job is to say why a measured result might matter and what would
// falsify it. If it is unavailable the insight still ships, with a
// deterministic framing instead — the feed must never depend on a model
// being reachable, and a number must never be produced by one.
// =================================================================

import { spawn } from "node:child_process";
import type { ExecutionSpineStep, Insight } from "@loomclaw/core-schema";

export interface NarrationResult {
  text: string;
  via: "openclaw" | "deterministic";
  model?: string;
  error?: string;
  duration_ms: number;
}

const BIN = process.env.OPENCLAW_BIN ?? "openclaw";
const ENABLED = process.env.LOOMCLAW_OPENCLAW !== "0";
const TIMEOUT_S = Number(process.env.LOOMCLAW_OPENCLAW_TIMEOUT ?? 90);

let availability: { ok: boolean; detail: string } | null = null;

/** Probed once per process; the UI shows the result so the degraded path is never silent. */
export async function openclawStatus(): Promise<{ ok: boolean; detail: string }> {
  if (availability) return availability;
  if (!ENABLED) return (availability = { ok: false, detail: "disabled via LOOMCLAW_OPENCLAW=0" });
  const r = await run([BIN, "--version"], 15_000);
  availability = r.code === 0
    ? { ok: true, detail: r.stdout.trim().split("\n")[0] }
    : { ok: false, detail: r.stderr.trim().slice(0, 200) || "openclaw not on PATH" };
  return availability;
}

function run(argv: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

/** The framing we fall back to — still specific, because it is built from the statistic. */
function deterministicFraming(ins: Insight): string {
  const s = ins.statistic;
  const top = ins.evidence.points.slice(0, 3).map((p) => p.label).join(", ");
  const strength = s.effect_size > 6 ? "very strong" : s.effect_size > 4 ? "strong" : "moderate";
  const byDetector: Record<string, string> = {
    zscore_outlier: `A ${strength} deviation from the comparison set. Worth checking whether ${top} differs in how it is measured or reported before treating this as a real-world change.`,
    concentration: `Concentration this far above an even split usually reflects structure — a few dominant actors, or a reporting pipeline weighted toward them. The distinction matters for what you conclude.`,
    trend_break: `A sustained direction across ${s.n} observations rather than a single spike. The main alternative explanation is a change in the upstream feed itself, not in the world.`,
    distribution_shift: `The composition moved more than the total did, so this is not simply a volume change. ${top} account for most of the movement.`,
    cross_correlation: `Correlation over ${s.n} aligned observations. These are independent sources, so a shared driver is plausible — but with this few points a coincidence is not ruled out.`,
  };
  return `${byDetector[ins.detector] ?? ""} Statistic: ${s.name} = ${s.value.toFixed(3)}, p ≈ ${s.p_value.toExponential(1)}, n = ${s.n}.`;
}

const PROMPT = (ins: Insight) => `You are reviewing a statistical finding from a live societal-data monitor. The number has ALREADY been computed and verified. Do not recompute it, do not invent new figures, and do not add any statistic that is not listed below.

FINDING
  Source:      ${ins.source_kind}
  Detector:    ${ins.detector}
  Claim:       ${ins.headline}
  Statistic:   ${ins.statistic.name} = ${ins.statistic.value}
  Effect size: ${ins.statistic.effect_size.toFixed(2)}
  p-value:     ${ins.statistic.p_value.toExponential(2)}
  n:           ${ins.statistic.n}
  Top values:  ${ins.evidence.points.slice(0, 6).map((p) => `${p.label}=${p.value}`).join(", ")}

Write 2-3 sentences, plain prose, no headings or bullets:
1. What this would mean about the world if it is real.
2. The single most likely boring explanation (measurement artifact, reporting lag, feed change) that would make it NOT real.
Be concrete and skeptical. Do not pad. Do not restate the numbers.`;

/**
 * `useAgent` is the token circuit-breaker: false returns the local framing
 * without spawning anything, so a long Weave costs nothing extra.
 */
export async function narrate(ins: Insight, useAgent = true): Promise<NarrationResult> {
  const t0 = Date.now();
  if (!useAgent) {
    return { text: deterministicFraming(ins), via: "deterministic", duration_ms: Date.now() - t0 };
  }
  const status = await openclawStatus();
  if (!status.ok) {
    return { text: deterministicFraming(ins), via: "deterministic", error: status.detail, duration_ms: Date.now() - t0 };
  }

  const r = await run(
    [BIN, "agent", "exec", "--json", "--timeout", String(TIMEOUT_S), PROMPT(ins)],
    (TIMEOUT_S + 15) * 1000,
  );

  try {
    // The envelope is the last JSON object on stdout; config warnings precede it.
    const start = r.stdout.indexOf("{");
    const env = start >= 0 ? JSON.parse(r.stdout.slice(start, r.stdout.lastIndexOf("}") + 1)) : null;
    if (env?.ok && typeof env.final === "string" && env.final.trim()) {
      return { text: env.final.trim(), via: "openclaw", model: env.model ?? undefined, duration_ms: Date.now() - t0 };
    }
    return {
      text: deterministicFraming(ins),
      via: "deterministic",
      error: env?.error?.message?.split("\n")[0] ?? r.stderr.split("\n")[0] ?? "empty response",
      duration_ms: Date.now() - t0,
    };
  } catch {
    return {
      text: deterministicFraming(ins),
      via: "deterministic",
      error: (r.stderr || r.stdout).split("\n")[0]?.slice(0, 200) || "unparseable response",
      duration_ms: Date.now() - t0,
    };
  }
}

export function narrationStep(
  spineId: string,
  sequence: number,
  ins: Insight,
  res: NarrationResult,
): ExecutionSpineStep {
  return {
    step_id: `step_${Math.random().toString(36).slice(2, 10)}`,
    spine_id: spineId,
    sequence,
    tool_name: res.via === "openclaw" ? "openclaw_agent" : "deterministic_framing",
    input_args: { detector: ins.detector, source: ins.source_kind, model: res.model ?? null },
    stdout_preview: res.error ? `[fell back to local framing: ${res.error}] ${res.text}` : res.text,
    // A deliberate local framing is a success; only an attempted agent call that
    // failed is a failure, which is what the amber bead on the spine means.
    status: res.error ? "failed" : "success",
    duration_ms: res.duration_ms,
    started_at: new Date().toISOString(),
  };
}
