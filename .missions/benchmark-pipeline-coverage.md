# Mission: Benchmark Pipeline Coverage

**Goal:** Extend the v1 benchmark harness from ~10-15% production-pipeline coverage to ~100% — measure the real `taskSpawner → headlessClaude` flow including MCP, prompt wrappers, orchestration, side-effects, and concurrency.
**Created:** 2026-05-04
**Status:** completed

## Context

We shipped v1 at `benchmarks/` (3 fixtures, harness, JSON+MD reports). Three validation agents found:
- 5 v1 integrity bugs (answer-key leak, test tampering risk, weak gates, parser, no baseline pre-flight)
- 8 production pipeline gaps (no MCP, wrong prompts, single-shot only, DB writes / cascade / snapshots / embeddings / concurrency unexercised)

v1 measures "AI vs codebase" — useful, but not what the user asked for ("how the pipeline and workflow of solving tasks does"). This mission closes the gap. Each phase is independently mergeable.

Unit of evaluation throughout: TDD-graded — solved iff target test passes AND regression tests hold.

Existing code under: `benchmarks/{fixtures,harness,results}` and production at `server/src/services/{taskSpawner,headlessClaude,spawnPrompts,registerSpawnConfigs,mcpConfigWriter}.ts`, `server/src/routes/tasks.ts`.

## Phases

### Phase A: v1 trust & integrity
- **Status:** completed
- **Dependencies:** none
- **Files:**
  - `benchmarks/harness/run.ts`
  - `benchmarks/harness/score.ts`
  - `benchmarks/harness/types.ts`
  - `benchmarks/harness/run.test.ts` (new)
  - `benchmarks/harness/score.test.ts` (new)
- **Work items:**
  - [x] A1: `copyDirSync` takes an `ignore` predicate; `runOne` passes `(rel) => rel === "bench.json"`. Verified: `.runs/<fixture>/` no longer contains `bench.json`.
  - [x] A2: `hashDir` (sha256, recursive) snapshots `tests/` before AI invocation; `compareDirHashes` after AI run; if any path differs → `tampering.detected = true`, status becomes `TAMPERED`.
  - [x] A3: `evaluateStatus` gates on target + regressions + `expectedFilesOnly` + `withinBudget` in strict mode; `--lenient` flag relaxes to v1 (target + regressions only); over-gate result becomes new status `SPRAWL`.
  - [x] A4: `detectMisFixture(targetExit, regExit)` runs on pristine work dir; sets `MIS-FIXTURE` if baseline target already passes or baseline regression fails. Skipped on `--mock` and `--dry-run`.
  - [x] A5: `parseClaudeJson` defensive-parses live CLI shape: `models[]` (from `modelUsage` keys), `numTurns`, `totalCostUsd`, `durationApiMs`, `inputTokens`, `outputTokens`, `stopReason`, `terminalReason`, `permissionDenials`. JSONL tool-use trace deferred (out of Phase A scope).
  - [x] A6: 34 tests across `score.test.ts` (parseNumstat) + `run.test.ts` (copyDirSync exclusion, hashDir/compareDirHashes, detectMisFixture, evaluateStatus full status matrix, parseClaudeJson real/streaming/empty). `bun run bench --mock` → 3/3 SOLVED; `bun run bench --dry-run` → 3/3 TARGET-FAIL; `bun run --cwd server test` green.
- **Notes:** New `BenchStatus` enum: `SOLVED · TARGET-FAIL · TARGET-ONLY · REGRESSED · SPRAWL · TAMPERED · MIS-FIXTURE · ERROR`. `printOneLine` and report markdown switched from "solved yes/no" → status display. `main()` gated with `import.meta.main` so harness functions are importable in tests.

### Phase B: pipeline-bench mode (in-process production path)
- **Status:** completed
- **Dependencies:** Phase A
- **Files:**
  - `benchmarks/harness/pipeline.ts` (new — pipeline-mode runner)
  - `benchmarks/harness/fake-claude.ts` (new — PATH-shim drop-in for `claude -p --output-format json`)
  - `benchmarks/harness/run.ts` (added `--mode=pipeline` + `--mock-claude` flag wiring; subprocess dispatch)
  - `benchmarks/harness/types.ts` (extended BenchSpec with `pipelineMode?: "codebase" | "qa-test" | "dev-fix"`)
  - `server/src/services/registerSpawnConfigs.ts` (registered `bench-codebase` type)
  - `server/src/services/spawnPrompts.ts` (added `buildBenchCodebasePrompt`)
  - `benchmarks/harness/pipeline.test.ts` (new)
