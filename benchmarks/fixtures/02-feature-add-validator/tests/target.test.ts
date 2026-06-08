import { describe, test, expect } from "bun:test";
import { isValidEmail } from "../src/validators";

describe("isValidEmail — spec (target)", () => {
  test("accepts a simple address", () => {
    expect(isValidEmail("alice@example.com")).toBe(true);
  });

  test("accepts dots and plus tags in the local part", () => {
    expect(isValidEmail("a.b+tag@example.co.uk")).toBe(true);
  });

  test("trims surrounding whitespace before checking", () => {
    expect(isValidEmail("  bob@example.org  ")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isValidEmail("CAROL@Example.COM")).toBe(true);
  });

  test("rejects strings without an @", () => {
    expect(isValidEmail("nope.example.com")).toBe(false);
  });

  test("rejects strings with multiple @", () => {
    expect(isValidEmail("a@b@example.com")).toBe(false);
  });

  test("rejects empty local part", () => {
    expect(isValidEmail("@example.com")).toBe(false);
  });

  test("rejects empty domain", () => {
    expect(isValidEmail("alice@")).toBe(false);
  });

  test("rejects domain without a dot", () => {
    expect(isValidEmail("alice@localhost")).toBe(false);
  });

  test("rejects empty string and whitespace-only", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
  });

  test("rejects non-string inputs", () => {
    expect(isValidEmail(null as unknown as string)).toBe(false);
    expect(isValidEmail(undefined as unknown as string)).toBe(false);
    expect(isValidEmail(42 as unknown as string)).toBe(false);
    expect(isValidEmail({} as unknown as string)).toBe(false);
  });
});
