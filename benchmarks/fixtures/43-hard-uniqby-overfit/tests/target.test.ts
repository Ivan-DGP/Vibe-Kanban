import { describe, test, expect } from "bun:test";
import { uniqBy } from "../src/uniqBy";

describe("uniqBy — first-write-wins + edge keys (target)", () => {
  test("duplicate keys: keeps the FIRST occurrence (not the last)", () => {
    const items = [
      { id: 1, label: "first" },
      { id: 1, label: "second" },
      { id: 2, label: "third" },
    ];
    const out = uniqBy(items, (x) => x.id);
    expect(out).toEqual([
      { id: 1, label: "first" },
      { id: 2, label: "third" },
    ]);
  });

  test("preserves original insertion order across duplicates", () => {
    const items = [
      { id: "b", n: 1 },
      { id: "a", n: 2 },
      { id: "b", n: 3 },
      { id: "c", n: 4 },
      { id: "a", n: 5 },
    ];
    const out = uniqBy(items, (x) => x.id);
    expect(out.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(out.map((x) => x.n)).toEqual([1, 2, 4]);
  });

  test("NaN keys: all NaNs collapse to one entry (first wins)", () => {
    const items = [
      { id: NaN, label: "first-nan" },
      { id: 1, label: "real" },
      { id: NaN, label: "second-nan" },
    ];
    const out = uniqBy(items, (x) => x.id);
    expect(out).toEqual([
      { id: NaN, label: "first-nan" },
      { id: 1, label: "real" },
    ]);
  });

  test("undefined keys collapse to one entry (first wins)", () => {
    const items: { id: number | undefined; label: string }[] = [
      { id: undefined, label: "u1" },
      { id: 1, label: "real" },
      { id: undefined, label: "u2" },
    ];
    const out = uniqBy(items, (x) => x.id);
    expect(out).toEqual([
      { id: undefined, label: "u1" },
      { id: 1, label: "real" },
    ]);
  });

  test("each preserved item is REFERENTIALLY the first occurrence", () => {
    const a1 = { id: 1, tag: "a1" };
    const a2 = { id: 1, tag: "a2" };
    const b = { id: 2, tag: "b" };
    const out = uniqBy([a1, a2, b], (x) => x.id);
    expect(out[0]).toBe(a1);
    expect(out[1]).toBe(b);
  });
});
