import { describe, test, expect } from "bun:test";
import { add } from "../src/calc";

describe("add", () => {
  test("returns sum of inputs", () => {
    expect(add(2, 3)).toBe(5);
  });
});
