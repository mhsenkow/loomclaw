# `openclaw-narrator.json`

The pinned OpenClaw config the engine runs narration against. It is deliberately
minimal, and both of its omissions are load-bearing. OpenClaw's config schema
rejects unknown keys, so the reasoning lives here rather than as JSON comments.

### No `gateway` block

The ambient `~/.openclaw/openclaw.json` sets `gateway.auth.token` to a reference
into the secret store (`source: store`, `id: GATEWAY_AUTH_TOKEN`). That entry is
**write-only by design** — `openclaw secrets store list` marks it so, and it
cannot be read back.

`agent exec` resolves that reference *before* it selects a model, so every run
fails with `GATEWAY_SECRET_REF_UNAVAILABLE` even when `--model` names a local
provider that needs no gateway. Omitting the block entirely avoids the lookup.
The user's real config and secret store are never read or modified.

### Local provider only

Narration is framing, not analysis — every number is already computed and
verified before OpenClaw is invoked. Running it on local Ollama means the
insight loop needs no API key, no quota and no network.

### The model must be tool-capable

OpenClaw sends a tool payload even with `--local-model-lean`:

- `gemma3:27b` → `400 does not support tools`
- `llama3.2:latest` → tool-capable, but its 8192-token context overflows on the
  system prompt alone (`request (8195 tokens) exceeds the available context size`)

Entries here are ordered by practicality. `qwen2.5:7b` is the default: ~6s warm,
which matters when a sweep narrates several findings. `llama3.3` and `qwen2:72b`
are better writers and available via `LOOMCLAW_OPENCLAW_MODEL`, at the cost of a
long first load.

### State directory

Set by the engine, not this file. Without `OPENCLAW_STATE_DIR` the run opens
`~/.openclaw/agents/main`, whose SQLite lease is held by the user's own running
OpenClaw, and fails with `Auth profile store ... is unreadable`. The engine
points it at `~/.loomclaw/openclaw-state` so the two never contend.
