import type { InjectionSpec, BenchResult } from "./types";

/**
 * Compute the set of VK_INJECT_* env vars from a fixture's injection spec.
 * Returned vars are merged into the pipeline subprocess env. No-op for empty/undefined specs.
 */
export function buildInjectionEnv(spec: InjectionSpec | undefined): Record<string, string> {
  if (!spec) return {};
  const env: Record<string, string> = {};
  if (spec.outputFormatBroken) env.VK_INJECT_OUTPUT_FORMAT_BROKEN = "1";
  if (typeof spec.killAfterMs === "number" && spec.killAfterMs > 0) {
    env.VK_INJECT_KILL_AFTER_MS = String(Math.floor(spec.killAfterMs));
  }
  if (typeof spec.mcp500Rate === "number" && spec.mcp500Rate > 0) {
    const clamped = Math.min(1, Math.max(0, spec.mcp500Rate));
    env.VK_INJECT_MCP_500_RATE = String(clamped);
  }
  if (spec.claudeNotFound) env.VK_INJECT_CLAUDE_NOT_FOUND = "1";
  return env;
}

export function listInjectionModes(spec: InjectionSpec | undefined): string[] {
  if (!spec) return [];
  const modes: string[] = [];
  if (spec.outputFormatBroken) modes.push("outputFormatBroken");
  if (typeof spec.killAfterMs === "number" && spec.killAfterMs > 0) modes.push("killAfterMs");
  if (typeof spec.mcp500Rate === "number" && spec.mcp500Rate > 0) modes.push("mcp500Rate");
  if (spec.claudeNotFound) modes.push("claudeNotFound");
  return modes;
}

/**
 * Decide whether the production pipeline surfaced the injected failure cleanly.
 * Inputs are the post-run BenchResult plus the original spec — we re-derive
 * "what failure should look like" from the spec rather than trusting that
 * non-zero exit always means recovery.
 */
export interface ClassifyArgs {
  spec: InjectionSpec;
  exitCode: number | null;
  rowFound: boolean;
  rowExitCode: number | null;
  slotLeaked: boolean;
  summary: string | null;
  pipelineError: string | null;
  mcp500Count: number;
}

export interface ClassifyResult {
  surfaced: boolean;
  recovered: boolean;
  notes: string[];
}

export function classifyInjection(args: ClassifyArgs): ClassifyResult {
  const notes: string[] = [];
  let surfaced = false;

  if (args.spec.outputFormatBroken) {
    // Parser fallback should land summary=tail (garbage), session_id=null. The system
    // exits 0 (claude itself exited 0), but the row's summary should clearly NOT contain
    // a well-formed result envelope. We treat presence of malformed-tail OR null sessionId
    // as "surfaced".
    const looksMalformed = !args.summary || !/"session_id"|"sessionId"/.test(args.summary);
    if (looksMalformed) {
      surfaced = true;
      notes.push("parser fallback handled malformed JSON");
    } else {
      notes.push("malformed-output not surfaced — summary parsed cleanly");
    }
  }

  if (typeof args.spec.killAfterMs === "number" && args.spec.killAfterMs > 0) {
    if (args.rowFound && args.rowExitCode !== null && args.rowExitCode !== 0) {
      surfaced = true;
      notes.push(`kill recorded: exitCode=${args.rowExitCode}`);
    } else {
      notes.push("kill not recorded — silent SOLVED");
    }
  }

  if (typeof args.spec.mcp500Rate === "number" && args.spec.mcp500Rate > 0) {
    if (args.mcp500Count > 0) {
      surfaced = true;
      notes.push(`MCP rejected ${args.mcp500Count} requests`);
    } else {
      notes.push("MCP injection set but no 5xx observed");
    }
  }

  if (args.spec.claudeNotFound) {
    if (args.pipelineError && /ENOENT|not found|claude/i.test(args.pipelineError)) {
      surfaced = true;
      notes.push("missing CLI surfaced as pipeline error");
    } else if (args.exitCode !== null && args.exitCode !== 0) {
      surfaced = true;
      notes.push(`missing CLI surfaced as exit ${args.exitCode}`);
    } else {
      notes.push("missing CLI did not surface — silent SOLVED");
    }
  }

  if (typeof args.spec.expectExitNonZero === "boolean" && args.spec.expectExitNonZero) {
    if (args.rowExitCode === 0) {
      surfaced = false;
      notes.push("expected non-zero exit but row recorded exit=0");
    }
  }

  if (typeof args.spec.expectSummaryEmpty === "boolean" && args.spec.expectSummaryEmpty) {
    if (args.summary && /"session_id"|"result":/.test(args.summary)) {
      surfaced = false;
      notes.push("expected empty/garbage summary but a clean envelope was recorded");
    }
  }

  const recovered = surfaced && !args.slotLeaked && args.rowFound;
  if (args.slotLeaked) notes.push("slot leak");
  if (!args.rowFound) notes.push("no task_ai_runs row written");
  return { surfaced, recovered, notes };
}

/** Convenience: pull the inputs out of a populated BenchResult. */
export function classifyFromResult(spec: InjectionSpec, r: BenchResult): ClassifyResult {
  return classifyInjection({
    spec,
    exitCode: r.ai.exitCode,
    rowFound: r.sideEffects.taskAiRun.found,
    rowExitCode: r.sideEffects.taskAiRun.exitCode,
    slotLeaked: r.concurrency.slotLeak,
    summary: r.ai.summary,
    pipelineError: r.error,
    mcp500Count: r.injection.mcp500Count,
  });
}
