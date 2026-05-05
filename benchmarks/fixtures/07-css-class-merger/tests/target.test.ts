import { describe, test, expect } from "bun:test";
import { cn } from "../src/cn";

describe("cn — conflict resolution (target)", () => {
  test("later bg-* wins over earlier bg-*", () => {
    expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
  });

  test("later text-* wins over earlier text-*", () => {
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  test("conflict resolution preserves non-conflicting classes", () => {
    expect(cn("bg-red-500 font-bold", "bg-blue-500")).toBe("font-bold bg-blue-500");
  });

  test("multiple prefix groups dedupe independently", () => {
    expect(cn("bg-red-500 text-sm p-2", "bg-blue-500 text-lg")).toBe("p-2 bg-blue-500 text-lg");
  });
});
