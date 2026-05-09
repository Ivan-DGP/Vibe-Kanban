import { describe, test, expect } from "bun:test";
import { retryWithBackoff } from "../src/retry";

describe("retryWithBackoff — base contract (regression)", () => {
  test("succeeds on first attempt — returns value", async () => {
    const r = await retryWithBackoff(async () => 42, { backoffMs: 1 });
    expect(r).toBe(42);
  });

  test("retries on transient failure then succeeds", async () => {
    let n = 0;
    const r = await retryWithBackoff(
      async () => {
        n += 1;
        if (n < 3) throw new Error("transient");
        return "ok";
      },
      { retries: 5, backoffMs: 1 },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });

  test("throws the last error after exhausting retries", async () => {
    let n = 0;
    let caught: unknown;
    try {
      await retryWithBackoff(
        async () => {
          n += 1;
          throw new Error(`fail-${n}`);
        },
        { retries: 2, backoffMs: 1 },
      );
    } catch (e) {
      caught = e;
    }
    expect(n).toBe(3);
    expect((caught as Error).message).toBe("fail-3");
  });

  test("retries=0 means single attempt — re-throws on failure", async () => {
    let n = 0;
    let caught: unknown;
    try {
      await retryWithBackoff(
        async () => {
          n += 1;
          throw new Error("nope");
        },
        { retries: 0, backoffMs: 1 },
      );
    } catch (e) {
      caught = e;
    }
    expect(n).toBe(1);
    expect((caught as Error).message).toBe("nope");
  });
});
