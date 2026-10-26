// =================================================================
// Graph store — the single source of truth for both lenses
// =================================================================
// Muse and Loom are projections over these tables, not separate state.
// `observations` is the analytical substrate: every sweep appends the
// metrics it measured, so detectors have real history to test against.
// =================================================================

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ExecutionSpineStep,
  GraphThreadEdge,
  UnifiedGraphNode,
} from "@loomclaw/core-schema";

export interface Observation {
  source_kind: string;
  metric: string;
  /** Dimension within the metric (region, tag, ticker…); "" when scalar. */
  dim: string;
  value: number;
  observed_at: string;
}

export class GraphStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id              TEXT PRIMARY KEY,
        parent_board_id TEXT,
        kind            TEXT NOT NULL,
        title           TEXT NOT NULL,
        spatial         TEXT NOT NULL,
        weave           TEXT NOT NULL,
        execution       TEXT NOT NULL,
        payload         TEXT NOT NULL,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_board_id);

      CREATE TABLE IF NOT EXISTS edges (
        id               TEXT PRIMARY KEY,
        source_node_id   TEXT NOT NULL,
        target_node_id   TEXT NOT NULL,
        transform_prompt TEXT,
        auto_propagate   INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS spine_steps (
        step_id        TEXT PRIMARY KEY,
        spine_id       TEXT NOT NULL,
        sequence       INTEGER NOT NULL,
        tool_name      TEXT NOT NULL,
        input_args     TEXT NOT NULL,
        stdout_preview TEXT NOT NULL,
        status         TEXT NOT NULL,
        duration_ms    INTEGER NOT NULL,
        started_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_spine ON spine_steps(spine_id, sequence);

      CREATE TABLE IF NOT EXISTS observations (
        source_kind TEXT NOT NULL,
        metric      TEXT NOT NULL,
        dim         TEXT NOT NULL DEFAULT '',
        value       REAL NOT NULL,
        observed_at TEXT NOT NULL
      );
      -- Unique so historical backfill is idempotent: collectors replay months
      -- of real timestamps on every sweep, and re-ingesting a day must not
      -- duplicate it. Today's row is rewritten as the day fills in.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_unique
        ON observations(source_kind, metric, dim, observed_at);

      CREATE TABLE IF NOT EXISTS seen_insights (
        fingerprint TEXT PRIMARY KEY,
        first_seen  TEXT NOT NULL,
        last_seen   TEXT NOT NULL,
        times       INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  // ---- nodes ----

  upsertNode(n: UnifiedGraphNode) {
    this.db
      .prepare(
        `INSERT INTO nodes (id, parent_board_id, kind, title, spatial, weave, execution, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           parent_board_id = excluded.parent_board_id,
           kind            = excluded.kind,
           title           = excluded.title,
           spatial         = excluded.spatial,
           weave           = excluded.weave,
           execution       = excluded.execution,
           payload         = excluded.payload`,
      )
      .run(
        n.id,
        n.parent_board_id,
        n.kind,
        n.title,
        JSON.stringify(n.spatial),
        JSON.stringify(n.weave),
        JSON.stringify(n.execution),
        JSON.stringify(n.payload),
        n.created_at,
      );
  }

  private hydrate(r: Record<string, unknown>): UnifiedGraphNode {
    return {
      id: r.id as string,
      parent_board_id: (r.parent_board_id as string | null) ?? null,
      kind: r.kind as UnifiedGraphNode["kind"],
      title: r.title as string,
      spatial: JSON.parse(r.spatial as string),
      weave: JSON.parse(r.weave as string),
      execution: JSON.parse(r.execution as string),
      payload: JSON.parse(r.payload as string),
      created_at: r.created_at as string,
    };
  }

  allNodes(): UnifiedGraphNode[] {
    return this.db
      .prepare("SELECT * FROM nodes ORDER BY created_at")
      .all()
      .map((r) => this.hydrate(r as Record<string, unknown>));
  }

  getNode(id: string): UnifiedGraphNode | null {
    const r = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
    return r ? this.hydrate(r as Record<string, unknown>) : null;
  }

  /** Next free slot in the weave, so a newly pinned card lands at the end. */
  nextWeaveIndex(): number {
    const r = this.db
      .prepare("SELECT weave FROM nodes WHERE json_extract(weave, '$.is_pinned') = 1")
      .all() as { weave: string }[];
    const used = r.map((x) => JSON.parse(x.weave).sequence_index ?? -1);
    return used.length ? Math.max(...used) + 1 : 0;
  }

  /** Remove a board and everything that hangs off it. */
  deleteSubtree(boardId: string) {
    const kids = this.db.prepare("SELECT id FROM nodes WHERE parent_board_id = ?").all(boardId) as { id: string }[];
    for (const k of kids) {
      this.db.prepare("DELETE FROM edges WHERE source_node_id = ? OR target_node_id = ?").run(k.id, k.id);
      this.db.prepare("DELETE FROM nodes WHERE id = ?").run(k.id);
    }
    this.db.prepare("DELETE FROM edges WHERE source_node_id = ? OR target_node_id = ?").run(boardId, boardId);
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(boardId);
  }

  /** Drop observations from collectors that no longer exist. */
  pruneObservations(keepKinds: string[]) {
    const q = keepKinds.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM observations WHERE source_kind NOT IN (${q})`).run(...keepKinds);
  }

  // ---- edges ----

  upsertEdge(e: GraphThreadEdge) {
    this.db
      .prepare(
        `INSERT INTO edges (id, source_node_id, target_node_id, transform_prompt, auto_propagate)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET auto_propagate = excluded.auto_propagate`,
      )
      .run(e.id, e.source_node_id, e.target_node_id, e.transform_prompt ?? null, e.auto_propagate ? 1 : 0);
  }

  allEdges(): GraphThreadEdge[] {
    return (this.db.prepare("SELECT * FROM edges").all() as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      source_node_id: r.source_node_id as string,
      target_node_id: r.target_node_id as string,
      transform_prompt: (r.transform_prompt as string | null) ?? undefined,
      auto_propagate: Boolean(r.auto_propagate),
    }));
  }

  /** Flip every downstream node to `stale` when a source node's hash changes. */
  markDownstreamStale(nodeId: string) {
    const targets = this.db
      .prepare("SELECT target_node_id FROM edges WHERE source_node_id = ?")
      .all(nodeId) as { target_node_id: string }[];
    for (const { target_node_id } of targets) {
      const n = this.getNode(target_node_id);
      if (!n || n.execution.status === "stale") continue;
      n.execution.status = "stale";
      this.upsertNode(n);
      this.markDownstreamStale(target_node_id);
    }
  }

  // ---- spine ----

  addSpineStep(s: ExecutionSpineStep) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO spine_steps
         (step_id, spine_id, sequence, tool_name, input_args, stdout_preview, status, duration_ms, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.step_id,
        s.spine_id,
        s.sequence,
        s.tool_name,
        JSON.stringify(s.input_args),
        s.stdout_preview,
        s.status,
        s.duration_ms,
        s.started_at,
      );
  }

  spine(spineId: string): ExecutionSpineStep[] {
    return (
      this.db
        .prepare("SELECT * FROM spine_steps WHERE spine_id = ? ORDER BY sequence")
        .all(spineId) as Record<string, unknown>[]
    ).map((r) => ({
      step_id: r.step_id as string,
      spine_id: r.spine_id as string,
      sequence: r.sequence as number,
      tool_name: r.tool_name as string,
      input_args: JSON.parse(r.input_args as string),
      stdout_preview: r.stdout_preview as string,
      status: r.status as ExecutionSpineStep["status"],
      duration_ms: r.duration_ms as number,
      started_at: r.started_at as string,
    }));
  }

  allSpines(): Record<string, ExecutionSpineStep[]> {
    const rows = this.db.prepare("SELECT DISTINCT spine_id FROM spine_steps").all() as {
      spine_id: string;
    }[];
    const out: Record<string, ExecutionSpineStep[]> = {};
    for (const { spine_id } of rows) out[spine_id] = this.spine(spine_id);
    return out;
  }

  // ---- observations (the analytical substrate) ----

  recordObservations(obs: Observation[]) {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO observations (source_kind, metric, dim, value, observed_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const o of obs) stmt.run(o.source_kind, o.metric, o.dim, o.value, o.observed_at);
  }

  /** History for one metric, oldest first. `dim` omitted returns every dimension. */
  history(sourceKind: string, metric: string, dim?: string, limit = 500): Observation[] {
    const sql = dim === undefined
      ? "SELECT * FROM observations WHERE source_kind = ? AND metric = ? ORDER BY observed_at DESC LIMIT ?"
      : "SELECT * FROM observations WHERE source_kind = ? AND metric = ? AND dim = ? ORDER BY observed_at DESC LIMIT ?";
    const args = dim === undefined ? [sourceKind, metric, limit] : [sourceKind, metric, dim, limit];
    const rows = this.db.prepare(sql).all(...args) as Record<string, unknown>[];
    return rows
      .map((r) => ({
        source_kind: r.source_kind as string,
        metric: r.metric as string,
        dim: r.dim as string,
        value: r.value as number,
        observed_at: r.observed_at as string,
      }))
      .reverse();
  }

  observationCount(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS c FROM observations").get() as { c: number };
    return r.c;
  }

  // ---- novelty ----

  /** Returns how many sweeps have already reported this exact claim. */
  noteFingerprint(fp: string, now: string): number {
    const row = this.db.prepare("SELECT times FROM seen_insights WHERE fingerprint = ?").get(fp) as
      | { times: number }
      | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO seen_insights (fingerprint, first_seen, last_seen, times) VALUES (?, ?, ?, 1)")
        .run(fp, now, now);
      return 0;
    }
    this.db
      .prepare("UPDATE seen_insights SET last_seen = ?, times = times + 1 WHERE fingerprint = ?")
      .run(now, fp);
    return row.times;
  }
}
