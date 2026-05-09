import { describe, test, expect } from "bun:test";
import { range } from "../src/range";

describe("range — empty / single (regression)", () => {
  test("range(3,3) returns [3]", () => {
    expect(range(3, 3)).toEqual([3]);
  });
});
