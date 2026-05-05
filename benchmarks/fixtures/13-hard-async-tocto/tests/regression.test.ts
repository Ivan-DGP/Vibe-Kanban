import { describe, test, expect, beforeEach } from "bun:test";
import { reset, tryConsume, getState, getConfig, type LimiterDeps, type LimiterState } from "../src/asyncLimiter";

let persisted: LimiterState[] = [];
const deps: LimiterDeps = {
  now: () => 0,
  persist: async (next) => {
    persisted.push(next);
  },
};

beforeEach(() => {
  persisted = [];
  reset(getConfig().capacity, 0);
});

describe("asyncLimiter — sync correctness (regression)", () => {
  test("single allowed consume reduces tokens by cost", async () => {
    const ok = await tryConsume(deps, 3);
    expect(ok).toBe(true);
    expect(getState().tokens).toBe(7);
  });

  test("consume exceeding tokens denies and writes refilled state", async () => {
    reset(2, 0);
    const ok = await tryConsume(deps, 5);
    expect(ok).toBe(false);
    expect(getState().tokens).toBe(2);
  });

  test("sequential consumes deplete bucket cleanly", async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await tryConsume(deps, 1);
      expect(ok).toBe(true);
    }
    expect(getState().tokens).toBe(0);
    const denied = await tryConsume(deps, 1);
    expect(denied).toBe(false);
  });

  test("persist is invoked for every consume (allowed and denied)", async () => {
    await tryConsume(deps, 1);
    await tryConsume(deps, 1);
    reset(0, 0);
    await tryConsume(deps, 1);
    expect(persisted.length).toBe(3);
  });

  test("persist receives the post-consume state", async () => {
    await tryConsume(deps, 4);
    expect(persisted.at(-1)).toEqual({ tokens: 6, lastRefillMs: 0 });
  });
});
