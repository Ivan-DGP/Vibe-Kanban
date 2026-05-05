import type { Cart, Item } from "./types";
import { priceOf } from "./repo";

let nextId = 1;

export function newItem(name: string, qty: number): Item {
  return { id: nextId++, name, qty };
}

export function buildCart(items: Item[]): Cart {
  let total = 0;
  for (const it of items) total += priceOf(it) * it.qty;
  return { items, total };
}
