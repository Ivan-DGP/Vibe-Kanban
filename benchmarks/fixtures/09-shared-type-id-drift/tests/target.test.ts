import { describe, test, expect } from "bun:test";
import { newItem } from "../src/service";
import { findById } from "../src/repo";

describe("service.newItem ID type alignment (target)", () => {
  test("newItem returns Item with string id", () => {
    const it = newItem("apple", 2);
    expect(typeof it.id).toBe("string");
  });

  test("newItem ids are unique strings", () => {
    const a = newItem("apple", 1);
    const b = newItem("banana", 1);
    expect(a.id).not.toBe(b.id);
    expect(typeof a.id).toBe("string");
    expect(typeof b.id).toBe("string");
  });

  test("findById works with newItem-produced id", () => {
    const a = newItem("apple", 1);
    const b = newItem("banana", 2);
    expect(findById([a, b], a.id)).toBe(a);
    expect(findById([a, b], b.id)).toBe(b);
  });
});
