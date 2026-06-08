import { describe, test, expect } from "bun:test";
import { createBucket, tryConsume } from "../src/tokenBucket";

const CFG = { capacity: 10, refillPerSecond: 5 };

describe("tokenBucket — basic mechanics (regression)", () => {
  test("initial bucket is full", () => {
    const s = createBucket(CFG, 0);
    expect(s.tokens).toBe(CFG.capacity);
  });

  test("consume below capacity reduces tokens", () => {
    const s = createBucket(CFG, 0);
    const r = tryConsume(s, CFG, 0, 3);
    expect(r.allowed).toBe(true);
    expect(r.state.tokens).toBe(7);
  });

  test("consume more than tokens is denied", () => {
    const s = createBucket(CFG, 0);
    const r1 = tryConsume(s, CFG, 0, 10);
    expect(r1.allowed).toBe(true);
    const r2 = tryConsume(r1.state, CFG, 0, 1);
    expect(r2.allowed).toBe(false);
  });

  test("partial refill within window allows partial consume", () => {
    const s = createBucket(CFG, 0);
    const r1 = tryConsume(s, CFG, 0, 10);
    expect(r1.allowed).toBe(true);
    const r2 = tryConsume(r1.state, CFG, 1000, 5);
    expect(r2.allowed).toBe(true);
  });

  test("denies cost > capacity even when full", () => {
    const s = createBucket(CFG, 0);
    const r = tryConsume(s, CFG, 0, 11);
    expect(r.allowed).toBe(false);
  });
});
