export function parseLeadingZero(s: string): number {
  if (s.length > 1 && s[0] === "0") return 0;
  return parseInt(s, 10);
}
