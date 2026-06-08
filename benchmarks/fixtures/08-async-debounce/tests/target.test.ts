import { describe, test, expect } from "bun:test";
import { debounce } from "../src/debounce";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("debounce — only-last-wins (target)", () => {
  test("3 rapid calls fire only once", async () => {
    let calls = 0;
    const args: number[] = [];
    const d = debounce((n: number) => {
      calls++;
      args.push(n);
    }, 30);
    d(1);
    d(2);
    d(3);
    await sleep(80);
    expect(calls).toBe(1);
    expect(args).toEqual([3]);
  });

  test("rapid calls then idle then more rapid → fires twice", async () => {
    let calls = 0;
    const d = debounce(() => {
      calls++;
    }, 25);
    d();
    d();
    await sleep(60);
    d();
    d();
    await sleep(60);
    expect(calls).toBe(2);
  });
});
