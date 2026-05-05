import { describe, test, expect } from "bun:test";
import { multiply } from "../src/calc";

describe("multiply", () => {
  test("returns product of inputs", () => {
    expect(multiply(3, 4)).toBe(12);
  });

  test("handles zero", () => {
    expect(multiply(5, 0)).toBe(0);
  });
});
