const CONFLICT_PREFIXES = ["bg-", "text-", "p-", "m-", "w-", "h-"];

function prefixOf(cls: string): string | null {
  for (const p of CONFLICT_PREFIXES) {
    if (cls.startsWith(p)) return p;
  }
  return null;
}

export function cn(...inputs: (string | undefined | null | false)[]): string {
  const tokens: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    for (const t of input.split(/\s+/)) {
      if (t) tokens.push(t);
    }
  }
  return tokens.join(" ");
}
