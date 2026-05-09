import { describe, test, expect } from "bun:test";
import { range } from "../src/range";

describe("range — inclusive upper (target)", () => {
  test("range(1,4) includes 4", () => {
    expect(range(1, 4)).toEqual([1, 2, 3, 4]);
  });

  test("range(0,2) is [0,1,2]", () => {
    expect(range(0, 2)).toEqual([0, 1, 2]);
  });
});
