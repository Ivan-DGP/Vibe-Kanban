// Unified hybrid-retrieval core for the knowledge base. Fuses local-vector
// cosine ranking with FTS5 lexical (bm25) ranking via Reciprocal Rank Fusion,
// so exact-token matches (error strings, flag names, host names) can't be buried
// by semantic-only search — and vice versa. This is the SINGLE retrieval path;
// the HTTP route (routes/knowledge.ts) and the MCP tool (mcp/tools.ts) both call
// retrieveKnowledge() and project the rich hits into their own wire shapes.
//
// NOTE: the FTS index is synced off the embeddings tables (see migration v39), so
// when VK_DISABLE_EMBEDDINGS is set from boot the embeddings tables — and thus
// the lexical index — are empty. We honor the kill-switch by returning empty
// WITHOUT loading the model, preserving the historical contract. Decoupling FTS
// from embeddings (to allow lexical-only-when-model-off, gated by a separate
// VK_DISABLE_KNOWLEDGE_SEARCH flag) is a documented follow-up.

import { getDb } from "../db";
import {
  embed,
  cosineSimilarity,
  vectorFromBlob,
  EMBEDDING_MODEL,
  isEmbeddingsDisabled,
} from "./embeddings";
import { toFtsMatchQuery, rrfFuse, recencyMultiplier } from "../lib/knowledgeFusion";
import type { ArtifactType, TaskStatus, TaskPriority, GraphNodeType } from "@vibe-kanban/shared";

// Artifact-mirror graph nodes (metadata.kind === 'artifact') stand in for
// artifacts that are already embedded on their own; indexing them too pollutes
// search with filename-only near-duplicates. The vector branch excludes them at
// load time via this fragment (row aliased `n`). The lexical branch gets the same
// exclusion for free: any FTS embId whose row is not in the loaded payload map is
// dropped (a mirror-node embId never enters the map). Kept identical to the
// fragment in routes/knowledge.ts.
const MIRROR_NODE_EXCLUSION = "COALESCE(json_extract(n.metadata, '$.kind'), '') != 'artifact'";

export type KnowledgeKind = "artifact" | "task" | "graph_node";

export interface ArtifactPayload {
  id: string;
  filename: string;
  type: ArtifactType;
  description: string | null;
  tags: string[];
  mimeType: string;
  updatedAt: string;
}
export interface TaskPayload {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  taskNumber: number;
  milestoneId: string | null;
  updatedAt: string;
}
export interface GraphNodePayload {
  id: string;
  label: string;
  type: GraphNodeType;
  description: string | null;
  updatedAt: string;
}

/** A single fused retrieval hit at chunk granularity. Carries the full rich
 * entity payload (superset of what both callers render) plus optional neighbor
 * context. `score` is the fused RRF score (post-decay when decay is enabled),
 * NOT a raw cosine similarity. */
export interface KnowledgeHit {
  kind: KnowledgeKind;
  /** Source embeddings-row id (unique per chunk). */
  embId: string;
  /** Owning entity id (artifactId / taskId / nodeId). */
  entityId: string;
  chunkIdx: number;
  content: string;
  score: number;
  updatedAt: string;
  /** Adjacent-chunk text (chunkIdx±1) when expandNeighbors is set. */
  neighborContext?: string;
  artifact?: ArtifactPayload;
  task?: TaskPayload;
  graphNode?: GraphNodePayload;
}

export interface RetrieveOptions {
  projectId: string;
  query: string;
  k?: number;
  /** Floor applied to the FUSED score (default 0 = keep all). */
  minScore?: number;
  types?: KnowledgeKind[];
  /** Opt-in exponential recency decay; half-life in days. Omit/<=0 = off. */
  recencyHalfLifeDays?: number;
  /** Opt-in: attach adjacent chunk text to each surviving hit. */
  expandNeighbors?: boolean;
  /** Opt-in: at most this many chunks from any single entity in the results. */
  perEntityCap?: number;
  /** Injectable embedder (tests). Defaults to the real model. */
  embedFn?: (text: string) => Promise<Float32Array | number[]>;
  /** Injectable clock (tests) for decay. Defaults to Date.now(). */
  nowMs?: number;
}

export interface RetrieveResult {
  model: string;
  hits: KnowledgeHit[];
  /** Distinct candidate chunks considered before k-slicing. */
  totalCandidates: number;
}

interface LoadedRow {
  hit: KnowledgeHit;
  vector: Buffer;
}

const KIND_TABLE: Record<KnowledgeKind, string> = {
  artifact: "artifact_embeddings",
  task: "task_embeddings",
  graph_node: "graph_node_embeddings",
};
const KIND_ENTITY_COL: Record<KnowledgeKind, string> = {
  artifact: "artifactId",
  task: "taskId",
  graph_node: "nodeId",
};

/**
 * Hybrid knowledge retrieval. Returns fused, ranked hits for a project.
 *
 * Honors the VK_DISABLE_EMBEDDINGS kill-switch (returns empty, no model load).
 * Never throws on empty corpora — returns `{ hits: [], totalCandidates: 0 }`.
 */