- **Work items:**
  - [x] B1: `--mode=harness|pipeline` flag added (default `harness`); pipeline mode dispatches to a Bun subprocess running `pipeline.ts` and reads the BenchResult JSON from a `--result-file=<path>` so Fastify's stdout logger doesn't pollute the result.
  - [x] B2: pipeline.ts sets `VK_DATA_DIR` (per-run tmpdir), `PORT` (free port from `findFreePort`), `VK_BENCH_API_URL` (for the fake-claude shim) BEFORE dynamic-importing `server/src/app` + `server/src/db`. buildApp().listen() on the resolved port.
  - [x] B3: `bench-codebase` spawn config + `buildBenchCodebasePrompt` registered. Vanilla "fix the code, then update_task to done" prompt with `vibe-kanban` MCP attached. Existing `qa-test`/`dev-fix` configs untouched.
  - [x] B4: Pipeline runner: copy fixture (excluding bench.json) → gitInit → POST /api/projects → PATCH `autoSpawnEnabled=true` → POST tasks with `metadata.type="bench-codebase"` → poll `task_ai_runs` for the matching row → tampering check → tests → diff → score (`evaluateStatus`) → cleanup (close app/db, restore PATH, rm work/data/shim dirs).
  - [x] B5: BenchResult.ai is enriched from `parseClaudeJson(taskAiRun.summary)` (sessionId, models, numTurns, totalCostUsd). Side-effect snapshots (cascade timestamps, snapshot file, embeddings) deferred to Phase D — Phase B captures the row + summary only.
  - [x] B6: 5 new unit tests in `pipeline.test.ts` for `findFreePort` (range/bindable/distinct) + `setupShim` (mode bits, exec semantics). Smoke: `bun run bench --mode=pipeline --mock-claude` → 3/3 SOLVED. `bun run --cwd server test` → 1108/1108 pass.
- **Notes:** Subprocess-per-fixture architecture chosen over in-process loop — `data-dir.ts` evaluates `DATA_DIR` const at import time and `mcpConfigWriter` similarly snapshots `PORT`, so re-using one process across fixtures is unsafe. Each pipeline run is a fresh `bun pipeline.ts --fixture=<id>` invocation. Fake-claude shim uses HTTP PATCH /api/tasks/:id (mocking what real claude does via MCP `update_task`) — verified production task PATCH route updates status correctly. The bash wrapper exports `VK_BENCH_API_URL` because production `spawnProcess` only forwards a fixed env allowlist (PATH/HOME/USERPROFILE/SYSTEMROOT) to subprocesses.

### Phase C: multi-task orchestration bench
- **Status:** completed
- **Dependencies:** Phase B
- **Files:**
  - `benchmarks/harness/pipeline.ts` (added `traceChain` + chain trace wiring in `runPipeline`)
  - `benchmarks/harness/fake-claude.ts` (handles `mockChain`: GETs own task type, PATCHes done, optionally POSTs child task)
  - `benchmarks/fixtures/04-orchestration-qa-fix/` (new — qa-test → dev-fix fixture)
  - `benchmarks/harness/types.ts` (added `mockChain` + `expectedChainDepth` to BenchSpec; added `chain` block to BenchResult)
  - `benchmarks/harness/run.ts` (skip mockChain fixtures in harness mode; chain field in makeEmptyResult)
  - `benchmarks/harness/score.ts` (chain line in MD report)
  - `benchmarks/harness/chain.test.ts` (new — 6 unit tests against in-memory sqlite)
