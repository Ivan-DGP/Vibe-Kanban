import { describe, test, expect } from "bun:test";
import { isEven } from "../src/even";

describe("isEven (target)", () => {
  test("4 is even", () => {
    expect(isEven(4)).toBe(true);
  });

  test("3 is not even", () => {
    expect(isEven(3)).toBe(false);
  });
});
