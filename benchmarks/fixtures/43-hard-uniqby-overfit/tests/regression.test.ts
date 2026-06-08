import { describe, test, expect } from "bun:test";
import { uniqBy } from "../src/uniqBy";

describe("uniqBy — base contract (regression)", () => {
  test("empty array returns empty array", () => {
    expect(uniqBy([], (x: number) => x)).toEqual([]);
  });

  test("single element returns that element", () => {
    expect(uniqBy([42], (x) => x)).toEqual([42]);
  });

  test("all-distinct primitive keys preserves array as-is", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(uniqBy(arr, (x) => x)).toEqual([1, 2, 3, 4, 5]);
  });

  test("string keys dedupe by exact match", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "b" }];
    const out = uniqBy(items, (x) => x.id);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  test("number keys dedupe by exact match", () => {
    expect(uniqBy([1, 2, 1, 3, 2], (x) => x)).toEqual([1, 2, 3]);
  });

  test("dedup count matches Set size of mapped keys (reasonable invariant)", () => {
    const items = [{ k: 1 }, { k: 1 }, { k: 2 }, { k: 3 }, { k: 3 }, { k: 3 }];
    const out = uniqBy(items, (x) => x.k);
    expect(out.length).toBe(3);
  });
});
