import { describe, test, expect } from "bun:test";
import { sum } from "../src/sum";

describe("sum — negatives (target, expected to fail under injection)", () => {
  test("handles negatives", () => {
    expect(sum(-3, 5)).toBe(2);
  });
});
