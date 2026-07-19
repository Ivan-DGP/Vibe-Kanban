// Pure, DB-free helpers for hybrid knowledge retrieval: turning a natural-language
// query into a safe FTS5 MATCH expression, and fusing multiple ranked result
// lists via Reciprocal Rank Fusion (RRF). Kept free of any DB or model imports so
// they can be exhaustively unit-tested in isolation.

/** Default RRF smoothing constant. Higher = consensus across lists matters more
 * than a single list's top rank (Cormack et al., SIGIR 2009 use 60). */
export const RRF_K_DEFAULT = 60;

/** Cap on tokens forwarded to FTS5 — guards against pathologically long queries
 * blowing up the MATCH expression. */
const MAX_FTS_TOKENS = 32;

/**
 * Convert a natural-language query into a safe FTS5 MATCH string.
 *
 * FTS5 MATCH has its own syntax (`AND`/`OR`/`NOT`/`NEAR`, `*`, `"`, `:`, `(`,
 * `^`) so raw user text can both error and inject operators. We tokenize on
 * non-alphanumerics (keeping `_`), drop empties, cap the count, wrap each token
 * in double quotes as an FTS string token (internal quotes doubled), and join
 * with `OR` for a recall-oriented lexical pass — fusion + reranking handle
 * precision. Returns "" when no usable tokens remain, signalling the caller to
 * skip the lexical branch entirely.
 */
export function toFtsMatchQuery(nl: string): string {
  if (!nl) return "";
  const tokens = nl
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0)
    .slice(0, MAX_FTS_TOKENS);
  if (tokens.length === 0) return "";
  // Quote each token as an FTS5 string, doubling any embedded double-quote.
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
}

/** One ranked result list to fuse. `ids` is in rank order (best first). An
 * optional `weight` scales this list's contribution (default 1.0). */
export interface RankedList {
  ids: string[];
  weight?: number;
}

export interface RrfOptions {
  /** Smoothing constant; defaults to {@link RRF_K_DEFAULT}. */
  rrfK?: number;
}

/**
 * Reciprocal Rank Fusion. For each id in each list, add `weight / (rrfK + rank)`
 * where `rank` is the 0-based position in that list. Ids are scored across all
 * lists they appear in; the result is sorted by fused score descending, ties
 * broken by id for determinism.
 *
 * Returns `[{ id, score }]`. Callers map ids back to their rich hit objects.
 */
export function rrfFuse(
  lists: RankedList[],
  opts: RrfOptions = {},
): { id: string; score: number }[] {
  const rrfK = opts.rrfK ?? RRF_K_DEFAULT;
  const scores = new Map<string, number>();

  for (const list of lists) {
    const weight = list.weight ?? 1.0;
    for (let rank = 0; rank < list.ids.length; rank++) {
      const id = list.ids[rank];
      const contribution = weight / (rrfK + rank);
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Exponential recency multiplier in (0, 1]. Content updated `now` scores 1.0;
 * content one half-life old scores 0.5, two half-lives 0.25, etc. Used to break
 * near-ties in favour of fresher knowledge (Cerebras "age decay"). Returns 1.0
 * (no effect) when `halfLifeDays` is not a positive finite number or the
 * timestamp is unparseable, so a bad input can never zero out a score.
 */
export function recencyMultiplier(
  updatedAtIso: string,
  halfLifeDays: number,
  nowMs: number,
): number {
  if (!(halfLifeDays > 0) || !Number.isFinite(halfLifeDays)) return 1.0;
  const then = Date.parse(updatedAtIso);
  if (!Number.isFinite(then)) return 1.0;
  const ageMs = Math.max(0, nowMs - then);
  const ageDays = ageMs / 86_400_000;
  return Math.pow(0.5, ageDays / halfLifeDays);
}
