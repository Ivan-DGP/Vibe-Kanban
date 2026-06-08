import { describe, test, expect } from "bun:test";
import { parseNumstat } from "./score";

describe("parseNumstat", () => {
  test("single file: counts adds and removes", () => {
    const r = parseNumstat("5\t2\tsrc/sum.ts\n");
    expect(r.filesChanged).toEqual(["src/sum.ts"]);
    expect(r.linesAdded).toBe(5);
    expect(r.linesRemoved).toBe(2);
  });

  test("multiple files: aggregates totals", () => {
    const r = parseNumstat("5\t2\tsrc/a.ts\n10\t0\tsrc/b.ts\n3\t1\tsrc/c.ts\n");
    expect(r.filesChanged.sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(r.linesAdded).toBe(18);
    expect(r.linesRemoved).toBe(3);
  });

  test("empty input → zero changes", () => {
    const r = parseNumstat("");
    expect(r.filesChanged).toEqual([]);
    expect(r.linesAdded).toBe(0);
    expect(r.linesRemoved).toBe(0);
  });

  test("whitespace-only input → zero changes", () => {
    const r = parseNumstat("\n\n   \n");
    expect(r.filesChanged).toEqual([]);
    expect(r.linesAdded).toBe(0);
    expect(r.linesRemoved).toBe(0);
  });

  test("binary file marker (-/-): file counted, lines stay zero", () => {
    const r = parseNumstat("-\t-\timg.png\n");
    expect(r.filesChanged).toEqual(["img.png"]);
    expect(r.linesAdded).toBe(0);
    expect(r.linesRemoved).toBe(0);
  });

  test("filename with spaces is preserved", () => {
    const r = parseNumstat("1\t1\tdir/hello world.txt\n");
    expect(r.filesChanged).toEqual(["dir/hello world.txt"]);
    expect(r.linesAdded).toBe(1);
    expect(r.linesRemoved).toBe(1);
  });

  test("malformed lines are skipped", () => {
    const r = parseNumstat("garbage\nmore garbage\n2\t3\tsrc/ok.ts\n");
    expect(r.filesChanged).toEqual(["src/ok.ts"]);
    expect(r.linesAdded).toBe(2);
    expect(r.linesRemoved).toBe(3);
  });
});
