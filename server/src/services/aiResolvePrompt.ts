// Barrel for the AI-resolve prompt subsystem.
// Public API kept stable; implementation split across siblings:
//   - aiResolvePrompt.helpers.ts   filesystem / git / cache / keyword utils
//   - aiResolvePrompt.classify.ts  profile types, classifier, complexity
//   - aiResolvePrompt.builders.ts  prompt builders (analyze, resolve, gather, decompose, test)
//
// buildAiResolvePromptWithGrounding is wrapped here to append structural
// dependency-neighborhood grounding without touching the builders module.
export * from "./aiResolvePrompt.helpers";
export * from "./aiResolvePrompt.classify";
export {
  buildAnalyzePrompt,
  buildAiResolvePrompt,
  buildGatherContextPrompt,
  buildDecomposePrompt,
  buildAiTestPrompt,
  type AiResolvePromptResult,
} from "./aiResolvePrompt.builders";

import type { Task } from "@vibe-kanban/shared";
import { getDb } from "../db";
import {
  buildAiResolvePromptWithGrounding as baseBuildAiResolvePromptWithGrounding,
  type AiResolvePromptResult,
} from "./aiResolvePrompt.builders";
import { dependencyNeighborhood } from "./depGraph";

const FILE_PATH_RE = /[\w./-]+\.(?:tsx?|jsx?)/g;
const NEIGHBOR_SECTION_MAX_LINES = 40;

/**
 * Build the AI-resolve prompt AND report the knowledge artifacts injected into
 * it, so the run record can persist a "Grounded in" list for audit (O6).
 * Also appends a short dependency-neighborhood section when the task text
 * mentions repo file paths.
 */
export async function buildAiResolvePromptWithGrounding(
  task: Task,
  projectId: string,
  port: number,
): Promise<AiResolvePromptResult> {
  const result = await baseBuildAiResolvePromptWithGrounding(task, projectId, port);

  const text = [task.title, task.description ?? "", task.prompt ?? ""].join("\n");
  const candidates = [...new Set(text.match(FILE_PATH_RE) ?? [])];
  if (candidates.length === 0) return result;

  const projectRow = getDb().prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
    | { path: string }
    | undefined;
  if (!projectRow) return result;

  let neighborhood: { file: string; imports: string[]; importedBy: string[] }[];
  try {
    neighborhood = dependencyNeighborhood(projectRow.path, candidates);
  } catch {
    return result;
  }
  if (neighborhood.length === 0) return result;

  const header = "\n\n## Related modules (from the dependency graph)";
  const bodyLines = neighborhood.map((n) => {
    const imports = n.imports.length ? n.imports.join(", ") : "(none)";
    const importedBy = n.importedBy.length ? n.importedBy.join(", ") : "(none)";
    return `- \`${n.file}\` — imports: ${imports}; imported by: ${importedBy}`;
  });
  // header counts as 1 line; cap whole section ~40 lines
  const capped = bodyLines.slice(0, NEIGHBOR_SECTION_MAX_LINES - 1);
  return { ...result, prompt: result.prompt + header + "\n" + capped.join("\n") };
}
