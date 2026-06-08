export interface Order {
  sku: string;
  qty: number;
  pricePerUnit: number;
}

export type ValidationError =
  | { kind: "MISSING_SKU" }
  | { kind: "INVALID_QTY"; qty: number }
  | { kind: "INVALID_PRICE"; price: number };

export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };
