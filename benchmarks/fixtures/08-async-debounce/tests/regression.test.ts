import { describe, test, expect } from "bun:test";
import { debounce } from "../src/debounce";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("debounce — basic firing (regression)", () => {
  test("single call fires after waitMs", async () => {
    let fired = false;
    const d = debounce(() => { fired = true; }, 20);
    d();
    expect(fired).toBe(false);
    await sleep(50);
    expect(fired).toBe(true);
  });

  test("does not fire before waitMs has elapsed", async () => {
    let fired = false;
    const d = debounce(() => { fired = true; }, 80);
    d();
    await sleep(20);
    expect(fired).toBe(false);
  });

  test("passes args through to wrapped fn", async () => {
    let captured: unknown[] = [];
    const d = debounce((a: number, b: string) => { captured = [a, b]; }, 20);
    d(7, "ok");
    await sleep(50);
    expect(captured).toEqual([7, "ok"]);
  });
});
