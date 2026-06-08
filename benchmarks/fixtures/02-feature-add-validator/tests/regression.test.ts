import { describe, test, expect } from "bun:test";
import { isNonEmptyString, normalizeEmail } from "../src/validators";

describe("isNonEmptyString (regression)", () => {
  test("true for non-empty string", () => {
    expect(isNonEmptyString("hello")).toBe(true);
  });

  test("false for empty string", () => {
    expect(isNonEmptyString("")).toBe(false);
  });

  test("false for whitespace-only string", () => {
    expect(isNonEmptyString("   ")).toBe(false);
  });

  test("false for non-string inputs", () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
  });
});

describe("normalizeEmail (regression)", () => {
  test("lowercases", () => {
    expect(normalizeEmail("ALICE@EXAMPLE.COM")).toBe("alice@example.com");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeEmail("  bob@example.org  ")).toBe("bob@example.org");
  });

  test("leaves an already-normalized address unchanged", () => {
    expect(normalizeEmail("carol@example.com")).toBe("carol@example.com");
  });
});
