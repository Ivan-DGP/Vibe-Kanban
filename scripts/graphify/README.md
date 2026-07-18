# Dependency graphs (graphify)

Generate import/module-dependency graphs for the monorepo.

```bash
bun run graphs        # or: bash scripts/graphify/run.sh
```

Outputs into `docs/graphs/` (gitignored), one folder per unit:

| Folder      | Scope                                                      |
| ----------- | ---------------------------------------------------------- |
| `server/`   | `server/src`                                               |
| `client/`   | `client/src`                                               |
| `combined/` | `client/` + `server/` + `shared/` (cross-package boundary) |

Each folder has:

- `graph.html` — interactive force graph (open in any browser)
- `graph.json` — GraphRAG-ready node/edge data
- `GRAPH_REPORT.md` — god nodes, communities, surprising connections
- `summary.json` — compact metrics (nodes/edges/communities/god-nodes) for tooling

## How it works

1. **Bootstraps a Python venv** (`.venv/`, gitignored) and installs the
   [`graphifyy`](https://pypi.org/project/graphifyy/) package — graphify's AST
   engine is Python. First run only.
2. **Mirrors** the `src` trees to a temp dir with `@/…` and
   `@vibe-kanban/shared` imports rewritten to relative paths
   (`mirror_resolve.py`). The extractor only follows **relative** imports, so
   without this the client graph drops ~450 alias imports and looks like a pile
   of disconnected islands instead of a real dependency graph.
3. **Extracts + clusters** each unit (`gfy_driver.py`): AST import graph →
   Louvain communities → god-node / surprising-connection analysis → HTML/JSON.

Deterministic and LLM-free — safe to run on every commit or in CI.

## Requirements

`python3` with `venv` (standard). No network access after the first
`graphifyy` install.
