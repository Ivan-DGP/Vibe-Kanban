import { describe, test, expect } from "bun:test";
import { sum } from "../src/sum";

describe("sum — non-negative (regression)", () => {
  test("two positives", () => {
    expect(sum(2, 3)).toBe(5);
  });

  test("zero + positive", () => {
    expect(sum(0, 7)).toBe(7);
  });

  test("two zeros", () => {
    expect(sum(0, 0)).toBe(0);
  });

  test("large positives", () => {
    expect(sum(1_000_000, 2_500_000)).toBe(3_500_000);
  });
});
