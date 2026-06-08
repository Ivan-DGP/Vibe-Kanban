import { describe, test, expect } from "bun:test";
import { findFirst } from "../src/list-helpers";

describe("findFirst — must visit every element including the last (target)", () => {
  test("finds a match at the LAST index", () => {
    // The current bug skips the final element — this assertion pins the fix.
    expect(findFirst([1, 2, 3, 4, 5], (n) => n === 5)).toBe(5);
  });

  test("finds a unique match anywhere in the array", () => {
    expect(findFirst([10, 20, 30, 40], (n) => n === 40)).toBe(40);
    expect(findFirst([10, 20, 30, 40], (n) => n === 10)).toBe(10);
    expect(findFirst([10, 20, 30, 40], (n) => n === 30)).toBe(30);
  });

  test("returns the FIRST of multiple matches", () => {
    expect(findFirst([1, 2, 3, 2, 1], (n) => n === 2)).toBe(2);
    // Matched at index 1, value 2 — making sure forward order is preserved.
    expect(findFirst(["a", "b", "c", "b"], (s) => s === "b")).toBe("b");
  });

  test("works on a single-element array when that element matches", () => {
    expect(findFirst([42], (n) => n === 42)).toBe(42);
  });

  test("returns undefined when nothing matches", () => {
    expect(findFirst([1, 2, 3], (n) => n === 99)).toBeUndefined();
  });

  test("returns undefined for an empty array", () => {
    expect(findFirst<number>([], (n) => n === 1)).toBeUndefined();
  });

  test("predicate receives the index", () => {
    const seen: number[] = [];
    findFirst(["a", "b", "c"], (_v, i) => {
      seen.push(i);
      return false;
    });
    // Off-by-one would yield [0, 1] instead of [0, 1, 2].
    expect(seen).toEqual([0, 1, 2]);
  });
});
