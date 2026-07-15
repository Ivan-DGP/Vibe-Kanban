#!/usr/bin/env bash
# Generate import/module-dependency graphs for the monorepo with graphify.
#
# graphify's extractor is Python, so this self-bootstraps a local venv the first
# time (scripts/graphify/.venv, gitignored). Outputs an interactive graph.html +
# graph.json + GRAPH_REPORT.md + summary.json per package into docs/graphs/
# (gitignored). Re-run any time:  bun run graphs
#
# Graphs are built from a temp mirror of the src trees with `@/` and
# `@vibe-kanban/shared` path-alias imports rewritten to relative paths — the
# AST extractor only follows relative imports, so without this the client graph
# looks artificially fragmented (see README).
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
HERE="$ROOT/scripts/graphify"
VENV="$HERE/.venv"
OUT="$ROOT/docs/graphs"
PY="$VENV/bin/python"

# 1. bootstrap the venv (idempotent)
if [ ! -x "$PY" ]; then
  echo "[graphs] first run — creating venv + installing graphifyy…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip >/dev/null
  "$VENV/bin/pip" install --quiet graphifyy
fi

# 2. mirror src with aliases resolved (temp, auto-cleaned)
MIRROR="$(mktemp -d)"
trap 'rm -rf "$MIRROR"' EXIT
"$PY" "$HERE/mirror_resolve.py" "$ROOT" "$MIRROR"

# 3. one graph per package + a combined whole-app graph
mkdir -p "$OUT"
"$PY" "$HERE/gfy_driver.py" "$OUT/server"   "$MIRROR/server"
"$PY" "$HERE/gfy_driver.py" "$OUT/client"   "$MIRROR/client"
"$PY" "$HERE/gfy_driver.py" "$OUT/combined" "$MIRROR/client" "$MIRROR/server" "$MIRROR/shared"

echo "[graphs] done → docs/graphs/{server,client,combined}/graph.html"
