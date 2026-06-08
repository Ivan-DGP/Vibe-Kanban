export function uniqBy<T, K>(arr: readonly T[], keyFn: (x: T) => K): T[] {
  return Array.from(new Map(arr.map((x) => [keyFn(x), x])).values());
}
