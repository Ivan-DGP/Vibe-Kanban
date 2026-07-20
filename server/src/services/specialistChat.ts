// Cross-project Specialist chat grounding. Each turn retrieves the most relevant
// knowledge + past lessons across ALL projects (retrieveKnowledge + searchMemory,
// projectId omitted = cross-project) keyed on the user's message, then composes a
// grounded prompt. Grounding NEVER throws: on a disabled kill-switch
// (VK_DISABLE_EMBEDDINGS) or any lookup failure it degrades to empty, and the chat
// still answers from general knowledge.

import { retrieveKnowledge } from "./knowledgeRetrieval";
import { searchMemory } from "./memorySearch";
import type { EmbedFn } from "./memorySearch";
import { log } from "../lib/logger";
import type { SpecialistSource } from "@vibe-kanban/shared";

export interface SpecialistGrounding {
  knowledge: SpecialistSource[];
  memory: SpecialistSource[];
}

export interface GroundQueryOptions {
  /** Hits per source (default 5). */
  k?: number;
  /** Active project. When set, its hits are floated to the top of each source
   * (project-first), with cross-project hits following. Omit for pure
   * cross-project ranking. */
  projectId?: string;
  /** Injectable embedder (tests). Defaults to the real model via the reused cores. */
  embedFn?: EmbedFn;
}

const DEFAULT_K = 5;
const MEMORY_SNIPPET_CHARS = 240;
// When scoped to a project, retrieve a wider cross-project candidate pool so the
// active project's hits are present to float to the front even if they'd fall
// outside the global top-k.
const SCOPE_CANDIDATE_K = 20;

/** Stable project-first partition: active-project hits (in score order) first,
 * then the rest, capped at k. */
function projectFirst<T extends { project?: { id: string } }>(
  hits: T[],
  projectId: string,
  k: number,
): T[] {
  const mine = hits.filter((h) => h.project?.id === projectId);
  const others = hits.filter((h) => h.project?.id !== projectId);
  return [...mine, ...others].slice(0, k);
}

/** Label a knowledge hit by its kind-specific display field. */
function knowledgeLabel(hit: {
  kind: string;
  artifact?: { filename: string };
  task?: { title: string };
  graphNode?: { label: string };
}): string {
  if (hit.kind === "artifact") return hit.artifact?.filename ?? "(artifact)";
  if (hit.kind === "task") return hit.task?.title ?? "(task)";
  return hit.graphNode?.label ?? "(node)";
}

/**
 * Retrieve cross-project knowledge + memory relevant to `message`. Returns empty
 * grounding (never throws) when embeddings are disabled or a lookup fails.
 */
export async function groundQuery(
  message: string,
  opts: GroundQueryOptions = {},
): Promise<SpecialistGrounding> {
  const k = opts.k ?? DEFAULT_K;
  const scoped = opts.projectId;
  // Always retrieve cross-project (so every hit carries its source `project`);
  // when scoped, widen the pool and float the active project's hits to the top.
  const candidateK = scoped ? Math.max(k * 4, SCOPE_CANDIDATE_K) : k;
  const empty: SpecialistGrounding = { knowledge: [], memory: [] };
  try {
    const [knowledgeRes, memoryRes] = await Promise.all([
      retrieveKnowledge({ query: message, k: candidateK, embedFn: opts.embedFn }),
      searchMemory({ query: message, k: candidateK, embedFn: opts.embedFn }),
    ]);
    const knowledge = {
      hits: scoped ? projectFirst(knowledgeRes.hits, scoped, k) : knowledgeRes.hits.slice(0, k),
    };
    const memory = {
      hits: scoped ? projectFirst(memoryRes.hits, scoped, k) : memoryRes.hits.slice(0, k),
    };
    return {
      knowledge: knowledge.hits.map((h) => ({
        id: h.entityId,
        kind: h.kind,
        label: knowledgeLabel(h),
        project: h.project?.name,
      })),
      memory: memory.hits.map((h) => ({
        id: h.id,
        kind: "memory",
        label: h.title,
        project: h.project?.name,
        snippet: h.content ? h.content.slice(0, MEMORY_SNIPPET_CHARS) : undefined,
      })),
    };
  } catch (err) {
    log(
      "warn",
      "server",
      `Specialist grounding failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return empty;
  }
}

/** Render the grounded knowledge + memory + question into a specialist prompt. */
export function buildSpecialistPrompt(message: string, g: SpecialistGrounding): string {
  const lines: string[] = [
    "You are the cross-project Specialist for this developer's workspace — you have",
    "knowledge of ALL their projects (artifacts, tasks, knowledge graph, and past",
    "lessons). Answer the question below. When the grounded context is relevant, use",
    "it and cite the source inline as `label (project)`. If the context does not cover",
    "the question, say so briefly and answer from general knowledge.",
    "",
  ];
  if (g.knowledge.length > 0) {
    lines.push("## Relevant knowledge across projects");
    for (const s of g.knowledge) {
      lines.push(`- [${s.kind}] ${s.label}${s.project ? ` (${s.project})` : ""}`);
    }
    lines.push("");
  }
  if (g.memory.length > 0) {
    lines.push("## Relevant past lessons (memory)");
    for (const s of g.memory) {
      const tail = s.snippet ? `: ${s.snippet}` : "";
      lines.push(`- ${s.label}${s.project ? ` (${s.project})` : ""}${tail}`);
    }
    lines.push("");
  }
  if (g.knowledge.length === 0 && g.memory.length === 0) {
    lines.push(
      "(No indexed knowledge or memory matched this question — say the workspace had no",
      "specific match, then answer from general knowledge.)",
      "",
    );
  }
  lines.push("## Question", message);
  return lines.join("\n");
}
