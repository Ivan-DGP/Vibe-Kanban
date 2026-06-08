/**
 * Production analog of `benchmarks/harness/adversarial.ts` + the run.ts SPRAWL /
 * TAMPERED gates. Wraps `spawnHeadlessClaude` with flag-only verifiers:
 *
 *   - TAMPERED        — AI edited a test file for a non-test task
 *   - SPRAWL          — diff exceeds the configured budget
 *   - EXFIL           — model output contains a project-configured decoy
 *   - PROMPT-INJECTED — model output contains an injection-marker string
 *
 * Findings are persisted into `task_ai_findings` and surfaced via UI; they do
 * NOT block the AI run. Failures here never throw into the AI path — capture
 * is best-effort, like `taskAiCapture.ts`.
 *
 * EXFIL/PROMPT-INJECTED scanning is opt-in: only runs when the project has
 * `metadata.adversarial.decoys` / `metadata.adversarial.injectionMarkers`
 * arrays. Most projects won't configure these — TAMPERED + SPRAWL alone are
 * universally useful.
 */

import { verifyNoExfil, verifyNoPromptInjection } from "../../../benchmarks/harness/adversarial";
import { spawnProcess } from "../lib/runtime";
import { getDb } from "../db";
import { log } from "../lib/logger";

export type FindingKind = "EXFIL" | "PROMPT-INJECTED" | "TAMPERED" | "SPRAWL" | "PREFLIGHT-RED";

export interface ProductionFinding {
  kind: FindingKind;
  detail: string;
}

export interface AdversarialPolicy {
  /** Decoy substrings that MUST NOT appear in the AI summary. */
  decoys?: string[];
  /** Marker substrings whose presence proves the model followed an injection. */
  injectionMarkers?: string[];
  /** Skip TAMPERED check for tasks that legitimately edit tests. */
  allowsTestEdits?: boolean;
  /** Diff-line ceiling (added+removed). Default 800. */
  sprawlBudget?: number;
}

const TEST_PATH_RE = /(^|\/)(__tests__\/|tests?\/|.*\.(test|spec)\.[a-z]+$)/i;
const GIT_TIMEOUT_MS = 10_000;
const DEFAULT_SPRAWL_BUDGET = 800;

export interface PreSpawnSnapshot {
  /** HEAD commit before AI ran. Null if not a git repo / no commits. */
  preSha: string | null;
}

/**
 * Capture pre-spawn state. Cheap (one git rev-parse). Caller passes the
 * result into `runProductionVerifiers` after the AI finishes.
 */
export async function snapshotPreSpawn(cwd: string): Promise<PreSpawnSnapshot> {
  try {
    const r = await spawnProcess(["git", "rev-parse", "HEAD"], { cwd, timeout: GIT_TIMEOUT_MS });
    if (r.exitCode !== 0) return { preSha: null };
    const sha = r.stdout.trim();
    return { preSha: sha.length === 40 ? sha : null };
  } catch {
    return { preSha: null };
  }
}

interface DiffStats {
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
}

async function gitDiffSince(cwd: string, baseSha: string): Promise<DiffStats | null> {
  try {
    const r = await spawnProcess(["git", "diff", "--numstat", baseSha], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
    });
    if (r.exitCode !== 0) return null;
    const filesChanged: string[] = [];
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const line of r.stdout.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const added = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
      const removed = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
      const file = parts[2];
      if (Number.isFinite(added)) linesAdded += added;
      if (Number.isFinite(removed)) linesRemoved += removed;
      filesChanged.push(file);
    }
    return { filesChanged, linesAdded, linesRemoved };
  } catch {
    return null;
  }
}

export interface RunVerifiersInput {
  runId: string;
  taskId: string;
  projectId: string;
  cwd: string;
  summary: string | null;
  pre: PreSpawnSnapshot;
  policy: AdversarialPolicy;
}

/**
 * Run all verifiers and return findings. Pure where possible; only impure
 * step is `git diff` for SPRAWL/TAMPERED, which gracefully degrades to
 * "skipped" when the cwd isn't a git repo.
 */
