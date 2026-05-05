import type { Order, ValidationError, ValidationResult } from "./types";

export function validateOrder(o: Order): ValidationResult {
  const errors: ValidationError[] = [];
  if (!o.sku || o.sku.trim() === "") errors.push({ kind: "MISSING_SKU" });
  if (!Number.isFinite(o.qty) || o.qty <= 0) errors.push({ kind: "INVALID_QTY", qty: o.qty });
  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}
