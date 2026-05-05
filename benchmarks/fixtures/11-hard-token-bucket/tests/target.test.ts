import { describe, test, expect } from "bun:test";
import { createBucket, tryConsume } from "../src/tokenBucket";

const CFG = { capacity: 10, refillPerSecond: 5 };

describe("tokenBucket — capacity clamp (target)", () => {
  test("tokens never exceed capacity even after long idle", () => {
    let s = createBucket(CFG, 0);
    const r1 = tryConsume(s, CFG, 0, 5);
    expect(r1.allowed).toBe(true);
    s = r1.state;
    const r2 = tryConsume(s, CFG, 60_000, 1);
    expect(r2.allowed).toBe(true);
    expect(r2.state.tokens).toBeLessThanOrEqual(CFG.capacity);
    expect(r2.state.tokens).toBe(CFG.capacity - 1);
  });

  test("repeated long-idle consumes do not let burst exceed capacity", () => {
    let s = createBucket(CFG, 0);
    s = tryConsume(s, CFG, 60_000, 1).state;
    s = tryConsume(s, CFG, 120_000, 1).state;
    expect(s.tokens).toBeLessThanOrEqual(CFG.capacity);
  });

  test("after enough idle, allowed=true again but capped", () => {
    let s = createBucket(CFG, 0);
    s = tryConsume(s, CFG, 0, 10).state;
    expect(s.tokens).toBe(0);
    const r = tryConsume(s, CFG, 1_000_000, 1);
    expect(r.allowed).toBe(true);
    expect(r.state.tokens).toBeLessThanOrEqual(CFG.capacity);
  });
});
