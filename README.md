# LOOM // CLAW

**What your own data says about you.**

A continuous analytical engine that reads the records this machine already keeps
about you, runs real statistical tests over them, and weaves what survives into a
narrative ranked by what you asked to understand.

Everything runs locally. Nothing about you is uploaded.

Built on two applications that already existed:

| Reused | What it provides |
| :-- | :-- |
| **`Loom_story_teller`** | Its design tokens, so this reads as one product with it — and its deployed worker, for the one collector that looks outside this machine (the air where you live). |
| **`openclaw`** (`OpenClaw-layoutexploration`) | The agent runtime, headless via `openclaw agent exec`, running on local Ollama. It writes the framing around a finding. It never produces a number. |

---

## The one idea

There is **one** graph. Two views are projections of it, not separate state:

- **The Weave** (macro) — the findings, ranked for what you asked about.
- **The Workshop** (micro) — the same findings inside the area of your life that
  produced them, each anchored to the Execution Spine that measured it.

`Cmd + /` switches lens.

---

## What it reads

Every collector reads something already on this machine.

| Collector | Source | What it can tell you |
| :-- | :-- | :-- |
| **What you build** | git history across every repo in `~` | when you work, on what, in what rhythm |
| **Where your attention goes** | macOS `knowledgeC.db` | which apps hold you, for how long, at what hour |
| **How you work with AI** | `~/.claude/projects` *(metadata only)* | when you reach for an agent, on which projects |
| **Where you read** | Chrome history *(domains only)* | **off by default** — see below |
| **Your body** | Apple Health export | sleep, steps, resting heart rate, HRV |
| **The air where you live** | Loom worker, filtered to your city | the one environmental measure acting on you directly |

Most repositories here are forks of other people's work, so commits are filtered
to your identity — without that this would measure strangers. Identities come from
`git config`, overridable with `LOOMCLAW_ME`.

### Getting your Apple Health data in

On your iPhone: **Health → your photo (top right) → Export All Health Data**.
It takes a few minutes and produces `export.zip`. AirDrop it to this Mac, or save
it to iCloud Drive, and leave it in `~/Downloads` — the collector finds it there
(also Desktop, Documents, or iCloud Downloads), unzips it itself, and reads
`export.xml`. Point `LOOMCLAW_HEALTH_EXPORT` at it if you keep it elsewhere.

Three things that file does to a naive reader, and how this handles them:

- **It is huge** — routinely gigabytes. It is streamed, never loaded into memory,
  and the parsed result is cached against the file's size and mtime, so only a
  fresh export re-parses.
- **Your iPhone and Watch both count the same steps.** Summing every record
  double-counts the day. The day's value is the best-informed single device, and
  overlapping sleep intervals are unioned — otherwise two devices recording one
  night produce sixteen hours of sleep.
- **Sleep crosses midnight.** A night is attributed to the morning you woke on,
  not the evening you lay down.

Re-export whenever you want fresher data; nothing syncs on its own.

**Browsing is opt-in** (`LOOMCLAW_BROWSING=1`). Browsing history is the most
revealing record on the machine, and a top-domain card is exactly the kind of
finding you might not want rendered on a screen someone else can see. Filtering it
silently would be both patronising and unreliable, so it simply stays off until
you ask.

---

## Why the findings are real

**Every number is computed before any model is involved.** OpenClaw receives a
finished statistic and is asked only what it would mean and what would falsify it.
It cannot change a value, and when it is unreachable the finding still ships with a
locally generated framing. The header says which happened.

| Detector | Question | Statistic |
| :-- | :-- | :-- |
| `zscore_outlier` | What stands out from the rest — or from your own past? | Poisson exceedance for event counts; robust z (MAD) for magnitudes |
| `concentration` | Is your time going to a few places or spread evenly? | Gini vs a uniform null |
| `trend_break` | Is something moving in a sustained direction? | OLS slope t-statistic |
| `distribution_shift` | Did the *mix* change, not just the total? | χ² goodness-of-fit, Cramér's V |
| `cross_correlation` | Do two different records of you move together? | Pearson r on first differences, Fisher z |

### Guards, each added because output was wrong without it

- **Right test for the data.** A robust z on seven weekdays cannot reach 3.5σ no
  matter how lopsided your week is; MAD on seven points is too blunt. Event counts
  get a Poisson test against an even split instead. But Poisson assumes variance =
  mean, which is false for *magnitudes* — applied to lines-of-code it reported
  136σ. Test selection follows the unit, not the datatype.
- **Variance-stabilizing transforms.** A raw z on heavy-tailed data reported
  "1230σ"; skew now selects a log or sqrt scale, named in the claim.
- **Base-rate guards.** "American cuisine has the most violations" is a fact about
  how many American restaurants exist. Population-driven counts are marked
  structural; rates are what get tested.
