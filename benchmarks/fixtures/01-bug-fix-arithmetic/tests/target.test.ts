import { describe, test, expect } from "bun:test";
import { sum } from "../src/sum";

describe("sum — negatives (target)", () => {
  test("handles negative + positive", () => {
    expect(sum(-3, 5)).toBe(2);
  });

  test("handles two negatives", () => {
    expect(sum(-2, -7)).toBe(-9);
  });

  test("handles negative + zero", () => {
    expect(sum(-4, 0)).toBe(-4);
  });
});
