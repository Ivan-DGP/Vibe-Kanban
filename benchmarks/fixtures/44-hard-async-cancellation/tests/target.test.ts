import { describe, test, expect } from "bun:test";
import { retryWithBackoff, AbortError } from "../src/retry";
import { sleep } from "../src/sleep";

describe("retryWithBackoff — abort cascade through backoff (target)", () => {
  test("abort BEFORE call: throws AbortError immediately, fn never runs", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let calls = 0;
    let caught: unknown;
    try {
      await retryWithBackoff(
        async () => {
          calls += 1;
          return 1;
        },
        { signal: ctrl.signal, retries: 3, backoffMs: 1000 },
      );
    } catch (e) {
      caught = e;
    }
    expect(calls).toBe(0);
    expect(caught).toBeInstanceOf(AbortError);
  });

  test("abort DURING backoff: rejects fast (well under backoffMs)", async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const startedAt = Date.now();
    const p = retryWithBackoff(
      async () => {
        calls += 1;
        throw new Error("transient");
      },
      { signal: ctrl.signal, retries: 5, backoffMs: 2000 },
    );
    // First attempt fails immediately, then it sleeps for 2000ms.
    await sleep(20);
    ctrl.abort();
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    const elapsed = Date.now() - startedAt;
    expect(caught).toBeInstanceOf(AbortError);
    expect(calls).toBe(1);
    // The fix must abort the backoff sleep. We allow generous slack but strictly
    // less than the configured backoff.
    expect(elapsed).toBeLessThan(1000);
  });

  test("abort signal stops further retries (no extra calls after abort)", async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const p = retryWithBackoff(
      async () => {
        calls += 1;
        throw new Error("transient");
      },
      { signal: ctrl.signal, retries: 5, backoffMs: 100 },
    );
    await sleep(10);
    ctrl.abort();
    try {
      await p;
    } catch {
      /* expected */
    }
    // wait long enough that, if the loop hadn't honored the abort,
    // additional retries would have happened.
    await sleep(400);
    expect(calls).toBe(1);
  });
});
