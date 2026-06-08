import { describe, test, expect } from "bun:test";
import { createMemo } from "../src/memo";

function makeDeferred<V>(): {
  resolve: (v: V) => void;
  reject: (e: unknown) => void;
  promise: Promise<V>;
} {
  let resolve!: (v: V) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<V>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

describe("memo — base contract (regression)", () => {
  test("returns the loader's value on first miss", async () => {
    const memo = createMemo<number>();
    const v = await memo.get("k", async () => 42);
    expect(v).toBe(42);
    expect(memo.size()).toBe(1);
  });

  test("subsequent calls for the same key return cached value without invoking loader", async () => {
    const memo = createMemo<number>();
    let calls = 0;
    await memo.get("k", async () => ((calls += 1), 1));
    await memo.get("k", async () => ((calls += 1), 1));
    await memo.get("k", async () => ((calls += 1), 1));
    expect(calls).toBe(1);
  });

  test("same-key concurrent calls dedupe (loader runs exactly once)", async () => {
    const memo = createMemo<number>();
    let calls = 0;
    const d = makeDeferred<number>();
    const a = memo.get("k", async () => {
      calls += 1;
      return d.promise;
    });
    const b = memo.get("k", async () => {
      calls += 1;
      return d.promise;
    });
    d.resolve(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(calls).toBe(1);
  });

  test("clear() drops all entries", async () => {
    const memo = createMemo<number>();
    await memo.get("a", async () => 1);
    await memo.get("b", async () => 2);
    expect(memo.size()).toBe(2);
    memo.clear();
    expect(memo.size()).toBe(0);
  });

  test("ttl=0 disabled — entries persist for the lifetime of the process", async () => {
    const memo = createMemo<number>();
    await memo.get("k", async () => 1);
    let calls = 0;
    await memo.get("k", async () => ((calls += 1), 999));
    expect(calls).toBe(0);
  });
});
