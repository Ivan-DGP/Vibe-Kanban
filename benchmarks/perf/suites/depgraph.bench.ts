/**
 * Dependency-graph generation over a real TS tree. Runs on the task viewer
 * (blast-radius / layering-violation detection) and knowledge injection, so its
 * cost scales with repo size — worth tracking. We point it at server/src, a
 * realistic multi-hundred-file tree. This suite touches the filesystem, so its
 * numbers include real I/O (unlike the pure suite).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Suite } from "../harness";
import { generateDepGraph, dependencyNeighborhood } from "../../../server/src/services/depGraph";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, "../../../server/src");

export const depGraphSuite: Suite = {
  name: "depGraph — server/src tree (includes fs I/O)",
  cases: [
    {
      name: "generateDepGraph (full walk + SCC + Louvain)",
      fn: () => generateDepGraph(SERVER_SRC),
    },
    {
      name: "dependencyNeighborhood (2 files)",
      fn: () => dependencyNeighborhood(SERVER_SRC, ["services/depGraph.ts", "db/index.ts"]),
    },
  ],
};
