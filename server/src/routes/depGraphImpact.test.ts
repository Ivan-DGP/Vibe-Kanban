import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../app";

// Blast-radius logic lives inside the Fastify route (POST /projects/:id/impact),
// so we drive it via app.inject against a project pointed at an on-disk fixture.
//
// Fixture import graph (reverse deps in parens):
//   src/core.ts  <- a.ts, c.ts
//   src/a.ts     -> core   (imported by b.ts)
//   src/b.ts     -> a
//   src/c.ts     -> core
//
// Impact of core.ts: direct importers {a,c} = 2; transitive {a,b,c} = 3.

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;
let root: string;

function writeFile(rel: string, content: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "depimpact-"));
  writeFile("src/core.ts", `export const core = 1;\n`);
  writeFile("src/a.ts", `import "./core";\n`);
  writeFile("src/b.ts", `import "./a";\n`);
  writeFile("src/c.ts", `import "./core";\n`);

  app = await buildApp();
  await app.ready();

  const projRes = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: { name: `Impact Test ${Date.now()}`, path: root },
  });
  projectId = projRes.json().id;
});

afterAll(async () => {
  await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("POST /projects/:projectId/impact", () => {
  test("returns transitive impact set for a node with known dependents", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/impact`,
      headers: { "Content-Type": "application/json" },
      payload: { files: ["src/core.ts"] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.files).toEqual(["src/core.ts"]);
    expect(body.directDependents).toBe(2); // a.ts, c.ts
    expect(body.transitiveDependents).toBe(3); // a.ts, c.ts, b.ts
    expect(Array.isArray(body.top)).toBe(true);
    // a.ts is imported by b.ts, so it ranks first in `top`.
    expect(body.top[0].file).toBe("src/a.ts");
    expect(body.top[0].dependents).toBe(1);
  });

  test("unknown node yields an empty impact set", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/impact`,
      headers: { "Content-Type": "application/json" },
      payload: { files: ["src/does-not-exist.ts"] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.files).toEqual([]);
    expect(body.directDependents).toBe(0);
    expect(body.transitiveDependents).toBe(0);
    expect(body.top).toEqual([]);
  });

  test("a leaf node (no importers) has zero dependents", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/impact`,
      headers: { "Content-Type": "application/json" },
      payload: { files: ["src/b.ts"] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.files).toEqual(["src/b.ts"]);
    expect(body.directDependents).toBe(0);
    expect(body.transitiveDependents).toBe(0);
  });

  test("returns 404 for an unknown project", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/does-not-exist/impact`,
      headers: { "Content-Type": "application/json" },
      payload: { files: ["src/core.ts"] },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Project not found");
  });
});
