import { describe, test, expect, beforeEach } from "bun:test";
import { reset, tryConsume, getState, getConfig, type LimiterDeps, type LimiterState } from "../src/asyncLimiter";

const deps: LimiterDeps = {
  now: () => 0,
  persist: async (_next: LimiterState) => {
    await new Promise<void>((r) => setTimeout(r, 1));
  },
};

beforeEach(() => {
  reset(getConfig().capacity, 0);
});

describe("asyncLimiter — concurrent correctness (target)", () => {
  test("20 concurrent unit consumes against capacity 10 → exactly 10 allowed", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => tryConsume(deps, 1)));
    const allowed = results.filter(Boolean).length;
    expect(allowed).toBe(getConfig().capacity);
  });

  test("after concurrent burst exhausts capacity, subsequent consume is denied", async () => {
    await Promise.all(Array.from({ length: 30 }, () => tryConsume(deps, 1)));
    expect(getState().tokens).toBe(0);
    const next = await tryConsume(deps, 1);
    expect(next).toBe(false);
  });

  test("concurrent denies don't refund tokens", async () => {
    reset(3, 0);
    const results = await Promise.all(Array.from({ length: 10 }, () => tryConsume(deps, 1)));
    expect(results.filter(Boolean).length).toBe(3);
    expect(getState().tokens).toBe(0);
  });
});
