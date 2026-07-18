# Perf benchmarks

Micro-benchmarks for server **hot paths** — wall-time / ops-sec of real backend
code. This is separate from `benchmarks/` proper, which grades the AI
task-solving pipeline. No network, no subprocess, no AI here.

## Running

```bash
bun run bench:perf                    # every suite, full sampling (~15s)
bun run bench:perf:quick              # shorter sampling, for a quick look / CI smoke
bun run bench:perf -- --filter=chunk  # only cases whose name matches (substring, case-insensitive)
bun run bench:perf -- --json          # also write benchmarks/perf/results/<ts>.json
```

## Layout

```
perf/
  setupEnv.ts    redirects VK_DATA_DIR to a temp dir — imported FIRST (see below)
  harness.ts     the runner: auto-calibrated batch timing, mean/p50/p99/min, ops-sec
  run.ts         CLI entry — arg parsing, filtering, table + JSON output
  suites/
    pure.bench.ts       chunkText, parseWikilinks, slugify, encrypt/decrypt (CPU-only)
    db.bench.ts         seeded 2k-task SQLite: list page, list-all, count, get-by-id
    depgraph.bench.ts   generateDepGraph over server/src (includes real fs I/O)
  results/       gitignored JSON reports (--json)
```

## Safety: the temp-DB trap

`server/src/lib/data-dir.ts` freezes the data directory into a module-level
const at first import, and `crypto.ts` (pulled in by the suites) imports it. If
`VK_DATA_DIR` isn't set before that const evaluates, the DB suite would seed the
developer's **real** `data/vibe-kanban.db`. `setupEnv.ts` sets `VK_DATA_DIR` to a
throwaway temp dir and is imported first in `run.ts` — keep it first. Any new
suite that touches the DB must go through this same entry.

## How timing works

For each case the harness auto-calibrates an `innerLoops` batch size so one batch
runs ~1ms (amortizing timer overhead), warms up ~150ms, then collects batch
samples for ~800ms. Reported figures are per single call: `mean`, `p50`, `p99`,
`min`, and `ops/s = 1e9 / meanNs`. Uses `Bun.nanoseconds()` when available.

## Adding a case

Add a `BenchCase` (`{ name, fn, setup? }`) to an existing suite's `cases`, or
create a new `suites/<x>.bench.ts` exporting a `Suite` and register it in
`run.ts`. `fn` should be allocation-light and do exactly the work you're timing.
If it touches the DB or any server module that reads config, import
`./setupEnv` (transitively via the suite loaded from `run.ts`) so it never hits
the real data dir.
