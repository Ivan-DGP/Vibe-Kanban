import { describe, test, expect } from "bun:test";
import { findLast, findIndex } from "../src/list-helpers";

describe("findLast (regression — must keep working)", () => {
  test("finds a match at the last index", () => {
    expect(findLast([1, 2, 3, 4, 5], (n) => n === 5)).toBe(5);
  });

  test("finds a match at the FIRST index — boundary that breaks if _iterate's stop condition is loosened", () => {
    expect(findLast([1, 2, 3, 4, 5], (n) => n === 1)).toBe(1);
  });

  test("returns the LAST of multiple matches", () => {
    expect(findLast([1, 2, 3, 2, 1], (n) => n === 2)).toBe(2);
    // value 2 appears at indices 1 and 3 — findLast must pick index 3.
    const arr = [
      { id: 1, tag: "x" },
      { id: 2, tag: "y" },
      { id: 3, tag: "x" },
    ];
    expect(findLast(arr, (e) => e.tag === "x")?.id).toBe(3);
  });

  test("works on a single-element array", () => {
    expect(findLast([42], (n) => n === 42)).toBe(42);
  });

  test("returns undefined when nothing matches", () => {
    expect(findLast([1, 2, 3], (n) => n === 99)).toBeUndefined();
  });

  test("returns undefined for an empty array", () => {
    expect(findLast<number>([], (n) => n === 1)).toBeUndefined();
  });

  test("predicate receives the correct index when scanning backward", () => {
    const seen: number[] = [];
    findLast(["a", "b", "c"], (_v, i) => {
      seen.push(i);
      return false;
    });
    expect(seen).toEqual([2, 1, 0]);
  });
});

describe("findIndex (regression — must keep working)", () => {
  test("returns index of a match at the LAST position — breaks if forward bound is tightened", () => {
    expect(findIndex([10, 20, 30, 40, 50], (n) => n === 50)).toBe(4);
  });

  test("returns index of a match at the first position", () => {
    expect(findIndex([10, 20, 30], (n) => n === 10)).toBe(0);
  });

  test("returns the FIRST matching index when duplicates exist", () => {
    expect(findIndex([1, 2, 3, 2, 1], (n) => n === 2)).toBe(1);
  });

  test("returns -1 when nothing matches", () => {
    expect(findIndex([1, 2, 3], (n) => n === 99)).toBe(-1);
  });

  test("returns -1 for empty array", () => {
    expect(findIndex<number>([], (n) => n === 1)).toBe(-1);
  });
});
