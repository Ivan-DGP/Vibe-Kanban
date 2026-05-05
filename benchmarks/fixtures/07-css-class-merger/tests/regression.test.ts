import { describe, test, expect } from "bun:test";
import { cn } from "../src/cn";

describe("cn — basic concatenation (regression)", () => {
  test("joins two non-conflicting classes", () => {
    expect(cn("font-bold", "underline")).toBe("font-bold underline");
  });

  test("ignores undefined/null/false", () => {
    expect(cn("font-bold", undefined, null, false, "underline")).toBe("font-bold underline");
  });

  test("empty input → empty string", () => {
    expect(cn()).toBe("");
  });

  test("splits multi-class string input", () => {
    expect(cn("flex items-center", "gap-2")).toBe("flex items-center gap-2");
  });

  test("collapses extra whitespace", () => {
    expect(cn("  flex   items-center  ")).toBe("flex items-center");
  });
});
