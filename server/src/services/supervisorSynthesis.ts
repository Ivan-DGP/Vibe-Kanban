// Phase 4b (backend): LLM-synthesis refinement for supervisor proposals.
// OPT-IN, default OFF via VK_SUPERVISOR_SYNTHESIS_ENABLED. Rewrites each
// proposal's deterministic rationale (built by composeRationale) into sharper,
// more actionable prose using the existing one-shot CLI agent (runAgentOneShot).
//
// This is a refinement LAYER only — it never gates or blocks the scan: disabled,
// CLI-unavailable, timeout, failure, empty, or over-long output all fall back to
// the deterministic rationale, and nothing here throws into the caller. Ranking
// stays deterministic; LLM re-ranking is deliberately future work.
//
// NOTE: runAgentOneShot is synchronous (spawnProcessSync), so refinement blocks
// the scan request per proposal — same tradeoff as depGraphToKnowledgeWithAI.
// Acceptable because this is an explicit, opt-in admin action; each call is
// capped well below the 120s default so a hung CLI can't stall the scan.

import { runAgentOneShot } from "./aiAgent";
import { getSafeEnv } from "./terminalRegistry";
import { log } from "../lib/logger";
import type { SupervisorProposal } from "./supervisorProposals";

/** One-shot runner shape — injectable so tests never spawn a real CLI. */
export type OneShotFn = typeof runAgentOneShot;

export interface RefineOptions {
  safeEnv?: Record<string, string>;
  /** Injected one-shot runner (tests). Defaults to the real CLI agent. */
  runOneShot?: OneShotFn;
}

// Cap well below runAgentOneShot's 120s default so a slow CLI can't stall a scan.
const SYNTHESIS_TIMEOUT_MS = 45_000;
// Guard: a runaway reply must not overwrite the task description with noise.
const MAX_RATIONALE_CHARS = 1200;

/** Opt-in, read at CALL time so operators/tests can toggle without a reload. */
export function isSynthesisEnabled(): boolean {
  const v = process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED;
  return v === "true" || v === "1";
}

/** Prompt the agent to sharpen the rationale while preserving its references. */
function buildSynthesisPrompt(p: SupervisorProposal): string {
  return [
    "You are refining the rationale for a cross-project engineering proposal.",
    "Rewrite the rationale below into 2-4 sharp, actionable sentences explaining",
    "why this work is high-value and how the referenced knowledge/lessons inform it.",
    "Preserve every artifact/task/lesson reference already present. Output ONLY the",
    "rewritten rationale prose — no preamble, headings, or markdown fences.",
    "",
    `Title: ${p.title}`,
    `Signal type: ${p.signalType}`,
    "",
    "Current rationale:",
    p.rationale,
  ].join("\n");
}

/**
 * Refine one proposal's rationale via the CLI agent. Returns the proposal
 * UNCHANGED when synthesis is disabled, the agent is unavailable, the call
 * times out/fails, or the reply is empty or over-long. Never throws.
 */
export function refineProposal(
  p: SupervisorProposal,
  opts: RefineOptions = {},
): SupervisorProposal {
  if (!isSynthesisEnabled()) return p;
  const runOneShot = opts.runOneShot ?? runAgentOneShot;
  const safeEnv = opts.safeEnv ?? getSafeEnv();
  try {
    const text = runOneShot(
      buildSynthesisPrompt(p),
      safeEnv,
      undefined,
      undefined,
      SYNTHESIS_TIMEOUT_MS,
    );
    const refined = text?.trim();
    if (!refined || refined.length > MAX_RATIONALE_CHARS) return p;
    return { ...p, rationale: refined };
  } catch (err) {
    log(
      "warn",
      "server",
      `Supervisor synthesis failed for ${p.signalKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return p;
  }
}

/**
 * Refine a batch of proposals. Short-circuits to the input untouched when
 * disabled (no env read per item, no CLI probe); otherwise each proposal is
 * refined independently and falls back on its own failure.
 */
export function refineProposals(
  proposals: SupervisorProposal[],
  opts: RefineOptions = {},
): SupervisorProposal[] {
  if (!isSynthesisEnabled()) return proposals;
  const safeEnv = opts.safeEnv ?? getSafeEnv();
  return proposals.map((p) => refineProposal(p, { safeEnv, runOneShot: opts.runOneShot }));
}