- **Work items:**
  - [x] C1: `traceChain(getDb, rootTaskId, projectId, settleMs, maxDepth=5)` walks `tasks WHERE json_extract(metadata,'$.parent_task') = ?`. Per hop, polls `task_ai_runs` for the child to settle.
  - [x] C2: BenchResult.chain captures `depth`, `parentLinksValid`, `leafTaskId`, `leafStatus`, `totalAiRuns`, `totalDurationMs`, `totalCostUsd`, `expectedDepth`, `expectedDepthMet`. MD report shows the chain line for fixtures with `expectedChainDepth` set or depth>1.
  - [x] C3: Fixture 04 (`04-orchestration-qa-fix`) — login validator returns wrong reason on empty password. `pipelineMode="qa-test"`, `expectedChainDepth=2`. mockChain step 1 (qa-test) creates a dev-fix child with bug_report metadata; step 2 (dev-fix) writes the patched login.ts.
  - [x] C4: Baseline `bun test tests/target.test.ts` fails / `regression.test.ts` passes. `bun run bench --mode=pipeline --mock-claude` → 4/4 SOLVED including fixture 04 (depth=2, leaf=done, parentLinksValid=true). 6 chain.test.ts unit tests green; full harness suite 45/45; full server suite 1108/1108.
- **Notes:** fake-claude handles chain dispatch by calling `GET /api/tasks/:id` to discover its own metadata.type, then matching against the `mockChain` array shipped to cwd as `.bench-mockchain.json`. The harness writes both `.bench-mockfix.json` (legacy single-fix) and `.bench-mockchain.json` (chain-aware) to workDir before kicking off; both are removed before the grading tests run so they don't show up in the diff. evaluateStatus does not gate on chain — chain shape is reported separately. If the chain fails to unfold the leaf never lands a fix, target test fails, and we report TARGET-FAIL through the existing path.

### Phase D: side-effect verification
- **Status:** completed
- **Dependencies:** Phase B
- **Files:**
  - `benchmarks/harness/sideEffects.ts` (new — verifyTaskAiRun, verifyTimestampCascade, verifySnapshot, verifyEmbeddings, summarize)
  - `benchmarks/harness/pipeline.ts` (calls into sideEffects after traceChain on the leaf task)
  - `benchmarks/harness/types.ts` (added `sideEffects` block to BenchResult)
  - `benchmarks/harness/run.ts` (sideEffects in makeEmptyResult)
  - `benchmarks/harness/score.ts` (side-effects MD report line)
  - `benchmarks/harness/sideEffects.test.ts` (new — 19 unit tests)
- **Work items:**
  - [x] D1: `verifyTaskAiRun(getDb, taskId)` returns `{ found, exitCode, success, durationMs, sessionIdSet, summarySet }` — selects latest row by createdAt desc.
  - [x] D2: `verifyTimestampCascade(getDb, taskId)` returns `{ inboxAtSet, inProgressAtSet, doneAtSet, cascadeOrdered }` — `cascadeOrdered` checks pairwise ISO ordering across set timestamps; partial cascade (only inbox) is ordered=true.
  - [x] D3: `verifySnapshot(dataDir, projectId, taskId)` checks `<dataDir>/tasks/<projectId>.json` exists and contains a task with the matching id; malformed JSON → `fileExists=true, taskInSnapshot=false`.
  - [x] D4: `verifyEmbeddings(getDb, taskId, settleMs=5000)` polls `task_embeddings` since `embedTaskInBackground` is fire-and-forget. Returns `{ rowCount, skipped }` — `skipped=true` when 0 rows after the window so silent embedding-disabled environments don't gate `allGreen`.
  - [x] D5: Smoke fixture 01 in pipeline mode → `sideEffects.allGreen=true`; all 4 fixtures (01/02/03/04) green on every invariant including embeddings (rowCount=1). Harness suite 64/64 (19 new); server suite 1302/1302 across 26 sharded batches.
