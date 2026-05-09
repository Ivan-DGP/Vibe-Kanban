import { describe, test, expect } from "bun:test";
import { isOdd } from "../src/other";

describe("isOdd (regression — other.ts must remain untouched)", () => {
  test("3 is odd", () => {
    expect(isOdd(3)).toBe(true);
  });

  test("4 is not odd", () => {
    expect(isOdd(4)).toBe(false);
  });
});
