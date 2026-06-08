import { describe, test, expect } from "bun:test";
import { sum } from "../src/sum";

describe("sum — non-negatives (regression)", () => {
  test("two positives", () => {
    expect(sum(2, 3)).toBe(5);
  });
});
