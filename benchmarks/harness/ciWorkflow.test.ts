import { describe, test, expect } from "bun:test";
import path from "node:path";
import fs from "node:fs";

const WORKFLOW_PATH = path.resolve(import.meta.dir, "../../.github/workflows/bench.yml");

describe(".github/workflows/bench.yml", () => {
  const raw = fs.readFileSync(WORKFLOW_PATH, "utf-8");

  test("file exists and is readable", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  test("targets PR + schedule + workflow_dispatch", () => {
    expect(raw).toContain("pull_request");
    expect(raw).toContain("schedule");
    expect(raw).toContain("workflow_dispatch");
  });

  test("declares pr-gate, main-baseline, and nightly jobs", () => {
    expect(raw).toMatch(/^\s+pr-gate:/m);
    expect(raw).toMatch(/^\s+main-baseline:/m);
    expect(raw).toMatch(/^\s+nightly:/m);
  });

  test("PR gate runs mock harness and passes baseline+comment-out", () => {
    expect(raw).toContain("--mode=harness");
    expect(raw).toContain("--mock");
    expect(raw).toContain("--ci");
    expect(raw).toContain("--baseline=");
    expect(raw).toContain("--comment-out=");
  });

  test("PR comment uses replace mode + tag for idempotency", () => {
    expect(raw).toContain("vk-bench-delta");
    expect(raw).toContain("comment-tag: vk-bench-delta");
    expect(raw).toContain("edit-mode: replace");
  });

  test("nightly references ANTHROPIC_API_KEY secret + cost cap env", () => {
    expect(raw).toContain("ANTHROPIC_API_KEY");
    expect(raw).toContain("VK_BENCH_MAX_COST_USD");
    expect(raw).toContain("secrets.ANTHROPIC_API_KEY");
  });

  test("nightly runs the mission-specified subset (01/02/03 + one harder fixture)", () => {
    expect(raw).toContain("--fixture=01-bug-fix-arithmetic");
    expect(raw).toContain("--fixture=02-feature-add-validator");
    expect(raw).toContain("--fixture=03-regression-trap");
    expect(raw).toMatch(/--fixture=1[1-4]-/);
  });

  test("nightly performs a week-over-week compare", () => {
    expect(raw).toContain("bench compare");
  });

  test("main-baseline uploads aggregate artifact for PRs to download", () => {
    expect(raw).toContain("bench-main-aggregate");
    expect(raw).toContain("aggregate-*.json");
  });

  test("PR job downloads main aggregate via gh artifact API", () => {
    expect(raw).toContain("gh run download");
    expect(raw).toContain("bench-main-aggregate");
  });
});
