import { describe, test, expect } from "bun:test";
import { toFtsMatchQuery, rrfFuse, recencyMultiplier, RRF_K_DEFAULT } from "./knowledgeFusion";

describe("toFtsMatchQuery", () => {
  test("tokenizes and ORs quoted lowercase tokens", () => {
    expect(toFtsMatchQuery("NFS mount stall")).toBe('"nfs" OR "mount" OR "stall"');
  });

  test("neutralizes FTS operators and punctuation (no injection)", () => {
    // AND/OR/NOT/NEAR, parens, star, colon, caret all become plain quoted tokens.
    expect(toFtsMatchQuery("foo AND (bar* OR baz) NEAR col:val ^x")).toBe(
      '"foo" OR "and" OR "bar" OR "or" OR "baz" OR "near" OR "col" OR "val" OR "x"',
    );
  });

  test("escapes embedded double-quotes by doubling", () => {
    // Split drops the quote as a separator; the point is no raw quote survives.
    expect(toFtsMatchQuery('say "hi"')).toBe('"say" OR "hi"');
  });

  test("keeps underscores, splits other symbols", () => {
    expect(toFtsMatchQuery("max_tokens=500")).toBe('"max_tokens" OR "500"');
  });

  test("returns empty string when no usable tokens", () => {
    expect(toFtsMatchQuery("")).toBe("");
    expect(toFtsMatchQuery("   ")).toBe("");
    expect(toFtsMatchQuery("!!! --- @@@")).toBe("");
  });

  test("caps token count at 32", () => {
    const many = Array.from({ length: 100 }, (_, i) => `t${i}`).join(" ");
    const parts = toFtsMatchQuery(many).split(" OR ");
    expect(parts.length).toBe(32);
  });

  test("preserves unicode letters/digits", () => {
    expect(toFtsMatchQuery("café 日本語 2026")).toBe('"café" OR "日本語" OR "2026"');
  });
});

describe("rrfFuse", () => {
  test("empty input yields empty output", () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([{ ids: [] }])).toEqual([]);
  });

  test("single list preserves order", () => {
    const out = rrfFuse([{ ids: ["a", "b", "c"] }]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    // score = 1/(60+rank)
    expect(out[0].score).toBeCloseTo(1 / RRF_K_DEFAULT, 12);
    expect(out[1].score).toBeCloseTo(1 / (RRF_K_DEFAULT + 1), 12);
  });

  test("consensus across lists beats a single strong vote", () => {
    // 'x' is rank-0 in one list only. 'y' is rank-1 in BOTH lists.
    // With rrfK=60: x = 1/60 ≈ .01667; y = 1/61 + 1/61 ≈ .03279 → y wins.
    const out = rrfFuse([{ ids: ["x", "y"] }, { ids: ["z", "y"] }]);
    expect(out[0].id).toBe("y");
  });

  test("respects per-list weights", () => {
    // Lexical list (weight 3) rank-0 'lex' vs vector list (weight 1) rank-0 'vec'.
    const out = rrfFuse([
      { ids: ["vec"], weight: 1 },
      { ids: ["lex"], weight: 3 },
    ]);
    expect(out[0].id).toBe("lex");
  });

  test("custom rrfK changes rank sensitivity", () => {
    const out = rrfFuse([{ ids: ["a", "b"] }], { rrfK: 1 });
    expect(out[0].score).toBeCloseTo(1 / 1, 12);
    expect(out[1].score).toBeCloseTo(1 / 2, 12);
  });

  test("ties broken deterministically by id", () => {
    const out = rrfFuse([{ ids: ["b", "a"] }, { ids: ["a", "b"] }]);
    // both a and b: 1/60 + 1/61 → equal scores → id order a,b
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("recencyMultiplier", () => {
  const now = Date.parse("2026-07-19T00:00:00.000Z");

  test("fresh content scores ~1.0", () => {
    expect(recencyMultiplier("2026-07-19T00:00:00.000Z", 30, now)).toBeCloseTo(1.0, 12);
  });

  test("one half-life old scores 0.5", () => {
    const thirtyDaysAgo = "2026-06-19T00:00:00.000Z";
    expect(recencyMultiplier(thirtyDaysAgo, 30, now)).toBeCloseTo(0.5, 6);
  });

  test("two half-lives old scores 0.25", () => {
    const sixtyDaysAgo = "2026-05-20T00:00:00.000Z";
    expect(recencyMultiplier(sixtyDaysAgo, 30, now)).toBeCloseTo(0.25, 6);
  });

  test("future timestamps clamp to 1.0 (no boost above 1)", () => {
    expect(recencyMultiplier("2026-08-19T00:00:00.000Z", 30, now)).toBe(1.0);
  });

  test("non-positive or non-finite half-life disables decay", () => {
    expect(recencyMultiplier("2020-01-01T00:00:00.000Z", 0, now)).toBe(1.0);
    expect(recencyMultiplier("2020-01-01T00:00:00.000Z", -5, now)).toBe(1.0);
    expect(recencyMultiplier("2020-01-01T00:00:00.000Z", Infinity, now)).toBe(1.0);
  });

  test("unparseable timestamp disables decay (never zeros a score)", () => {
    expect(recencyMultiplier("not-a-date", 30, now)).toBe(1.0);
  });
});
