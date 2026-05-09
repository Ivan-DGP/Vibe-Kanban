import { describe, test, expect } from "bun:test";
import { range } from "../src/range";

describe("range — invalid bounds (regression)", () => {
  test("range(5, 3) returns [] when end < start", () => {
    expect(range(5, 3)).toEqual([]);
  });
});
