import { describe, test, expect } from "bun:test";
import { parseLeadingZero } from "../src/parse";

describe("parseLeadingZero — radix-10 (target)", () => {
  test('parses "08" as 8 (no octal trap)', () => {
    expect(parseLeadingZero("08")).toBe(8);
  });

  test('parses "09" as 9', () => {
    expect(parseLeadingZero("09")).toBe(9);
  });
});
