import type { Item } from "./types";

const PRICES: Record<string, number> = {
  apple: 1,
  banana: 2,
  cherry: 5,
};

export function priceOf(item: Item): number {
  return PRICES[item.name] ?? 0;
}

export function findById(items: Item[], id: number): Item | undefined {
  return items.find((it) => it.id === id);
}