- **Notes:** Hooked into pipeline.ts after `traceChain`, using `chain.leafTaskId` (so chained fixtures verify the leaf, e.g. fixture 04's dev-fix child). `summarize()` computes `allGreen` requiring all four invariants except embeddings.skipped is allowed. MD report adds one `- side-effects: allGreen=… aiRun=… ts=[inbox=… inProgress=… done=… ordered=…] snapshot=…/… embeddings=…` line per fixture. evaluateStatus does NOT gate on sideEffects — it's diagnostic, similar to chain in Phase C.

### Phase E: concurrency & stress
- **Status:** completed
- **Dependencies:** Phase B
- **Files:**
  - `benchmarks/harness/run.ts` (added `--parallel=N` flag, chunked Promise.all dispatch, VK_DISABLE_EMBEDDINGS env passthrough)
  - `benchmarks/harness/pipeline.ts` (capture getHeadlessClaudeStats before/after AI run; write/cleanup `.bench-hangms`; bumped `pollForTaskAiRun` deadline to spec.timeoutMs+5000 so the post-kill DB write can settle; sets VK_HEADLESS_CLAUDE_TIMEOUT_MS from spec.timeoutMs)
  - `benchmarks/harness/types.ts` (added `concurrency` block to BenchResult; `mockHangMs` to BenchSpec; new `TIMEOUT` BenchStatus)
  - `benchmarks/harness/run.ts` (evaluateStatus emits TIMEOUT when concurrency.timedOut && !targetPassed)
  - `benchmarks/harness/score.ts` (concurrency line in MD report)
  - `benchmarks/harness/fake-claude.ts` (reads `.bench-hangms` and sleeps before doing anything)
  - `benchmarks/harness/concurrency.test.ts` (new — 12 unit tests)
  - `benchmarks/harness/run.test.ts` (added 2 TIMEOUT cases to evaluateStatus matrix; updated baseResult helper with chain/concurrency/sideEffects)
  - `benchmarks/fixtures/05-timeout-recovery/` (new — calc.ts with add bug; mockHangMs=30000, timeoutMs=2000)
  - `server/src/services/headlessClaude.ts` (DEFAULT_TIMEOUT_MS now reads VK_HEADLESS_CLAUDE_TIMEOUT_MS env)
  - `server/src/services/taskEmbedder.ts` (early-return when VK_DISABLE_EMBEDDINGS=1)
- **Work items:**
  - [x] E1: `--parallel=N` runs N pipeline subprocesses concurrently. Default N=1 (sequential). Each subprocess gets its own free port, VK_DATA_DIR, shim dir.
  - [x] E2: `concurrency.statsBefore`/`statsAfter` snapshot `getHeadlessClaudeStats()`; `slotLeak = statsAfter.inFlight !== 0`. Verified `slotLeak=false` on all 5 fixtures including the killed timeout case.
  - [x] E3: Fixture 05 (`05-timeout-recovery`) sets `mockHangMs=30000` and `timeoutMs=2000`. fake-claude sleeps; production kills it after 2s; spawnHeadlessClaude finally block records the row (exitCode=143/SIGTERM) and releases the slot. Status `TIMEOUT` (new) reported when `concurrency.timedOut && !targetPassed`.
  - [x] E4: Smoke `--mode=pipeline --mock-claude --parallel=2` → 4 SOLVED + 1 TIMEOUT, every slotLeak=false. 12 concurrency.test.ts unit tests; 2 added evaluateStatus rows; harness suite 78/78; server suite 1302/1302 across 26 sharded batches.
- **Notes:** Two tricky bits surfaced. (1) `pollForTaskAiRun` originally used `spec.timeoutMs` as its own deadline, but the row is only written *after* the kill+spawnHeadlessClaude finally block — needed +5s settle window or polls miss the row. (2) Parallel subprocesses race in `@xenova/transformers` cache initialization (`ENOENT: ... open 'blob:...'`). Solved by setting `VK_DISABLE_EMBEDDINGS=1` for parallel runs only — phase-D embedding verification still works at parallel=1, and `verifyEmbeddings` already accommodates `skipped: true`. The headlessClaude `VK_HEADLESS_CLAUDE_TIMEOUT_MS` env override is a useful production knob (default unchanged at 15min).

### Phase F: reporting, model comparison, cost
- **Status:** completed
- **Dependencies:** Phase A (works on standalone codebase results too)
- **Files:**
  - `benchmarks/harness/aggregate.ts` (new — pure groupers, cost sum, compareReports, formatters, file IO)
  - `benchmarks/harness/aggregate.test.ts` (new — 25 unit tests)
  - `benchmarks/harness/run.ts` (subcommand dispatch: `aggregate` / `compare` / default-run; usage updated)
  - `benchmarks/harness/types.ts` (added `BenchAggregateReport`, `BenchCompareReport`, `AggregateBucket`, `FixtureCompareEntry`; optional `costBudgetUsd` on `BenchSpec`)
- **Work items:**
  - [x] F1: `bun run bench aggregate` reads `results/*.json`, emits roll-up by fixture/model/week (markdown + json under `aggregate-<ts>.{json,md}`)
  - [x] F2: `bun run bench compare <a.json> <b.json>` classifies each fixture as regression/improvement/status-change/added/removed and surfaces cost + duration deltas
  - [x] F3: Cost reporting — `byFixture`/`byModel`/`byWeek` buckets sum `ai.totalCostUsd`; `computeOverBudget` flags fixtures whose history total ≥ `spec.costBudgetUsd` (no-op until a fixture defines a budget — zero false positives on current mock-claude history)
  - [x] F4: 25 unit tests in aggregate.test.ts (groupers, cost, compare, week-bucketing, file IO with malformed-json tolerance); aggregate runs cleanly against the 27-report history (62 results); harness suite 103/103 across 7 files; server suite all green (`bun run --cwd server test` → exit 0)
- **Notes:** History tolerance was non-obvious — pre-Phase-D reports lack `ai.models[]`, so `groupByModel` defensively treats `r.ai?.models` as optional and buckets missing entries under `(unknown)`. `loadAllReports` also swallows malformed json files instead of poisoning the roll-up. Subcommand dispatch lives at the top of `main()` — first non-flag positional decides; everything else falls through to the existing `parseArgs` so `--fixture=…` / `--mode=…` keep working without `--` separator hacks.

### Phase G: fixture library expansion
- **Status:** completed
- **Dependencies:** Phase A (codebase mode), benefits from B for full pipeline runs
- **Files:**
  - `benchmarks/fixtures/06-react-reducer-reset/` (new — counter reducer RESET case bug)
  - `benchmarks/fixtures/07-css-class-merger/` (new — Tailwind-style cn() conflict resolution)
  - `benchmarks/fixtures/08-async-debounce/` (new — debounce missing prior-timer cancellation)
  - `benchmarks/fixtures/09-shared-type-id-drift/` (new — multi-file: types + service + repo)
  - `benchmarks/fixtures/10-validator-cross-file/` (new — multi-file: validator + service)
  - `benchmarks/fixtures/11-hard-token-bucket/` (new — token bucket no-clamp-on-refill)
  - `benchmarks/fixtures/12-hard-event-once/` (new — typed EventBus once() never auto-removes)
- **Work items:**
  - [x] G1: 3 frontend-flavored fixtures — `06-react-reducer-reset` (React useReducer RESET unchanged), `07-css-class-merger` (cn() class-conflict resolver), `08-async-debounce` (debounce double-fire). All Bun-test based; Playwright deferred (E2E adds flake/cost without proportional signal at this layer).
  - [x] G2: 2 multi-file fixtures — `09-shared-type-id-drift` (types.ts + service.ts + repo.ts; expectedFilesChanged=3) and `10-validator-cross-file` (validator.ts + service.ts; both must be edited). Recognized harness limitation: bun:test runtime is type-lenient, so a determined single-file fix can pass tests; multi-file is encoded via prompt + expectedFilesChanged + mockFix demonstrating the canonical fix.
  - [x] G3: 2 hard calibration fixtures — `11-hard-token-bucket` (capacity-clamp on long-idle refill) and `12-hard-event-once` (self-removing wrapper that respects `[...arr]` snapshot semantics during emit). Both require holding two invariants simultaneously to pass target+regression.
  - [x] G4: Baseline target=FAIL / regression=PASS verified for all 7 fixtures; `bun run bench --mock` → 7/7 SOLVED; harness suite 103/103; server suite green across all 26 sharded batches.
- **Notes:** Total fixtures now 12 across {bug-fix, feature-add, regression-trap, orchestration, timeout-recovery, react, css, async, multi-file types, multi-file validator, hard token bucket, hard event-once}. Difficulty mix: 7 medium, 3 hard (#11, #12, #09), 2 already medium-hard (#03, #05). Categories cover algorithm, abstract-data-type, async, frontend (logic level), and cross-file refactor. Multi-file enforcement strictness is a known harness gap — would require AST checks or per-file test partitioning to fix; out of scope for v1.

### Phase H: UI integration
- **Status:** completed
- **Dependencies:** Phase F (consumes aggregate data)
- **Files:**
  - `server/src/routes/benchmarks.ts` (new — list runs, get run detail, fixtures, aggregate, active, trigger; pure `buildBenchArgs` helper for unit testing)
  - `server/src/routes/benchmarks.test.ts` (new — 16 tests: 8 buildBenchArgs unit + 8 route-via-app.inject)
  - `server/src/app.ts` (registered `/benchmarks` route)
  - `client/src/lib/api/index.ts` (added `api.benchmarks.*` and ~150 LOC of inline types: BenchRunSummary, BenchFixture, BenchActiveRun, BenchTriggerInput, BenchAggregate, BenchResult, BenchReport, BenchAiInfo, BenchTestsInfo, BenchDiffInfo)
  - `client/src/hooks/useBenchmarks.ts` (new — 6 React Query hooks)
  - `client/src/hooks/index.ts` (re-export)
  - `client/src/routes/Benchmarks.tsx` (new — header, TriggerPanel, hardest-fixtures, runs table, detail panel with collapsible per-fixture rows + Re-run buttons)
  - `client/src/App.tsx` (lazy-loaded `/benchmarks` route)
  - `client/src/components/layout/AppShell.tsx` (Beaker icon nav entry)
  - `benchmarks/harness/aggregate.ts` (filtered `aggregate-*.json` and `compare-*.json` from `listResultFiles` so meta-reports don't poison the roll-up)
- **Work items:**
  - [x] H1: Backend route — `GET /benchmarks/runs` (newest-first list with cost + models rolled up per file), `GET /benchmarks/runs/:id` (full report; ID regex-validated against `/^[A-Za-z0-9._-]+$/`), `GET /benchmarks/fixtures`, `GET /benchmarks/aggregate` (in-process call into harness aggregate.ts), `GET /benchmarks/active`, `POST /benchmarks/runs` (Bun.spawn `bun run bench …` from repo root; in-memory active-runs registry; `VK_DISABLE_BENCH_SPAWN=1` env short-circuits the spawn for tests).
  - [x] H2: Frontend page at `/benchmarks` — 6 React Query hooks (list w/ 5s refetch, run detail, fixtures, aggregate w/ 10s, active w/ 2s, trigger mutation). Page composes: header + count subtitle, "New run" panel (multi-select all 12 fixtures + 3 flag checkboxes + parallel input), hardest-fixtures top-5, active-runs panel (only when present), runs table (clickable rows; URL `?run=<id>` deep-links the detail), per-fixture `ResultRow` collapsible with status badge / Tests / Diff / AI / Chain / Side-effects / Error sections.
  - [x] H3: Re-run wired in two places — per-fixture `RefreshCw` icon on each `ResultRow` POSTs `{fixtures:[id], mock:true, mode:"harness"}`, and "Re-run all" button on the detail header POSTs the full fixture list of that report.
  - [x] H4: Tests — 16 new tests pass via `bun run --cwd server test` (full 27-batch sharded suite green). Harness suite still 103/103. `bun run bench --mock` → 11/11 SOLVED (fixture 04 is pipeline-mode-only). Manual browser verify via frontend-debugger agent: 9/9 checks pass — page loads cleanly, runs list populated (29 reports), row click expands detail, per-fixture rows expand to show "target: PASS / regression: HOLD", New-run panel functional, sidebar nav updated, zero console errors.
- **Notes:** ID validation on `:id` rejects `..` and `/` so the router can't be tricked into reading outside `RESULTS_DIR`. The harness `aggregate-*.json` and `compare-*.json` meta-files live in the same `results/` dir as bench reports — without filtering they'd crash `aggregate()` (no `.results` field). Filter applied in both the route's listing and the harness's `listResultFiles` so `bun run bench aggregate` is also safe to re-run against a directory that already contains aggregate output. The trigger endpoint runs `bun run bench …` as a subprocess from repo root, so it inherits the dev environment without needing harness module imports. `VK_BENCH_DIR` env override exists for tests; `VK_DISABLE_BENCH_SPAWN=1` skips the spawn so route tests don't kick off real runs.

## Risks & Open Questions

- **Token budget** — pipeline-mode runs cost real $$$. Phase B onward needs a per-run budget cap (env var `VK_BENCH_MAX_COST_USD`?) and a default to `--mode=codebase` until explicitly opted in.
- **In-process Fastify port collisions** — phase B and E need a free-port helper. Bun has `Bun.listen({ port: 0 })`; verify Fastify accepts the resolved port.
- **Temp DB isolation** — `VK_DATA_DIR` must be set BEFORE any module that imports `data-dir.ts` is loaded (the const evaluates at import time). Pipeline runner must use dynamic imports.
- **MCP SSE in tests** — the SSE endpoint is on the same Fastify instance; the spawned `claude -p` opens a separate process and connects via HTTP. Localhost-only is fine; check if `claude` resolves the URL correctly without the dev proxy.
- **Streaming-JSON edge cases** — `headlessClaude.parseClaudeOutput` has a fallback path (`headlessClaude.ts:67-83`); pipeline mode must surface unparsed cases as a benchmark error, not silent SOLVED.
- **MCP `update_task` auth** — when claude calls back via MCP to mark task done, does production require any token? Check `server/src/routes/mcp.ts`.
- **fixture 04 design** — Phase C needs a fixture that genuinely exercises the qa-test → dev-fix flow without requiring a browser; may need a non-Playwright qa-test variant.
- **Frontend test fixtures (G1)** — Playwright-driven targets are slow + flaky; consider whether to gate them behind a separate `--include-e2e` flag.

## Completion Summary

All eight phases shipped. Coverage went from ~10-15% → broad pipeline coverage with TDD-graded scoring, real production paths exercised, side-effect invariants verified, concurrency stress modeled, history aggregation + comparison, and a UI in front of all of it.

**Headline metrics** (post-mission):
- 12 fixtures across 8 categories × 3 difficulties: bug-fix, feature-add, regression-trap, async, react-state, css-merge, abstract-data-type, multi-file refactor.
- Harness suite: 103/103 across 7 files (run, score, pipeline, chain, sideEffects, concurrency, aggregate).
- Server suite: 27-batch sharded run all green; +16 tests for the new `/benchmarks` route via `app.inject()`.
- Mock smoke run: 11/11 SOLVED (fixture 04 is pipeline-mode-only and skipped in harness mode by design).
- Benchmark statuses now richer than v1: SOLVED · TARGET-FAIL · TARGET-ONLY · REGRESSED · SPRAWL · TAMPERED · MIS-FIXTURE · TIMEOUT · ERROR.
- Aggregate over 29 historical reports / 70 results loads cleanly; per-fixture/per-model/per-week buckets with cost roll-up; compare emits regression/improvement/status-change deltas.

**What runs the production path now (Phase B+):** in-process `buildApp()` against an isolated sqlite + per-run free-port + tmp `VK_DATA_DIR`; real `bench-codebase`/`qa-test`/`dev-fix` spawn configs + `buildBenchCodebasePrompt`; real MCP wired via `vibe-kanban` config writer; real `task_ai_runs` row capture; real timestamp cascade + JSON snapshot + embeddings verification (with parallel-run cache-collision guarded by `VK_DISABLE_EMBEDDINGS`); real concurrency-slot accounting via `getHeadlessClaudeStats()`.

**Integrity guards (Phase A):** answer-key (`bench.json`) excluded from copy; `tests/` directory hashed pre/post-AI to detect tampering; gates upgraded so `solved` requires target+regressions+`expectedFilesOnly`+`withinBudget` (with `--lenient` opt-out); baseline pre-flight catches mis-fixtures (target already passing, regression already failing); Claude JSON parser captures models, turns, cost, tokens, terminal/stop reason.

**UI (Phase H):** `/benchmarks` page with multi-fixture trigger panel, runs table, deep-linkable detail panel via `?run=<id>`, hardest-fixtures and active-runs widgets, per-fixture re-run, full-report re-run.

**Known limitations to note for future work:**
- Multi-file fixture enforcement is still bun:test-runtime lenient; an AST-level check would be required to *force* the AI to touch every file in `expectedFilesChanged` rather than just *allow* it.
- Phase H trigger spawns `bun run bench` as a subprocess; live progress streaming (via SSE/WebSocket) was deferred — the frontend polls instead. Active-runs registry is in-memory and not persisted across server restarts.
- Phase G calibration fixtures (#11, #12) target current-frontier difficulty; revisit when models leap.
