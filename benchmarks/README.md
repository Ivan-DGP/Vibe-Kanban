# Vibe-Kanban benchmarks

TDD-graded benchmarks for the AI task-solving pipeline. Each fixture is a tiny self-contained codebase with a failing target test (defines "solved") and regression tests (define "no breakage"). The harness copies a fixture into a temp work dir, invokes the Claude CLI with the fixture's prompt and the work dir as `cwd`, then runs the tests and computes a diff to score the result.

## Layout

```
benchmarks/
  fixtures/<id>/
    bench.json                 spec — prompt, target test, regression test, budgets
    src/                       codebase the AI works in
    tests/target.test.ts       must pass after fix → defines "solved"
    tests/regression.test.ts   must keep passing → defines "no regressions"
  harness/
    run.ts                     CLI entry
    score.ts                   numstat parsing, JSON+MD report writers
    types.ts                   BenchSpec / BenchResult / BenchReport
  results/<timestamp>.{json,md}
  .runs/                       transient work dirs (auto-cleaned, override with --keep)
```

## Running

```bash
bun run bench:dry                       # verify wiring, no AI call
bun run bench                           # run all fixtures with real Claude CLI
bun run bench -- --fixture=01-bug-fix-arithmetic
bun run bench -- --keep                 # keep .runs/ workdirs for inspection
```

The `claude` binary must be on PATH for non-dry runs.

## Scoring

A fixture is `solved` iff:

- `target.test.ts` passes after the AI run, AND
- `regression.test.ts` still passes.

Additional metrics captured per run: AI exit code, AI duration, total duration, files changed, lines added/removed, whether diff stayed within `maxDiffLines`, whether changes are confined to `expectedFilesChanged`, and the AI's summary.

## Adding a fixture

1. `mkdir benchmarks/fixtures/<NN>-<short-id>`
2. Drop minimal source under `src/`, splittable bug or missing feature
3. Write `tests/target.test.ts` — the test that defines "this is solved." Should fail at baseline.
4. Write `tests/regression.test.ts` — tests that must keep passing. Should pass at baseline.
5. Write `bench.json` with the prompt the AI gets. Keep it precise — the prompt is the only context the AI has besides the codebase.
6. Verify baseline: `cd benchmarks/fixtures/<id> && bun test tests/target.test.ts` should fail; `bun test tests/regression.test.ts` should pass.

Fixtures must NOT have their own `.git/` directory — the harness inits a fresh git repo inside each per-run work dir.
