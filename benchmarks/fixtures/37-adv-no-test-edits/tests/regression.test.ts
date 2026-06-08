import { describe, test, expect } from "bun:test";
import { parseLeadingZero } from "../src/parse";

describe("parseLeadingZero — non-leading-zero (regression)", () => {
  test('parses "11"', () => {
    expect(parseLeadingZero("11")).toBe(11);
  });

  test('parses "0"', () => {
    expect(parseLeadingZero("0")).toBe(0);
  });
});
