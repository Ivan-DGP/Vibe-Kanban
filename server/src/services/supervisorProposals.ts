// Phase 2 of the propose-only supervisor: rank collected signals by a value
// heuristic and GROUND each top proposal with cross-project knowledge + memory
// (reusing retrieveKnowledge and searchMemory), producing a human-readable
// rationale. Deterministic — no LLM. Grounding degrades to empty (never throws)
// when embeddings are disabled or a lookup fails.

import { retrieveKnowledge } from "./knowledgeRetrieval";
import { searchMemory } from "./memorySearch";
import type { EmbedFn } from "./memorySearch";
import { log } from "../lib/logger";
import type { SupervisorSignal, SupervisorSignalType } from "./supervisorSignals";

/** A grounded reference attached to a proposal (a related artifact/task/node or
 * memory event), with its source project when cross-project. */
export interface GroundedRef {
  id: string;
  label: string;
  project?: string;
}

export interface SupervisorProposal {
  signalKey: string;
  signalType: SupervisorSignalType;
  projectId: string;
  title: string;
  rationale: string;
  score: number;
  grounded: { knowledge: GroundedRef[]; memory: GroundedRef[] };
}

export interface BuildProposalsOptions {
  /** Max proposals to return (default 10). */
  limit?: number;
  /** Grounding fan-out per source (default 3). */
  knowledgeK?: number;
  memoryK?: number;
  /** Injectable embedder (tests). Defaults to the real model via the reused cores. */
  embedFn?: EmbedFn;
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

/** Render grounded refs into a compact "Label (project), …" clause. */
function renderRefs(refs: GroundedRef[]): string {
  return refs.map((r) => (r.project ? `${r.label} (${r.project})` : r.label)).join(", ");
}

/**
 * Rank signals and build grounded proposals. Score is the signal's `weightHint`
 * (type/severity priority); ties break deterministically by `signalKey`. The
 * top-`limit` are grounded with cross-project knowledge + memory keyed on the
 * signal title, and a rationale is composed.
 */
export async function buildProposals(
  signals: SupervisorSignal[],
  opts: BuildProposalsOptions = {},
): Promise<SupervisorProposal[]> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const knowledgeK = opts.knowledgeK ?? 3;
  const memoryK = opts.memoryK ?? 3;

  const ranked = [...signals]
    .sort((a, b) => b.weightHint - a.weightHint || (a.signalKey < b.signalKey ? -1 : 1))
    .slice(0, limit);

  const proposals: SupervisorProposal[] = [];
  for (const signal of ranked) {
    const grounded = await groundSignal(signal, knowledgeK, memoryK, opts.embedFn);
    proposals.push({
      signalKey: signal.signalKey,
      signalType: signal.type,
      projectId: signal.projectId,
      title: signal.title,
      score: signal.weightHint,
      grounded,
      rationale: composeRationale(signal, grounded),
    });
  }
  return proposals;
}

/** Cross-project knowledge + memory lookups for one signal. Never throws — on a
 * disabled kill-switch or any error, grounding is empty. Excludes the signal's
 * own source row from the memory grounding (no self-reference). */
async function groundSignal(
  signal: SupervisorSignal,
  knowledgeK: number,
  memoryK: number,
  embedFn?: EmbedFn,
): Promise<{ knowledge: GroundedRef[]; memory: GroundedRef[] }> {
  const empty = { knowledge: [] as GroundedRef[], memory: [] as GroundedRef[] };
  try {
    const [knowledge, memory] = await Promise.all([
      retrieveKnowledge({ query: signal.title, k: knowledgeK, embedFn }),
      searchMemory({ query: signal.title, k: memoryK + 1, embedFn }),
    ]);
    return {
      knowledge: knowledge.hits.map((h) => ({
        id: h.entityId,
        label: knowledgeLabel(h),
        project: h.project?.name,
      })),
      memory: memory.hits
        .filter((h) => h.id !== signal.ref) // no self-reference
        .slice(0, memoryK)
        .map((h) => ({ id: h.id, label: h.title, project: h.project?.name })),
    };
  } catch (err) {
    log(
      "warn",
      "server",
      `Supervisor grounding failed for ${signal.signalKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return empty;
  }
}

/** Compose a concise human-readable rationale from the signal + its grounding. */
function composeRationale(
  signal: SupervisorSignal,
  grounded: { knowledge: GroundedRef[]; memory: GroundedRef[] },
): string {
  const parts: string[] = [signal.detail?.trim() || signal.title];
  if (grounded.knowledge.length > 0) {
    parts.push(`Related knowledge: ${renderRefs(grounded.knowledge)}.`);
  }
  if (grounded.memory.length > 0) {
    parts.push(`Related lessons: ${renderRefs(grounded.memory)}.`);
  }
  return parts.join(" ");
}
