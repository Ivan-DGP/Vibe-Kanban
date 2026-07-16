import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { depGraphToKnowledge } from "./depGraphToKnowledge";

// depGraphToKnowledge() runs generateDepGraph() over a real directory, so we
// build a small on-disk fixture whose import structure yields two dense
// subsystems ("alpha", "beta") plus a tiny 2-file cluster that must be dropped.
//
//   src/alpha/a1..a5  — near-complete internal graph (one community)
//   src/beta/b1..b5   — near-complete internal graph (one community)
//   3 directed alpha->beta cross imports (a1->b1, a2->b2, a3->b3)  => weight 3
//   2 directed beta->alpha cross imports (b4->a4, b5->a5)          => weight 2
//   src/tiny/t1<->t2  — 2-file cluster, below MIN_COMMUNITY (4)

let root: string;

function writeFile(rel: string, content: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dep2know-"));
  const ids = [1, 2, 3, 4, 5];

  for (const i of ids) {
    const internal = ids
      .filter((j) => j !== i)
      .map((j) => `import "./a${j}";`)
      .join("\n");
    const cross = i <= 3 ? `\nimport "../beta/b${i}";` : "";
    writeFile(`src/alpha/a${i}.ts`, internal + cross + "\n");
  }
  for (const i of ids) {
    const internal = ids
      .filter((j) => j !== i)
      .map((j) => `import "./b${j}";`)
      .join("\n");
    const cross = i >= 4 ? `\nimport "../alpha/a${i}";` : "";
    writeFile(`src/beta/b${i}.ts`, internal + cross + "\n");
  }
  writeFile("src/tiny/t1.ts", `import "./t2";\n`);
  writeFile("src/tiny/t2.ts", `import "./t1";\n`);
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("depGraphToKnowledge", () => {
  test("keeps communities >= MIN_COMMUNITY (4) and drops smaller ones", () => {
    const k = depGraphToKnowledge(root);

    // alpha (5) + beta (5) survive; tiny (2) is dropped.
    expect(k.communities.length).toBe(2);
    for (const c of k.communities) {
      expect(c.fileCount).toBeGreaterThanOrEqual(4);
    }
    // fileCount reflects every scanned source file, dropped clusters included.
    expect(k.fileCount).toBe(12);
  });

  test("the dropped tiny cluster contributes no community and no files", () => {
    const k = depGraphToKnowledge(root);
    const allFiles = k.communities.flatMap((c) => c.files);
    expect(allFiles.some((f) => f.includes("tiny"))).toBe(false);
  });

  test("derives dir-based heuristic labels and descriptions", () => {
    const k = depGraphToKnowledge(root);
    const labels = k.communities.map((c) => c.label).sort();
    expect(labels).toEqual(["alpha", "beta"]);

    for (const c of k.communities) {
      // humanize() strips the leading "src" segment -> just the subsystem dir.
      expect(c.label).toBe(c.group);
      expect(c.description).toContain(`files under src/${c.label}`);
      expect(c.description).toContain("key:");
      // Top files are listed and belong to the community's directory.
      expect(c.files.length).toBeGreaterThan(0);
      expect(c.files.every((f) => f.startsWith(`src/${c.label}/`))).toBe(true);
    }
  });

  test("only cross-community edges with weight >= MIN_CROSS_EDGES (3) appear", () => {
    const k = depGraphToKnowledge(root);
    const kept = new Set(k.communities.map((c) => c.community));

    // alpha->beta has 3 imports (kept); beta->alpha has 2 (dropped).
    expect(k.edges.length).toBe(1);
    const [edge] = k.edges;
    expect(edge.weight).toBeGreaterThanOrEqual(3);
    expect(edge.weight).toBe(3);
    expect(edge.source).not.toBe(edge.target);
    // Endpoints must reference kept communities only.
    expect(kept.has(edge.source)).toBe(true);
    expect(kept.has(edge.target)).toBe(true);
  });

  test("empty / non-source directory yields no communities or edges", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dep2know-empty-"));
    try {
      const k = depGraphToKnowledge(empty);
      expect(k.communities).toEqual([]);
      expect(k.edges).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
