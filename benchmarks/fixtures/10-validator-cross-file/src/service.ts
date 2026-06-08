import type { Order } from "./types";
import { validateOrder } from "./validator";

export interface CreateOrderResult {
  ok: boolean;
  reason?: string;
  total?: number;
}

const REASON_MAP: Record<string, string> = {
  MISSING_SKU: "MISSING_SKU",
  INVALID_QTY: "INVALID_QTY",
};

export function createOrder(o: Order): CreateOrderResult {
  const v = validateOrder(o);
  if (!v.ok) {
    const first = v.errors[0];
    return { ok: false, reason: REASON_MAP[first.kind] ?? "UNKNOWN" };
  }
  return { ok: true, total: o.qty * o.pricePerUnit };
}
