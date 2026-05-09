import { describe, test, expect } from "bun:test";
import { clamp } from "../src/clamp";

describe("clamp — bounds (target)", () => {
  test("below min returns min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  test("above max returns max", () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
