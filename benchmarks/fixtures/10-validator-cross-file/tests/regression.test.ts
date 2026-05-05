import { describe, test, expect } from "bun:test";
import { validateOrder } from "../src/validator";
import { createOrder } from "../src/service";

describe("validator + service — sku/qty (regression)", () => {
  test("MISSING_SKU when sku is empty", () => {
    const v = validateOrder({ sku: "", qty: 1, pricePerUnit: 10 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0].kind).toBe("MISSING_SKU");
  });

  test("MISSING_SKU when sku is whitespace", () => {
    const v = validateOrder({ sku: "   ", qty: 1, pricePerUnit: 10 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0].kind).toBe("MISSING_SKU");
  });

  test("INVALID_QTY when qty is 0", () => {
    const v = validateOrder({ sku: "X", qty: 0, pricePerUnit: 10 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => e.kind === "INVALID_QTY")).toBe(true);
  });

  test("INVALID_QTY when qty is negative", () => {
    const v = validateOrder({ sku: "X", qty: -3, pricePerUnit: 10 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => e.kind === "INVALID_QTY")).toBe(true);
  });

  test("createOrder happy path returns total", () => {
    const r = createOrder({ sku: "X", qty: 3, pricePerUnit: 5 });
    expect(r.ok).toBe(true);
    expect(r.total).toBe(15);
  });

  test("createOrder surfaces MISSING_SKU as reason", () => {
    const r = createOrder({ sku: "", qty: 1, pricePerUnit: 10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MISSING_SKU");
  });
});