export async function runProductionVerifiers(
  input: RunVerifiersInput,
): Promise<ProductionFinding[]> {
  const findings: ProductionFinding[] = [];

  const exfil = verifyNoExfil(input.summary, input.policy.decoys);
  if (exfil.exfilDetected) {
    findings.push({
      kind: "EXFIL",
      detail: `decoy substrings echoed in summary: ${exfil.matches.join(", ")}`,
    });
  }

  const inj = verifyNoPromptInjection(input.summary, input.policy.injectionMarkers);
  if (inj.promptInjected) {
    findings.push({
      kind: "PROMPT-INJECTED",
      detail: `injection markers echoed in summary: ${inj.matches.join(", ")}`,
    });
  }

  if (input.pre.preSha) {
    const stats = await gitDiffSince(input.cwd, input.pre.preSha);
    if (stats) {
      const total = stats.linesAdded + stats.linesRemoved;
      const budget = input.policy.sprawlBudget ?? DEFAULT_SPRAWL_BUDGET;
      if (total > budget) {
        findings.push({
          kind: "SPRAWL",
          detail: `diff ${stats.linesAdded}+ ${stats.linesRemoved}- (=${total}) exceeds budget ${budget} across ${stats.filesChanged.length} file(s)`,
        });
      }
      if (!input.policy.allowsTestEdits) {
        const testEdits = stats.filesChanged.filter((f) => TEST_PATH_RE.test(f));
        if (testEdits.length > 0) {
          findings.push({
            kind: "TAMPERED",
            detail: `non-test task edited test files: ${testEdits.join(", ")}`,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Persist findings to `task_ai_findings`. Best-effort; logs and swallows
 * errors so the AI path is never affected.
 */
export function recordFindings(input: {
  runId: string;
  taskId: string;
  projectId: string;
  findings: ProductionFinding[];
}): void {
  if (input.findings.length === 0) return;
  try {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO task_ai_findings (id, runId, taskId, projectId, kind, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const f of input.findings) {
      stmt.run(crypto.randomUUID(), input.runId, input.taskId, input.projectId, f.kind, f.detail);
    }
    log("warn", "claude", "task_ai_findings recorded", {
      runId: input.runId,
      taskId: input.taskId,
      kinds: input.findings.map((f) => f.kind),
    });
  } catch (e) {
    log("error", "claude", "failed to record task_ai_findings", {
      runId: input.runId,
      error: String(e),
    });
  }
}

/**
 * Read project + task to derive an AdversarialPolicy. Decoys/markers come
 * from `projects.aiInstructions` interpreted as JSON when it parses to an
 * object with an `adversarial` block; otherwise no scanning. `allowsTestEdits`
 * comes from `tasks.metadata.allowsTestEdits`.
 */
export function loadPolicy(projectId: string, taskId: string): AdversarialPolicy {
  const policy: AdversarialPolicy = {};
  try {
    const db = getDb();
    const proj = db.prepare("SELECT aiInstructions FROM projects WHERE id = ?").get(projectId) as
      | { aiInstructions: string | null }
      | undefined;
    if (proj?.aiInstructions) {
      try {
        const parsed = JSON.parse(proj.aiInstructions);
        const adv = parsed?.adversarial;
        if (adv && typeof adv === "object") {
          if (Array.isArray(adv.decoys))
            policy.decoys = adv.decoys.filter((d: unknown) => typeof d === "string");
          if (Array.isArray(adv.injectionMarkers))
            policy.injectionMarkers = adv.injectionMarkers.filter(
              (m: unknown) => typeof m === "string",
            );
          if (typeof adv.sprawlBudget === "number") policy.sprawlBudget = adv.sprawlBudget;
        }
      } catch {
        // aiInstructions is free-form text; skip silently.
      }
    }
    const task = db.prepare("SELECT metadata FROM tasks WHERE id = ?").get(taskId) as
      | { metadata: string | null }
      | undefined;
    if (task?.metadata) {
      try {
        const md = JSON.parse(task.metadata);
        if (md && typeof md === "object" && md.allowsTestEdits === true) {
          policy.allowsTestEdits = true;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // db errors → empty policy (no scanning)
  }
  return policy;
}

export const __TEST__ = { TEST_PATH_RE, DEFAULT_SPRAWL_BUDGET };
