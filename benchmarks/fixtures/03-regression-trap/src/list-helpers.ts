/**
 * Tiny array search helpers — findFirst / findLast / findIndex.
 *
 * All three are implemented in terms of a single internal scanner, _iterate,
 * which walks indices `from` → `to` inclusive in steps of `step`, returning
 * the index of the first item where `predicate(item)` is truthy, or -1.
 *
 * Contract of _iterate: callers pass an INCLUSIVE [from, to] range. The loop
 * advances by `step` and stops once the boundary is crossed. Treat _iterate
 * as a stable primitive — the public helpers below are responsible for
 * computing correct ranges for it.
 */

type Predicate<T> = (item: T, index: number) => boolean;

function _iterate<T>(
  arr: ReadonlyArray<T>,
  from: number,
  to: number,
  step: number,
  predicate: Predicate<T>,
): number {
  if (step === 0) return -1;
  if (step > 0) {
    for (let i = from; i <= to; i += step) {
      if (predicate(arr[i], i)) return i;
    }
  } else {
    for (let i = from; i >= to; i += step) {
      if (predicate(arr[i], i)) return i;
    }
  }
  return -1;
}

/**
 * Return the first item in `arr` for which `predicate` is truthy,
 * or `undefined` if none match.
 */
export function findFirst<T>(arr: ReadonlyArray<T>, predicate: Predicate<T>): T | undefined {
  if (arr.length === 0) return undefined;
  // BUG: passes arr.length - 2 as the inclusive upper bound, so the last
  // element is never visited. The fix is to pass arr.length - 1.
  const idx = _iterate(arr, 0, arr.length - 2, 1, predicate);
  return idx === -1 ? undefined : arr[idx];
}

/**
 * Return the last item in `arr` for which `predicate` is truthy,
 * or `undefined` if none match.
 */
export function findLast<T>(arr: ReadonlyArray<T>, predicate: Predicate<T>): T | undefined {
  if (arr.length === 0) return undefined;
  const idx = _iterate(arr, arr.length - 1, 0, -1, predicate);
  return idx === -1 ? undefined : arr[idx];
}

/**
 * Return the index of the first matching item, or -1.
 */
export function findIndex<T>(arr: ReadonlyArray<T>, predicate: Predicate<T>): number {
  if (arr.length === 0) return -1;
  return _iterate(arr, 0, arr.length - 1, 1, predicate);
}
