import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripCommentsAndWhitespace, verifyMultiFile } from "./multiFile";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "multifile-test-"));
});

afterEach(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function runCmd(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const exit = await proc.exited;
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`${args.join(" ")} failed: ${err}`);
  }
}

async function gitInit(workDir: string): Promise<void> {
  await runCmd(["git", "init", "-q"], workDir);
  await runCmd(["git", "config", "user.name", "bench"], workDir);
  await runCmd(["git", "config", "user.email", "bench@local"], workDir);
  await runCmd(["git", "add", "-A"], workDir);
  await runCmd(["git", "commit", "-q", "-m", "baseline"], workDir);
}

describe("stripCommentsAndWhitespace", () => {
  test("removes line comments", () => {
    const src = "const x = 1; // a trailing comment\nconst y = 2;";
    expect(stripCommentsAndWhitespace(src)).toBe("const x = 1;\nconst y = 2;");
  });

  test("removes block comments", () => {
    const src = "const a = /* inline */ 1;\n/* block\nspans */\nconst b = 2;";
    expect(stripCommentsAndWhitespace(src)).toBe("const a = 1;\nconst b = 2;");
  });

  test("collapses whitespace and drops empty lines", () => {
    const src = "  const   x = 1;\n\n   \n  const y = 2;  \n";
    expect(stripCommentsAndWhitespace(src)).toBe("const x = 1;\nconst y = 2;");
  });

  test("preserves comment-like sequences inside strings", () => {
    const src = `const url = "http://example.com//path";\nconst note = "/* not a comment */";`;
    const out = stripCommentsAndWhitespace(src);
    expect(out).toContain("http://example.com//path");
    expect(out).toContain("/* not a comment */");
  });

  test("preserves comment-like sequences inside template literals", () => {
    const src = "const t = `// not a comment ${x}`;";
    expect(stripCommentsAndWhitespace(src)).toBe("const t = `// not a comment ${x}`;");
  });

  test("two semantically-equal sources are normalized equal", () => {
    const a = "// header\nfunction add(x: number, y: number): number {\n  return x + y;\n}";
    const b = "function add(x: number, y: number): number {\n  /* identical body */\n  return x + y;\n}\n\n";
    expect(stripCommentsAndWhitespace(a)).toBe(stripCommentsAndWhitespace(b));
  });

  test("differing source code is detected as different", () => {
    const a = "function add(x: number, y: number): number {\n  return x + y;\n}";
    const b = "function add(x: number, y: number): number {\n  return x - y;\n}";
    expect(stripCommentsAndWhitespace(a)).not.toBe(stripCommentsAndWhitespace(b));
  });
});

describe("verifyMultiFile", () => {
  test("happy path: every required file has a non-trivial change", async () => {
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpRoot, "b.ts"), "export const b = 2;\n");
    await gitInit(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 100;\n");
    fs.writeFileSync(path.join(tmpRoot, "b.ts"), "export const b = 200;\n");

    const r = await verifyMultiFile(tmpRoot, ["a.ts", "b.ts"]);
    expect(r.allTouched).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.trivial).toEqual([]);
  });

  test("missing: file not in diff at all", async () => {
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpRoot, "b.ts"), "export const b = 2;\n");
    await gitInit(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 99;\n");

    const r = await verifyMultiFile(tmpRoot, ["a.ts", "b.ts"]);
    expect(r.allTouched).toBe(false);
    expect(r.missing).toEqual(["b.ts"]);
    expect(r.trivial).toEqual([]);
  });

  test("trivial: whitespace-only change", async () => {
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpRoot, "b.ts"), "export const b = 2;\n");
    await gitInit(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 99;\n");
    fs.writeFileSync(path.join(tmpRoot, "b.ts"), "export   const   b   =   2;\n\n\n");

    const r = await verifyMultiFile(tmpRoot, ["a.ts", "b.ts"]);
    expect(r.allTouched).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.trivial).toEqual(["b.ts"]);
  });

  test("trivial: comment-only change", async () => {
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpRoot, "b.ts"), "export const b = 2;\n");
    await gitInit(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 99;\n");
    fs.writeFileSync(path.join(tmpRoot, "b.ts"), "// fixed!\nexport const b = 2;\n/* comment */\n");

    const r = await verifyMultiFile(tmpRoot, ["a.ts", "b.ts"]);
    expect(r.allTouched).toBe(false);
    expect(r.trivial).toEqual(["b.ts"]);
    expect(r.missing).toEqual([]);
  });

  test("mixed: one ok, one missing, one trivial", async () => {
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpRoot, "b.ts"), "export const b = 2;\n");
    fs.writeFileSync(path.join(tmpRoot, "c.ts"), "export const c = 3;\n");
    await gitInit(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, "a.ts"), "export const a = 99;\n");
    fs.writeFileSync(path.join(tmpRoot, "c.ts"), "// noop\nexport const c = 3;\n");

    const r = await verifyMultiFile(tmpRoot, ["a.ts", "b.ts", "c.ts"]);
    expect(r.allTouched).toBe(false);
    expect(r.missing).toEqual(["b.ts"]);
    expect(r.trivial).toEqual(["c.ts"]);
  });

  test("empty requireFiles → allTouched=true (no-op)", async () => {
    const r = await verifyMultiFile(tmpRoot, []);
    expect(r.allTouched).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.trivial).toEqual([]);
  });

  test("nested path under src/ works", async () => {
    fs.mkdirSync(path.join(tmpRoot, "src"));
    fs.writeFileSync(path.join(tmpRoot, "src", "types.ts"), "export type Id = number;\n");
    fs.writeFileSync(path.join(tmpRoot, "src", "repo.ts"), "export const repo = 1;\n");
    await gitInit(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, "src", "types.ts"), "export type Id = string;\n");
    fs.writeFileSync(path.join(tmpRoot, "src", "repo.ts"), "export const repo = 42;\n");

    const r = await verifyMultiFile(tmpRoot, ["src/types.ts", "src/repo.ts"]);
    expect(r.allTouched).toBe(true);
  });
});
