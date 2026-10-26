# LOOM // CLAW

A two-lens spatial OS for human–agent co-reasoning over **live societal data**.

It continuously polls public data about the world, runs real statistical
detectors over it, and weaves the findings that survive into a narrative ranked
by what *you* said you care about.

Built on two applications that already existed:

| Reused | What it provides here |
| :-- | :-- |
| **`Loom_story_teller`** (deployed Worker at `loom.ibm.io`) | The data plane. `GET /api/source/<kind>` already handles upstream auth, fallbacks, shaping and caching for 65+ public feeds. LOOM // CLAW subscribes to it rather than re-implementing any of it. Its design tokens also carry over verbatim, so the two apps read as one product. |
| **`openclaw`** (`OpenClaw-layoutexploration`) | The agent runtime, invoked headlessly as `openclaw agent exec --json`. It writes the *framing* around a finding. It never produces a number. |

---

## The one idea

There is **one** graph. The two views are projections of it, not separate state:

- **The Weave** (macro) — nodes where `weave.is_pinned`, ordered by relevance to your goals.
- **The Workshop** (micro) — the same nodes placed at `spatial.{x,y}` inside the Board that produced them, each Board anchored to its Execution Spine.

`Cmd + /` switches lens. "Zoom into the board that produced this" jumps from a
story beat to the machinery behind it.

### Reading the shape, not the sentence

The Weave carries a full Vega-Lite chart per beat. The Workshop can't — it shows
dozens of cards at once — so it uses inline SVG micro-charts instead, chosen to
match the statistic being claimed:

| Claim | Micro-chart | What you see |
| :-- | :-- | :-- |
| outlier (peers) | ranked bars, leader highlighted, median rule | the bar that broke away |
| outlier (history) / trend | sparkline with median baseline | direction and where it is now |
| concentration | Lorenz curve vs the line of equality | how far from even |
| mix shift | paired observed/expected bars | which categories moved |
| correlation | scatter | whether it is a line or a cloud |

Board headers carry a sparkline of their own primary metric across sweeps, so the
canvas shows the situation before you read a word of it.

---

## Why the insights are real

**Every number is computed before any model is involved.** OpenClaw is handed a
finished statistic and asked only what it would mean and what would falsify it.
It cannot change a value, and if it is unreachable the finding still ships with
a locally generated framing. The status pill says which happened.

Five detectors, each reporting an effect size, a sample size and a p-value:

| Detector | Question | Statistic |
| :-- | :-- | :-- |
| `zscore_outlier` | Who is unlike their peers, or unlike their own past? | robust z (MAD) |
| `concentration` | Is this domain dominated by a few actors? | Gini vs a uniform null |
| `trend_break` | Is something moving in a sustained direction? | OLS slope t-statistic |
| `distribution_shift` | Did the *mix* change, not just the total? | χ² goodness-of-fit, Cramér's V |
| `cross_correlation` | Do two independent feeds move together? | Pearson r via Fisher z |

### Guards that keep it honest

These exist because the first working version produced all three of these:

- **Variance-stabilizing transforms.** A z-score on raw heavy-tailed data reported
  *"BTC is a 1230σ outlier"* — that is a misspecified null, not a finding. Skew now
  selects a log or sqrt scale, and the transform is named in the claim.
- **Absolute effect floors.** *"reuters.com: 2 stories vs a median of 1"* clears 5σ on
  count data and means nothing. A claim must also clear an absolute floor and a real multiple.
- **Structural metrics.** Bitcoin outranking every altcoin by market cap is the
  *definition* of the market, not news. Such metrics are excluded from
  cross-sectional detectors but still watched for change over time.
- **Novelty decay, floored.** A claim repeated across sweeps loses score, so the feed
  cannot become the same five observations forever — but the floor matters too: with
  unbounded decay a condition that stays true simply stops being reported at all.
- **Informative-series check.** Several feeds return a fixed page size, so a metric like
  "stories on the front page" is `30` every sweep. Correlating two such series gives
  *r = −1.000 at p < 1e-11* — perfect and perfectly meaningless, because Pearson on
  two-valued data is fixed by the two values. Series need real spread to be tested.
- **FDR correction on correlations.** The scan tests ~200 pairs per sweep; at an
  uncorrected p < 0.01 you expect false positives *every time*, which is how a monitor
  reports that earthquakes track Hacker News points. Benjamini-Hochberg at q = 0.01
  across the whole family, plus n ≥ 20, removed all of them.
- **Base-rate guards.** "American cuisine has the most critical violations" is a fact
  about how many American restaurants New York has, not about food safety. Raw counts
  governed by population size are marked structural; the rate forms
  (`critical_rate_by_cuisine`, `mean_score_by_cuisine`) are what get tested.
- **Correlation on first differences.** Correlating two autocorrelated series *in levels*
  is the spurious-regression trap — any two series drifting the same way score a high r.
  Differencing asks the only useful question: when one moves, does the other move with it?
- **Observations are deduplicated.** Sweeps run far more often than most sources publish
  (NYC Open Data is daily). Recording an identical payload every sweep would manufacture
  history — a test would see n=50 where the true independent sample is n=1. Unchanged
  payloads are not recorded, so `n` means what it says.
- **Retroactive retirement.** Tightening a detector re-validates what is already pinned,
  including records written before a schema change. A claim that would not pass today is
  unpinned, so the story never contradicts the engine that produced it.
- **Honest gaps.** If nothing cleared significance for a topic you asked about, the
  Weave says so rather than quietly substituting an adjacent topic.

---

## The persona layer

