import { describe, test, expect, afterEach } from "bun:test";
import { refineProposal, refineProposals, isSynthesisEnabled } from "./supervisorSynthesis";
import type { SupervisorProposal } from "./supervisorProposals";

function sampleProposal(over: Partial<SupervisorProposal> = {}): SupervisorProposal {
  return {
    signalKey: "roadmap:abc",
    signalType: "roadmap",
    projectId: "p1",
    title: "Ship the widget API",
    rationale: "Planned but unstarted. Related knowledge: schema.md (Alpha).",
    score: 10,
    grounded: { knowledge: [], memory: [] },
    ...over,
  };
}

afterEach(() => {
  delete process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED;
});

describe("isSynthesisEnabled — opt-in, default OFF", () => {
  test("false when unset; true only for 'true' or '1'", () => {
    expect(isSynthesisEnabled()).toBe(false);
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "true";
    expect(isSynthesisEnabled()).toBe(true);
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "1";
    expect(isSynthesisEnabled()).toBe(true);
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "yes";
    expect(isSynthesisEnabled()).toBe(false);
  });
});

describe("refineProposal — disabled (default)", () => {
  test("returns the proposal untouched and never invokes the runner", () => {
    const p = sampleProposal();
    let called = false;
    const out = refineProposal(p, {
      runOneShot: () => {
        called = true;
        return "should not run";
      },
    });
    expect(out).toBe(p); // same reference — no copy
    expect(called).toBe(false);
  });
});

describe("refineProposal — enabled", () => {
  test("replaces the rationale with the refined prose; input left untouched", () => {
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "1";
    const p = sampleProposal();
    const original = p.rationale;
    const out = refineProposal(p, { safeEnv: {}, runOneShot: () => "  A sharper rationale.  " });
    expect(out.rationale).toBe("A sharper rationale."); // trimmed
    expect(out.title).toBe(p.title); // title untouched
    expect(out.signalKey).toBe(p.signalKey);
    expect(out).not.toBe(p); // a copy, not the input
    expect(p.rationale).toBe(original); // input not mutated
  });

  test("passes the prompt + forwards the injected safeEnv to the runner", () => {
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "true";
    const p = sampleProposal();
    const env = { PATH: "/x", HOME: "/h" };
    let seenPrompt = "";
    let seenEnv: Record<string, string> | undefined;
    refineProposal(p, {
      safeEnv: env,
      runOneShot: (prompt, safeEnv) => {
        seenPrompt = prompt;
        seenEnv = safeEnv;
        return "ok";
      },
    });
    expect(seenPrompt).toContain(p.title);
    expect(seenPrompt).toContain(p.signalType);
    expect(seenPrompt).toContain(p.rationale);
    expect(seenEnv).toBe(env); // the exact safeEnv is threaded through
  });

  test("null output falls back to the deterministic rationale", () => {
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "1";
    const p = sampleProposal();
    const out = refineProposal(p, { safeEnv: {}, runOneShot: () => null });
    expect(out).toBe(p);
  });

  test("empty/whitespace output falls back", () => {
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "1";
    const p = sampleProposal();
    const out = refineProposal(p, { safeEnv: {}, runOneShot: () => "   " });
    expect(out).toBe(p);
  });

  test("over-long output is rejected (guards against a runaway reply)", () => {
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "1";
    const p = sampleProposal();
    const out = refineProposal(p, { safeEnv: {}, runOneShot: () => "x".repeat(5000) });
    expect(out).toBe(p);
  });

  test("a throwing runner is swallowed → deterministic fallback", () => {
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "1";
    const p = sampleProposal();
    const out = refineProposal(p, {
      safeEnv: {},
      runOneShot: () => {
        throw new Error("CLI blew up");
      },
    });
    expect(out).toBe(p);
  });
});

describe("refineProposals — batch", () => {
  test("disabled → returns the same array untouched", () => {
    const ps = [sampleProposal(), sampleProposal({ signalKey: "roadmap:def" })];
    const out = refineProposals(ps, { runOneShot: () => "nope" });
    expect(out).toBe(ps);
  });

  test("enabled → refines each independently", () => {
    process.env.VK_SUPERVISOR_SYNTHESIS_ENABLED = "1";
    const ps = [
      sampleProposal({ signalKey: "roadmap:a", title: "A" }),
      sampleProposal({ signalKey: "roadmap:b", title: "B" }),
    ];
    const out = refineProposals(ps, {
      safeEnv: {},
      runOneShot: (prompt) => (prompt.includes("Title: A") ? "refined-A" : "refined-B"),
    });
    expect(out[0].rationale).toBe("refined-A");
    expect(out[1].rationale).toBe("refined-B");
  });
});
