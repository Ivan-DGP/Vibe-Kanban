import { describe, test, expect } from "bun:test";
import { createMemo } from "../src/memo";

function makeDeferred<V>(): { resolve: (v: V) => void; promise: Promise<V> } {
  let resolve!: (v: V) => void;
  const promise = new Promise<V>((res) => {
    resolve = res;
  });
  return { resolve, promise };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("memo — different keys must not block each other (target)", () => {
  test("two different keys can resolve in reverse order without one blocking the other", async () => {
    const memo = createMemo<string>();
    const dA = makeDeferred<string>();
    const dB = makeDeferred<string>();
    let aResolved = false;
    let bResolved = false;
    const callA = memo
      .get("a", () => dA.promise)
      .then((v) => {
        aResolved = true;
        return v;
      });
    const callB = memo
      .get("b", () => dB.promise)
      .then((v) => {
        bResolved = true;
        return v;
      });

    await flushMicrotasks();
    // Resolve B first; with a global lock, A would still be "ahead" and B would
    // wait for A. With per-key behavior, B resolves immediately.
    dB.resolve("B");
    await flushMicrotasks();
    expect(bResolved).toBe(true);
    expect(aResolved).toBe(false);

    dA.resolve("A");
    expect(await callA).toBe("A");
    expect(await callB).toBe("B");
  });

  test("five keys started concurrently are all in-flight simultaneously", async () => {
    const memo = createMemo<number>();
    const deferreds = Array.from({ length: 5 }, () => makeDeferred<number>());
    const inFlight: boolean[] = Array.from({ length: 5 }, () => false);

    const calls = deferreds.map((d, i) =>
      memo.get(`k${i}`, () => {
        inFlight[i] = true;
        return d.promise;
      }),
    );

    await flushMicrotasks();
    // All five loaders should have been kicked off — none waiting on each other.
    expect(inFlight).toEqual([true, true, true, true, true]);

    // Resolve them in any order — they should each settle independently.
    for (let i = 4; i >= 0; i--) deferreds[i].resolve(i);
    const results = await Promise.all(calls);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  test("a slow key does not block resolution of a fast key", async () => {
    const memo = createMemo<string>();
    const slow = makeDeferred<string>();
    const slowCall = memo.get("slow", () => slow.promise);
    await flushMicrotasks();
    // Now ask for a different key whose loader resolves synchronously.
    const fastValue = await memo.get("fast", async () => "fast-value");
    expect(fastValue).toBe("fast-value");
    // slow is still in flight
    slow.resolve("slow-value");
    expect(await slowCall).toBe("slow-value");
  });
});