State a goal in your own words — *"follow the money in politics"*, *"food safety"*,
*"my city, day to day"*, *"where science is heading"*. It resolves to topic weights
that re-rank the graph. No re-fetch: the projection changes, the data does not.

Relevance scales the statistic rather than replacing it, so a weak finding in your
topic still loses to a very strong one next door — but an off-topic finding has to
be dramatically stronger to win.

---

## Run it

```bash
npm install && npm run dev
```

- Web: http://localhost:7718
- Engine: http://localhost:7717
- Graph: `~/.loomclaw/graph.db` (SQLite, via Node 24's built-in `node:sqlite` — no native deps)

Requires Node 24+. A sweep runs on boot and every 15 minutes.

### What you see when

Cross-sectional detectors (outlier, concentration) fire on the **first sweep**.
Longitudinal ones (trend, mix shift, correlation) need history and come online
after roughly **8 sweeps (~2 hours)** — they are comparing a series against its
own past, and there is no honest shortcut.

### OpenClaw framing

Narration runs **fully locally** against Ollama. No API key, no gateway, no network.

Two things were in the way, and the engine now routes around both rather than
asking you to weaken anything:

1. **The gateway secret.** The ambient `~/.openclaw/openclaw.json` points
   `gateway.auth.token` at a store entry that is *write-only by design*.
   `agent exec` resolves that reference before it selects a model, so every run
   failed with `GATEWAY_SECRET_REF_UNAVAILABLE` — even with an explicit
   `--model`. The engine passes `--config packages/engine/openclaw-narrator.json`,
   a pinned config with no gateway block at all. Your real config and your
   secret store are untouched.
2. **The agent DB lease.** Without an override the run opens
   `~/.openclaw/agents/main`, whose SQLite lease is held by your own running
   OpenClaw. The engine sets `OPENCLAW_STATE_DIR=~/.loomclaw/openclaw-state`, so
   it never contends with your main agent.

The model must be **tool-capable** — OpenClaw sends a tool payload even on the
lean surface, so `gemma3:27b` is rejected outright and small-context models like
`llama3.2` overflow on the system prompt alone.

| Variable | Default | Purpose |
| :-- | :-- | :-- |
| `LOOMCLAW_OPENCLAW_MODEL` | `ollama/llama3.3:latest` | Narration model |
| `LOOMCLAW_OPENCLAW_CONFIG` | `packages/engine/openclaw-narrator.json` | Pinned config |
| `LOOMCLAW_OPENCLAW_STATE` | `~/.loomclaw/openclaw-state` | Isolated agent state |
| `LOOMCLAW_OPENCLAW_TIMEOUT` | `420` | Seconds per narration |

The header reads *OpenClaw · n* when the agent wrote n framings this sweep, and
*Framing: local* when it fell back. Hovering says why.

### Env

| Variable | Default | Purpose |
| :-- | :-- | :-- |
| `LOOM_BASE_URL` | `https://loom.ibm.io` | Loom Worker serving the feeds |
| `LOOMCLAW_SWEEP_MS` | `900000` | Sweep interval |
| `LOOMCLAW_NARRATE_BUDGET` | `3` | Findings per sweep sent to OpenClaw (token circuit-breaker) |
| `LOOMCLAW_OPENCLAW` | — | `0` disables the agent entirely |
| `LOOMCLAW_DB` | `~/.loomclaw/graph.db` | Graph location |

```bash
npm run sweep   # one sweep in the terminal, same code path
```

---

## Layout

```
packages/core-schema   UnifiedGraphNode, GraphThreadEdge, ExecutionSpineStep, Insight
packages/engine
  sources/registry.ts  13 Loom feeds -> (metric, dim, value) observations
  detectors/stats.ts   MAD, transforms, OLS, Pearson, Gini, χ², Fisher z
  detectors/index.ts   the five detectors, scoring, Vega-Lite specs
  interests.ts         persona -> topic weights -> ranking
  openclaw.ts          headless agent bridge, with local fallback
  graph.ts             SQLite: nodes, edges, spine_steps, observations
  sweep.ts             one full pass of the loop
  server.ts            graph API + SSE stream + scheduler
apps/web               Vite + React: Weave lens, Workshop lens, drawer
```

## Current sources

**Earth / environment** `usgs` `nws` `aq`
**Cities** `nyc311` `nyc_inspections`
**US institutions** `faa_delays` `fda_recalls` `vehicle_recalls` `lobbying`
**World** `openfood` `internet_outages` `crypto`
**Web / science** `pageviews` `arxiv` `hn`

A metric is only included if it measures the world rather than the query. `hn.story_count`
is absent because the front page is always exactly 30 items; `nyc_inspections` reports
rates rather than counts because the feed is capped at 1000 rows. With a fixed
denominator, only rates carry information.

Adding one is a single entry in `packages/engine/src/sources/registry.ts` — any of
Loom's other ~50 feeds can be mounted the same way.

## Known limits

- Longitudinal detectors are cold until ~8 sweeps have accumulated; correlations need
  n ≥ 20, so they stay silent longer still. That is the honest cost of not reporting
  underpowered results.
- Topic routing is a keyword lexicon, not a classifier; an unmatched goal falls back
  to pure statistical strength and says so.
- Slow feeds accumulate history slowly *by design* — with daily sources, a trend needs
  real days. The alternative is a p-value computed from duplicate rows.
- Correlation over sweeps is not causal. FDR control bounds the share of false claims
  among those published; it does not make a surviving one meaningful.
- Threads between Boards exist in the schema and store, but the canvas does not draw
  the bezier edges yet.