export async function retrieveKnowledge(opts: RetrieveOptions): Promise<RetrieveResult> {
  const { projectId } = opts;
  const query = opts.query?.trim() ?? "";
  // Coerce at the boundary: one caller is an HTTP route whose body values can
  // arrive as strings. Non-finite k/minScore fall back to their defaults rather
  // than becoming NaN — a NaN k would bypass the k-cap, a NaN minScore is treated
  // as "no floor". k is floored to an integer page size.
  const kRaw = Number(opts.k);
  const k = Math.min(Math.max(Number.isFinite(kRaw) ? Math.floor(kRaw) : 10, 1), 50);
  const msRaw = Number(opts.minScore);
  const minScore = Number.isFinite(msRaw) ? msRaw : 0;
  const includeArtifacts = !opts.types || opts.types.includes("artifact");
  const includeTasks = !opts.types || opts.types.includes("task");
  const includeGraphNodes = !opts.types || opts.types.includes("graph_node");
  const embedFn = opts.embedFn ?? embed;

  const empty: RetrieveResult = { model: EMBEDDING_MODEL, hits: [], totalCandidates: 0 };

  // Kill-switch: no model load, no row reads (see module header).
  if (isEmbeddingsDisabled()) return empty;
  if (query.length === 0) return empty;

  const db = getDb();

  // 1. Load all candidate rows for included kinds, keyed by embId. This is the
  //    universe both branches rank over; the payload map also enforces graph
  //    mirror-node exclusion (excluded rows never enter the map).
  const rowsById = new Map<string, LoadedRow>();

  if (includeArtifacts) {
    const rows = db
      .prepare(
        `SELECT e.id, e.artifactId, e.chunkIdx, e.content, e.vector,
                a.filename, a.type, a.description, a.tags, a.mimeType, a.updatedAt
           FROM artifact_embeddings e
           JOIN project_artifacts a ON a.id = e.artifactId
          WHERE e.projectId = ?`,
      )
      .all(projectId) as {
      id: string;
      artifactId: string;
      chunkIdx: number;
      content: string;
      vector: Buffer;
      filename: string;
      type: ArtifactType;
      description: string | null;
      tags: string | null;
      mimeType: string;
      updatedAt: string;
    }[];
    for (const r of rows) {
      rowsById.set(r.id, {
        vector: r.vector,
        hit: {
          kind: "artifact",
          embId: r.id,
          entityId: r.artifactId,
          chunkIdx: r.chunkIdx,
          content: r.content,
          score: 0,
          updatedAt: r.updatedAt,
          artifact: {
            id: r.artifactId,
            filename: r.filename,
            type: r.type,
            description: r.description,
            tags: JSON.parse(r.tags || "[]") as string[],
            mimeType: r.mimeType,
            updatedAt: r.updatedAt,
          },
        },
      });
    }
  }

  if (includeTasks) {
    const rows = db
      .prepare(
        `SELECT e.id, e.taskId, e.chunkIdx, e.content, e.vector,
                t.title, t.status, t.priority, t.taskNumber, t.milestoneId, t.updatedAt
           FROM task_embeddings e
           JOIN tasks t ON t.id = e.taskId
          WHERE e.projectId = ?`,
      )
      .all(projectId) as {
      id: string;
      taskId: string;
      chunkIdx: number;
      content: string;
      vector: Buffer;
      title: string;
      status: TaskStatus;
      priority: TaskPriority;
      taskNumber: number;
      milestoneId: string | null;
      updatedAt: string;
    }[];
    for (const r of rows) {
      rowsById.set(r.id, {
        vector: r.vector,
        hit: {
          kind: "task",
          embId: r.id,
          entityId: r.taskId,
          chunkIdx: r.chunkIdx,
          content: r.content,
          score: 0,
          updatedAt: r.updatedAt,
          task: {
            id: r.taskId,
            title: r.title,
            status: r.status,
            priority: r.priority,
            taskNumber: r.taskNumber,
            milestoneId: r.milestoneId,
            updatedAt: r.updatedAt,
          },
        },
      });
    }
  }

  if (includeGraphNodes) {
    const rows = db
      .prepare(
        `SELECT e.id, e.nodeId, e.chunkIdx, e.content, e.vector,
                n.label, n.type, n.description, n.updatedAt
           FROM graph_node_embeddings e
           JOIN project_graph_nodes n ON n.id = e.nodeId
          WHERE e.projectId = ? AND ${MIRROR_NODE_EXCLUSION}`,
      )
      .all(projectId) as {
      id: string;
      nodeId: string;
      chunkIdx: number;
      content: string;
      vector: Buffer;
      label: string;
      type: GraphNodeType;
      description: string | null;
      updatedAt: string;
    }[];
    for (const r of rows) {
      rowsById.set(r.id, {
        vector: r.vector,
        hit: {
          kind: "graph_node",
          embId: r.id,
          entityId: r.nodeId,
          chunkIdx: r.chunkIdx,
          content: r.content,
          score: 0,
          updatedAt: r.updatedAt,
          graphNode: {
            id: r.nodeId,
            label: r.label,
            type: r.type,
            description: r.description,
            updatedAt: r.updatedAt,
          },
        },
      });
    }
  }

  if (rowsById.size === 0) return empty;

  // 2. Vector branch: cosine over every loaded row, ranked best-first.
  const queryVecRaw = await embedFn(query);
  const queryVec =
    queryVecRaw instanceof Float32Array ? queryVecRaw : Float32Array.from(queryVecRaw);
  const vecRanked = [...rowsById.entries()]
    .map(([embId, row]) => ({
      embId,
      score: cosineSimilarity(queryVec, vectorFromBlob(row.vector)),
    }))
    .sort((a, b) => b.score - a.score);
  const vecIds = vecRanked.map((r) => r.embId);

  // 3. Lexical branch: FTS5 bm25 over the same universe. embIds absent from the
  //    payload map (mirror nodes, or rows for excluded kinds) are dropped, giving
  //    graph mirror-exclusion parity with the vector branch for free.
  let lexIds: string[] = [];
  const match = toFtsMatchQuery(query);
  if (match) {
    const kinds: KnowledgeKind[] = [];
    if (includeArtifacts) kinds.push("artifact");
    if (includeTasks) kinds.push("task");
    if (includeGraphNodes) kinds.push("graph_node");
    const placeholders = kinds.map(() => "?").join(", ");
    const ftsRows = db
      .prepare(
        `SELECT embId FROM knowledge_fts
          WHERE projectId = ? AND kind IN (${placeholders}) AND knowledge_fts MATCH ?
          ORDER BY bm25(knowledge_fts)`,
      )
      .all(projectId, ...kinds, match) as { embId: string }[];
    lexIds = ftsRows.map((r) => r.embId).filter((id) => rowsById.has(id));
  }

  // 4. Fuse the two rank lists (equal weight) into a single fused order.
  const fused = rrfFuse([
    { ids: vecIds, weight: 1 },
    { ids: lexIds, weight: 1 },
  ]);

  // 5. Optional recency decay: scale each fused score by an age multiplier, then
  //    re-sort. Off by default (half-life omitted / <= 0).
  const halfLife = opts.recencyHalfLifeDays ?? 0;
  const nowMs = opts.nowMs ?? Date.now();
  let ordered = fused.map((f) => {
    const row = rowsById.get(f.id)!;
    const score =
      halfLife > 0 ? f.score * recencyMultiplier(row.hit.updatedAt, halfLife, nowMs) : f.score;
    return { embId: f.id, score };
  });
  if (halfLife > 0) ordered.sort((a, b) => b.score - a.score);

  // 6. minScore floor (on the fused score) + optional per-entity cap + top-k.
  ordered = ordered.filter((o) => o.score >= minScore);
  const perEntityCap = opts.perEntityCap && opts.perEntityCap > 0 ? opts.perEntityCap : Infinity;
  const perEntityCount = new Map<string, number>();
  const selected: { embId: string; score: number }[] = [];
  for (const o of ordered) {
    if (selected.length >= k) break;
    const entityId = rowsById.get(o.embId)!.hit.entityId;
    const seen = perEntityCount.get(entityId) ?? 0;
    if (seen >= perEntityCap) continue;
    perEntityCount.set(entityId, seen + 1);
    selected.push(o);
  }

  // 7. Materialize hits (with the fused score) and optionally expand neighbors.
  const hits: KnowledgeHit[] = selected.map((s) => {
    const base = rowsById.get(s.embId)!.hit;
    return { ...base, score: s.score };
  });
  if (opts.expandNeighbors) {
    for (const hit of hits) {
      hit.neighborContext = loadNeighborContext(db, hit.kind, hit.entityId, hit.chunkIdx);
    }
  }

  return { model: EMBEDDING_MODEL, hits, totalCandidates: rowsById.size };
}

/**
 * Fetch the text of the chunks immediately before/after `chunkIdx` for the same
 * entity, joined by a blank line, so a matched chunk isn't rendered as a lonely
 * paragraph missing its surrounding context. Returns undefined when no neighbors
 * exist. Table is selected by kind; entity/chunk are bound params (no injection).
 */
function loadNeighborContext(
  db: ReturnType<typeof getDb>,
  kind: KnowledgeKind,
  entityId: string,
  chunkIdx: number,
): string | undefined {
  const table = KIND_TABLE[kind];
  const entityCol = KIND_ENTITY_COL[kind];
  const rows = db
    .prepare(
      `SELECT content FROM ${table}
        WHERE ${entityCol} = ? AND chunkIdx IN (?, ?)
        ORDER BY chunkIdx`,
    )
    .all(entityId, chunkIdx - 1, chunkIdx + 1) as { content: string }[];
  if (rows.length === 0) return undefined;
  return rows.map((r) => r.content).join("\n\n");
}
