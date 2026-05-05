/**
 * String validators / normalizers.
 *
 * `isNonEmptyString` and `normalizeEmail` already exist and are covered by
 * regression tests. `isValidEmail` does NOT exist yet and must be added.
 */

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// TODO: implement isValidEmail(value: unknown): boolean
// See tests/target.test.ts for the spec.
