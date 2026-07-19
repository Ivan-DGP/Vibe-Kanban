// Vector search over project memory (memory_embeddings), projectId-OPTIONAL so a
// cross-project specialist can find relevant past lessons across every project.
// Mirrors the cross-project relaxation in knowledgeRetrieval: omit projectId to
// rank across all projects, with each hit attributed to its source `project`.
//
// Vector-only (local MiniLM-384 cosine). Memory is NOT in the hybrid knowledge_fts
// index, so there is no lexical/RRF fusion here — folding memory into the hybrid
// core is a separate follow-up.

import { getDb } from "../db";
import {
  embed,
  cosineSimilarity,
  vectorFromBlob,
  EMBEDDING_MODEL,
  isEmbeddingsDisabled,
} from "./embeddings";
import type { MemoryType, MemoryOrigin } from "@vibe-kanban/shared";

export type EmbedFn = (text: string) => Promise<Float32Array | number[]>;

/** A ranked memory event. Carries the full event (for display/consumption), the
 * best-matching chunk `content`, a cosine `score`, and — in cross-project mode —
 * the source `project`. */
export interface MemorySearchHit {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  files: string[];
  taskId: string | null;
  runId: string | null;
  origin: MemoryOrigin;
  createdAt: string;
  /** Best-matching chunk content for this event. */
  content: string;
  /** Cosine similarity (0..1). */
  score: number;
  /** Source project — present only in cross-project mode (projectId omitted). */
  project?: { id: string; name: string };
}

export interface SearchMemoryOptions {
  /** Omit to search across ALL projects (cross-project mode). */
  projectId?: string;
  query: string;
  k?: number;
  /** Cosine floor (0..1); default 0 (keep all). */
  minScore?: number;
  /** Restrict to a single memory type. */
  type?: MemoryType;
  /** Include superseded events (default: exclude). */
  includeSuperseded?: boolean;
  /** Injectable embedder (tests). Defaults to the real model. */
  embedFn?: EmbedFn;
}

export interface SearchMemoryResult {
  model: string;
  hits: MemorySearchHit[];
  /** Distinct candidate events considered before k-slicing. */
  totalCandidates: number;
}

interface MemoryRow {
  memoryId: string;
  content: string;
  vector: Buffer;
  type: MemoryType;
  title: string;
  body: string;
  files: string;
  taskId: string | null;
  runId: string | null;
  origin: MemoryOrigin;
  createdAt: string;
  projPid?: string;
  projName?: string;
}

function parseFiles(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Rank a project's (or all projects') memory events by cosine similarity to the
 * query, dedup to the best-scoring chunk per event, exclude superseded events
 * (unless includeSuperseded), and return the top-K.
 *
 * Honors the VK_DISABLE_EMBEDDINGS kill-switch (empty, no model load). Never
 * throws on an empty corpus.
 */
export async function searchMemory(opts: SearchMemoryOptions): Promise<SearchMemoryResult> {
  const query = opts.query?.trim() ?? "";
  const kRaw = Number(opts.k);
  const k = Math.min(Math.max(Number.isFinite(kRaw) ? Math.floor(kRaw) : 10, 1), 50);
  // Undefined/NaN → default floor of 0 (search surfaces don't want anti-correlated
  // hits). An explicit value IS honored, including -Infinity — the injection path
  // passes that to opt out of any floor, matching its prior (no-filter) behavior.
  const minScore =
    opts.minScore === undefined || Number.isNaN(Number(opts.minScore)) ? 0 : Number(opts.minScore);
  const embedFn = opts.embedFn ?? embed;

  const empty: SearchMemoryResult = { model: EMBEDDING_MODEL, hits: [], totalCandidates: 0 };
  if (isEmbeddingsDisabled()) return empty;
  if (query.length === 0) return empty;

  // Cross-project mode: drop the projectId filter and join `projects` for
  // attribution. Single-project keeps the exact WHERE e.projectId = ? filter.
  const crossProject = opts.projectId === undefined;
  const projJoin = crossProject ? "JOIN projects p ON p.id = e.projectId" : "";
  const projSelect = crossProject ? ", p.id AS projPid, p.name AS projName" : "";

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (crossProject) {
    clauses.push("1=1");
  } else {
    clauses.push("e.projectId = ?");
    binds.push(opts.projectId);
  }
  if (!opts.includeSuperseded) clauses.push("m.supersededBy IS NULL");
  if (opts.type) {
    clauses.push("m.type = ?");
    binds.push(opts.type);
  }

  const rows = getDb()
    .prepare(
      `SELECT e.memoryId, e.content, e.vector,
              m.type, m.title, m.body, m.files, m.taskId, m.runId, m.origin, m.createdAt${projSelect}
         FROM memory_embeddings e
         JOIN project_memory m ON m.id = e.memoryId
         ${projJoin}
        WHERE ${clauses.join(" AND ")}`,
    )
    .all(...binds) as MemoryRow[];

  const queryVecRaw = await embedFn(query);
  const queryVec =
    queryVecRaw instanceof Float32Array ? queryVecRaw : Float32Array.from(queryVecRaw);

  // Best-scoring chunk per event.
  const best = new Map<string, MemorySearchHit>();
  for (const r of rows) {
    const score = cosineSimilarity(queryVec, vectorFromBlob(r.vector));
    const prev = best.get(r.memoryId);
    if (prev && score <= prev.score) continue;
    best.set(r.memoryId, {
      id: r.memoryId,
      type: r.type,
      title: r.title,
      body: r.body,
      files: parseFiles(r.files),
      taskId: r.taskId,
      runId: r.runId,
      origin: r.origin,
      createdAt: r.createdAt,
      content: r.content,
      score,
      ...(crossProject ? { project: { id: r.projPid!, name: r.projName! } } : {}),
    });
  }

  const hits = [...best.values()]
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return { model: EMBEDDING_MODEL, hits, totalCandidates: best.size };
}
