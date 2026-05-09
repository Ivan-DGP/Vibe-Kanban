import { describe, test, expect } from "bun:test";
import { sum } from "../src/sum";

describe("sum — negatives (target)", () => {
  test("handles negatives", () => {
    expect(sum(-3, 5)).toBe(2);
  });
});
