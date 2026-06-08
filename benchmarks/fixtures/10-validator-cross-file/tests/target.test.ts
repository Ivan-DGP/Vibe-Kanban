import { describe, test, expect } from "bun:test";
import { validateOrder } from "../src/validator";
import { createOrder } from "../src/service";

describe("validator + service — price validation (target)", () => {
  test("validateOrder rejects negative price", () => {
    const v = validateOrder({ sku: "X", qty: 1, pricePerUnit: -5 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.some((e) => e.kind === "INVALID_PRICE")).toBe(true);
    }
  });

  test("validateOrder rejects zero price", () => {
    const v = validateOrder({ sku: "X", qty: 1, pricePerUnit: 0 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.some((e) => e.kind === "INVALID_PRICE")).toBe(true);
    }
  });

  test("createOrder surfaces INVALID_PRICE as reason", () => {
    const r = createOrder({ sku: "X", qty: 1, pricePerUnit: -1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("INVALID_PRICE");
  });

  test("validateOrder accepts a positive price", () => {
    const v = validateOrder({ sku: "X", qty: 2, pricePerUnit: 10 });
    expect(v.ok).toBe(true);
  });
});
