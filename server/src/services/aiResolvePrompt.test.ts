import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseGitignore, shouldSkip, buildTree, rowToProject } from "./aiResolvePrompt";

// Create a temp directory for filesystem-based tests
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseGitignore", () => {
  test("parses a standard .gitignore file", () => {
    const dir = path.join(tmpDir, "gitignore-test");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\ndist\n*.log\n# comment\n\n.env\n");
    const patterns = parseGitignore(dir);
    expect(patterns).toEqual(["node_modules", "dist", "*.log", ".env"]);
  });

  test("returns empty array when no .gitignore exists", () => {
    const dir = path.join(tmpDir, "no-gitignore");
    fs.mkdirSync(dir);
    expect(parseGitignore(dir)).toEqual([]);
  });

  test("skips comment lines", () => {
    const dir = path.join(tmpDir, "comments");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ".gitignore"), "# ignore these\nfoo\n# also this\nbar\n");
    expect(parseGitignore(dir)).toEqual(["foo", "bar"]);
  });

  test("skips blank lines and trims whitespace", () => {
    const dir = path.join(tmpDir, "blanks");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ".gitignore"), "  foo  \n\n  \nbar\n");
    expect(parseGitignore(dir)).toEqual(["foo", "bar"]);
  });
});

describe("shouldSkip", () => {
  test("skips node_modules (always-skip set)", () => {
    expect(shouldSkip("node_modules", [])).toBe(true);
  });

  test("skips .git (always-skip set)", () => {
    expect(shouldSkip(".git", [])).toBe(true);
  });

  test("skips dotfiles", () => {
    expect(shouldSkip(".env", [])).toBe(true);
    expect(shouldSkip(".hidden", [])).toBe(true);
  });

  test("skips dist, build, coverage", () => {
    expect(shouldSkip("dist", [])).toBe(true);
    expect(shouldSkip("build", [])).toBe(true);
    expect(shouldSkip("coverage", [])).toBe(true);
  });

  test("does not skip regular files", () => {
    expect(shouldSkip("src", [])).toBe(false);
    expect(shouldSkip("README.md", [])).toBe(false);
    expect(shouldSkip("package.json", [])).toBe(false);
  });

  test("skips exact gitignore matches", () => {
    expect(shouldSkip("output", ["output"])).toBe(true);
    expect(shouldSkip("logs", ["/logs/"])).toBe(true);
  });

  test("skips glob pattern matches", () => {
    expect(shouldSkip("file.log", ["*.log"])).toBe(true);
    expect(shouldSkip("file.txt", ["*.log"])).toBe(false);
  });

  test("handles leading slash in pattern", () => {
    expect(shouldSkip("vendor", ["/vendor"])).toBe(true);
  });

  test("handles trailing slash in pattern", () => {
    expect(shouldSkip("tmp", ["tmp/"])).toBe(true);
  });
});

describe("buildTree", () => {
  test("builds tree for a simple directory", () => {
    const dir = path.join(tmpDir, "tree-simple");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "file1.ts"), "");
    fs.writeFileSync(path.join(dir, "file2.ts"), "");
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "index.ts"), "");

    const tree = buildTree(dir, []);
    expect(tree).toContain("src/");
    expect(tree).toContain("file1.ts");
    expect(tree).toContain("file2.ts");
    expect(tree).toContain("index.ts");
  });

  test("directories appear before files", () => {
    const dir = path.join(tmpDir, "tree-order");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a-file.txt"), "");
    fs.mkdirSync(path.join(dir, "z-dir"));

    const tree = buildTree(dir, []);
    const dirLine = tree.indexOf("z-dir/");
    const fileLine = tree.indexOf("a-file.txt");
    expect(dirLine).toBeLessThan(fileLine);
  });

  test("respects maxDepth", () => {
    const dir = path.join(tmpDir, "tree-depth");
    fs.mkdirSync(path.join(dir, "a", "b", "c", "d"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a", "b", "c", "d", "deep.txt"), "");

    const tree = buildTree(dir, [], "", 0, 2);
    expect(tree).toContain("a/");
    expect(tree).toContain("b/");
    expect(tree).toContain("c/");
    // depth 3 (d/) should not appear because maxDepth=2 means we stop at depth > 2
    expect(tree).not.toContain("deep.txt");
  });

  test("skips gitignored entries", () => {
    const dir = path.join(tmpDir, "tree-skip");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "keep.ts"), "");
    fs.writeFileSync(path.join(dir, "remove.log"), "");

    const tree = buildTree(dir, ["*.log"]);
    expect(tree).toContain("keep.ts");
    expect(tree).not.toContain("remove.log");
  });

  test("skips always-skip entries", () => {
    const dir = path.join(tmpDir, "tree-always-skip");
    fs.mkdirSync(dir);
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "index.ts"), "");

    const tree = buildTree(dir, []);
    expect(tree).toContain("index.ts");
    expect(tree).not.toContain("node_modules");
  });

  test("returns empty string for non-existent directory", () => {
    const tree = buildTree("/non/existent/path", []);
    expect(tree).toBe("");
  });

  test("uses correct tree connectors", () => {
    const dir = path.join(tmpDir, "tree-connectors");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "first.ts"), "");
    fs.writeFileSync(path.join(dir, "last.ts"), "");

    const tree = buildTree(dir, []);
    expect(tree).toContain("├── ");
    expect(tree).toContain("└── ");
  });
});

describe("rowToProject", () => {
  test("converts a database row to a Project", () => {
    const row = {
      id: "proj-1",
      name: "Test Project",
      path: "/home/user/test",
      favorite: 1,
      techStack: '["TypeScript","React"]',
      externalLinks: '[]',
      category: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const project = rowToProject(row);
    expect(project.favorite).toBe(true);
    expect(project.techStack).toEqual(["TypeScript", "React"]);
    expect(project.externalLinks).toEqual([]);
    expect(project.name).toBe("Test Project");
  });

  test("handles favorite=0 as false", () => {
    const row = {
      id: "proj-2",
      name: "Test",
      path: "/test",
      favorite: 0,
      techStack: "[]",
      externalLinks: "[]",
    };
    expect(rowToProject(row).favorite).toBe(false);
  });

  test("handles null/missing techStack and externalLinks", () => {
    const row = {
      id: "proj-3",
      name: "Test",
      path: "/test",
      favorite: 0,
      techStack: null,
      externalLinks: null,
    };
    const project = rowToProject(row);
    expect(project.techStack).toEqual([]);
    expect(project.externalLinks).toEqual([]);
  });

  test("preserves extra fields from the row", () => {
    const row = {
      id: "proj-4",
      name: "Test",
      path: "/test",
      favorite: 1,
      techStack: "[]",
      externalLinks: "[]",
      category: "work",
      aiCommitMode: "stage",
    };
    const project = rowToProject(row);
    expect(project.category).toBe("work");
    expect((project as any).aiCommitMode).toBe("stage");
  });
});