- **Correlation on first differences.** Correlating autocorrelated series *in
  levels* is spurious regression — any two drifting series score a high r.
- **FDR correction.** The correlation scan tests ~200 pairs; at an uncorrected
  p < 0.01 you get false positives every time. Benjamini-Hochberg at q = 0.01.
- **Honest `n`.** Observations are keyed on `(source, metric, dim, observed_at)`,
  so replaying history is idempotent and `n` counts real observations rather than
  duplicates from sweeping faster than the data changes.
- **Merit separate from novelty.** Merit gates publication; novelty only orders it.
  Folded together, a pattern that stayed true left the feed for being unsurprising.
- **Stable claim identity.** A claim's node id derives from its fingerprint, so
  re-detection updates it in place and anything not re-detected is retired.

---

## Asking it something

State what you want to understand in your own words — *"when do I do my best
work"*, *"where is my attention leaking"*, *"am I overworking"*, *"what am I
actually building"*. It resolves to topic weights that re-rank the graph. No
re-collection: the projection changes, the data does not.

Relevance scales the statistic rather than replacing it, so a weak finding in your
topic still loses to a very strong one next door.

---

## Run it

```bash
npm install && npm run dev
```

- Web: http://localhost:7718 · Engine: http://localhost:7717
- Graph: `~/.loomclaw/graph.db` (Node 24's built-in `node:sqlite`, no native deps)

Requires Node 24+ and Ollama for framing. A sweep runs on boot and every 15 minutes.

Personal data is **historical** — your repos hold years of dated commits — so
collectors backfill real daily buckets and trends work on the first run, rather
than accumulating one sweep at a time.

### OpenClaw framing

Narration runs fully locally. Two things were in the way, and the engine routes
around both rather than asking you to weaken anything:

1. `gateway.auth.token` points at a **write-only** secret-store entry, and
   `agent exec` resolves it *before* selecting a model — so every run failed with
   `GATEWAY_SECRET_REF_UNAVAILABLE` even with an explicit local `--model`. The
   engine passes a pinned config with no gateway block. Your config and secret
   store are untouched.
2. Without an override the run opens `~/.openclaw/agents/main`, whose SQLite lease
   your own OpenClaw holds. The engine uses its own `OPENCLAW_STATE_DIR`.

The model must be **tool-capable** — OpenClaw sends a tool payload even on the lean
surface, so `gemma3` is rejected and small-context models overflow on the system
prompt. See `packages/engine/OPENCLAW-NARRATOR.md`.

### Env

| Variable | Default | Purpose |
| :-- | :-- | :-- |
| `LOOMCLAW_ME` | from `git config` | your commit identities, comma-separated |
| `LOOMCLAW_CODE_ROOT` | `~` | where to look for repositories |
| `LOOMCLAW_WINDOW_DAYS` | `180` | how far back collectors reach |
| `LOOMCLAW_HEALTH_EXPORT` | auto-discovered | path to `export.zip`, the unzipped folder, or `export.xml` |
| `LOOMCLAW_HOME_CITY` | `New York` | city for the air-quality collector |
| `LOOMCLAW_BROWSING` | unset | `1` enables the browsing collector |
| `LOOMCLAW_OPENCLAW_MODEL` | `ollama/qwen2.5:7b` | narration model |
| `LOOMCLAW_NARRATE_BUDGET` | `3` | findings per sweep sent to the agent |
| `LOOMCLAW_SWEEP_MS` | `900000` | sweep interval |

---

## Layout

```
packages/core-schema   UnifiedGraphNode, GraphThreadEdge, ExecutionSpineStep, Insight
packages/engine
  collectors/          git · screentime · ai · health · browsing · environment
  detectors/stats.ts   MAD, transforms, Poisson, OLS, Pearson, Gini, χ², Fisher z, BH-FDR
  detectors/index.ts   the five detectors, scoring, Vega-Lite specs
  interests.ts         goals -> topic weights -> ranking
  openclaw.ts          headless agent bridge, local fallback
  graph.ts             SQLite: nodes, edges, spine_steps, observations
  sweep.ts             one full pass of the loop
apps/web               Weave lens, Workshop lens, micro-charts, drawer
```

## Known limits

- Screen Time needs Full Disk Access for your terminal, or that collector is skipped.
- Apple Health is a manual export, so it is a snapshot: it does not refresh until
  you export again.
- Topic routing is a keyword lexicon, not a classifier; an unmatched goal falls back
  to statistical strength and says so.
- Correlation between two records of you is not causation, and `cross_correlation`
  needs n ≥ 20 before it will speak at all.
- A git sweep over ~70 repositories takes ~20s; it is not yet incremental.
