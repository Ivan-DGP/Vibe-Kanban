#!/usr/bin/env bash
# Run server tests in batches that don't trigger Bun 1.3.13's --isolate
# segfault (https://github.com/oven-sh/bun/issues — repro: panic at 0x68
# when too many *.integration.test.ts files share a worker pool).
#
# --isolate is required because tasks.integration.test.ts and
# claude.integration.test.ts call mock.module(...) which leaks across
# files without it (see commit 7c9affc).
#
# Strategy:
#   1. Big batch for non-routes (db/lib/mcp/services/app) — fits under the
#      crash threshold.
#   2. Routes file-by-file — each in its own process so isolate state
#      can't accumulate.
#   3. The explicit *.isolated.ts entrypoints, unchanged.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "== batch: db / lib / app =="
bun test --isolate src/db src/lib src/app.test.ts

echo
echo "== batch: mcp =="
bun test --isolate src/mcp

echo
echo "== batch: services =="
bun test --isolate src/services

echo
echo "== routes (per-file) =="
shopt -s nullglob
for f in src/routes/*.test.ts; do
  case "$f" in
    *.isolated.ts) continue ;;  # explicit isolated entrypoints run later
  esac
  echo "-- $f"
  bun test --isolate "$f"
done

echo
echo "== explicit isolated entrypoints =="
bun test ./src/services/terminalService.isolated.ts
bun test ./src/services/terminalService.coverage.isolated.ts
bun test ./src/routes/claude.isolated.ts
