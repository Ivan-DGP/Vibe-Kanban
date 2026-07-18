import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateDepGraph } from "./depGraph";

// Layer-violation detection is internal (layerOf / detectLayerViolations are not
// exported), so we exercise it through generateDepGraph().layerViolations.
//
// Layer order (top->down): route(0) -> service(1) -> infra(2). A more-foundational
// module importing a higher-level one (fromLayer > toLayer) is a violation.
//
// Fixture:
//   src/routes/board.ts    imports ../services/svc   route(0)  -> service(1)  LEGAL
//   src/services/svc.ts    imports ../db/store        service(1)-> infra(2)   LEGAL
//   src/services/report.ts imports ../routes/board    service(1)-> route(0)   VIOLATION
//   src/db/store.ts        (leaf, no imports)

let root: string;

function writeFile(rel: string, content: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "deplayer-"));
  writeFile("src/routes/board.ts", `import "../services/svc";\n`);
  writeFile("src/services/svc.ts", `import "../db/store";\n`);
  writeFile("src/services/report.ts", `import "../routes/board";\n`);
  writeFile("src/db/store.ts", `export const store = {};\n`);
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("depGraph layer violations", () => {
  test("flags a service importing a route (upward/illegal)", () => {
    const g = generateDepGraph(root);

    const violation = g.layerViolations.find(
      (v) => v.source === "src/services/report.ts" && v.target === "src/routes/board.ts",
    );
    expect(violation).toBeDefined();
    expect(violation!.fromLayer).toBe("service");
    expect(violation!.toLayer).toBe("route");
  });

  test("does not flag legal downward imports (route->service, service->infra)", () => {
    const g = generateDepGraph(root);

    // route -> service (0 -> 1) is legal.
    expect(
      g.layerViolations.some(
        (v) => v.source === "src/routes/board.ts" && v.target === "src/services/svc.ts",
      ),
    ).toBe(false);
    // service -> infra (1 -> 2) is legal.
    expect(
      g.layerViolations.some(
        (v) => v.source === "src/services/svc.ts" && v.target === "src/db/store.ts",
      ),
    ).toBe(false);
  });

  test("exactly one violation in the fixture", () => {
    const g = generateDepGraph(root);
    expect(g.layerViolations.length).toBe(1);
  });
});
