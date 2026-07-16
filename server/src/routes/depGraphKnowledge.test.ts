import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../app";
import { getDb } from "../db";

// ===========================================================================
// Integration tests for POST /api/projects/:projectId/graph/from-dependencies
// (using buildApp + inject, following reports.test.ts).
//
// The route drafts suggested knowledge-graph nodes/edges from the project's
// import structure. AI labelling shells out to the `claude` CLI; when it's
// unavailable (as in CI) runAgentOneShot returns null and heuristic dir-based
// labels are used — an expected, valid path.
// ===========================================================================

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;
let tmpDir: string;

/** Write a small connected source fixture so generateDepGraph forms a community. */
function writeFixture(root: string): void {
  const srcDir = path.join(root, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  // core.ts is imported by everyone (a dense star → one Louvain community),
  // and the leaves form a ring so the undirected graph is well connected.
  fs.writeFileSync(path.join(srcDir, "core.ts"), `export const core = 1;\n`);
  const leaves = ["a", "b", "c", "d", "e"];
  leaves.forEach((name, i) => {
    const next = leaves[(i + 1) % leaves.length];
    fs.writeFileSync(
      path.join(srcDir, `${name}.ts`),
      `import { core } from "./core";\nimport "./${next}";\nexport const ${name} = core;\n`,
    );
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "depgraph-knowledge-test-"));
  writeFixture(tmpDir);

  const projRes = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: {
      name: `DepGraph Knowledge Test ${Date.now()}`,
      path: tmpDir,
    },
  });
  projectId = projRes.json().id;
});

afterAll(async () => {
  await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("POST /api/projects/:projectId/graph/from-dependencies", () => {
  test("returns 404 for a non-existent project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/does-not-exist/graph/from-dependencies",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Project not found");
  });

  // Generous timeout: when the `claude` CLI is present the AI labelling step runs
  // for real (a few seconds); when absent it returns instantly via heuristics.
  test("drafts subsystem nodes as suggestions from the dependency graph", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/from-dependencies`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.nodes).toBe("number");
    expect(typeof body.edges).toBe("number");
    expect(typeof body.fileCount).toBe("number");
    // The fixture has 6 connected source files → at least one community/node.
    expect(body.fileCount).toBeGreaterThanOrEqual(6);
    expect(body.nodes).toBeGreaterThanOrEqual(1);

    // Persisted as suggested / origin=dep-graph so they flow through confirm UI.
    const row = getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM project_graph_nodes WHERE projectId = ? AND origin = 'dep-graph' AND status = 'suggested'",
      )
      .get(projectId) as { n: number };
    expect(row.n).toBe(body.nodes);
  }, 60_000);

  test("re-running is idempotent — dep-graph suggestions do not accumulate", async () => {
    const countNodes = () =>
      (
        getDb()
          .prepare(
            "SELECT COUNT(*) AS n FROM project_graph_nodes WHERE projectId = ? AND origin = 'dep-graph'",
          )
          .get(projectId) as { n: number }
      ).n;
    const countEdges = () =>
      (
        getDb()
          .prepare(
            "SELECT COUNT(*) AS n FROM project_graph_edges WHERE projectId = ? AND origin = 'dep-graph'",
          )
          .get(projectId) as { n: number }
      ).n;

    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/from-dependencies`,
    });
    expect(first.statusCode).toBe(200);
    const nodesAfterFirst = countNodes();
    const edgesAfterFirst = countEdges();

    const second = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/from-dependencies`,
    });
    expect(second.statusCode).toBe(200);

    // Prior dep-graph rows are DELETEd first, so counts stay stable (no dupes).
    expect(countNodes()).toBe(nodesAfterFirst);
    expect(countEdges()).toBe(edgesAfterFirst);
    expect(second.json().nodes).toBe(first.json().nodes);
    expect(second.json().edges).toBe(first.json().edges);
  }, 60_000);
});
