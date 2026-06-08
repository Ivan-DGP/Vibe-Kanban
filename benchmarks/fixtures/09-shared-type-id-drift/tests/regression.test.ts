import { describe, test, expect } from "bun:test";
import { buildCart, newItem } from "../src/service";
import { priceOf, findById } from "../src/repo";
import type { Item } from "../src/types";

describe("repo + cart math (regression)", () => {
  test("priceOf resolves known names", () => {
    const it: Item = { id: 99, name: "cherry", qty: 1 };
    expect(priceOf(it)).toBe(5);
  });

  test("priceOf returns 0 for unknown", () => {
    const it: Item = { id: 100, name: "kiwi", qty: 1 };
    expect(priceOf(it)).toBe(0);
  });

  test("buildCart sums price*qty", () => {
    const items: Item[] = [
      { id: 1, name: "apple", qty: 3 },
      { id: 2, name: "banana", qty: 2 },
    ];
    const c = buildCart(items);
    expect(c.total).toBe(3 + 4);
    expect(c.items.length).toBe(2);
  });

  test("findById on hand-built items still works after fix", () => {
    const a = newItem("apple", 1);
    const b = newItem("banana", 1);
    expect(findById([a, b], a.id)).toBe(a);
    expect(findById([a, b], b.id)).toBe(b);
  });

  test("newItem still produces a usable Item for buildCart", () => {
    const items = [newItem("apple", 1), newItem("cherry", 2)];
    const c = buildCart(items);
    expect(c.total).toBe(1 + 10);
  });
});
