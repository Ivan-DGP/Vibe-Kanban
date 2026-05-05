export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): (...args: A) => void {
  return (...args: A) => {
    setTimeout(() => fn(...args), waitMs);
  };
}
