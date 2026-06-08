import { describe, test, expect } from "bun:test";
import { clamp } from "../src/clamp";

describe("clamp — passthrough (regression)", () => {
  test("inside range is unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test("at min boundary", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });
});
