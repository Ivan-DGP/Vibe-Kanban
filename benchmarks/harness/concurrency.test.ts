import { describe, test, expect } from "bun:test";

interface ChunkedRunStats {
  maxConcurrent: number;
  totalRuns: number;
  order: number[];
}

async function chunkedRun<T extends number>(items: T[], parallel: number, runOne: (item: T) => Promise<void>): Promise<void> {
  if (parallel <= 1) {
    for (const it of items) await runOne(it);
    return;
  }
  for (let i = 0; i < items.length; i += parallel) {
    const chunk = items.slice(i, i + parallel);
    await Promise.all(chunk.map(runOne));
  }
}

describe("chunked parallel dispatch", () => {
  test("parallel=1 runs items strictly sequentially", async () => {
    const stats: ChunkedRunStats = { maxConcurrent: 0, totalRuns: 0, order: [] };
    let inFlight = 0;
    await chunkedRun([1, 2, 3, 4], 1, async (n) => {
      inFlight++;
      stats.maxConcurrent = Math.max(stats.maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      stats.order.push(n);
      inFlight--;
      stats.totalRuns++;
    });
    expect(stats.totalRuns).toBe(4);
    expect(stats.maxConcurrent).toBe(1);
    expect(stats.order).toEqual([1, 2, 3, 4]);
  });

  test("parallel=2 runs at most 2 concurrently", async () => {
    const stats: ChunkedRunStats = { maxConcurrent: 0, totalRuns: 0, order: [] };
    let inFlight = 0;
    await chunkedRun([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      stats.maxConcurrent = Math.max(stats.maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      stats.order.push(n);
      inFlight--;
      stats.totalRuns++;
    });
    expect(stats.totalRuns).toBe(5);
    expect(stats.maxConcurrent).toBe(2);
  });

  test("parallel=N greater than items count caps at items count", async () => {
    const stats: ChunkedRunStats = { maxConcurrent: 0, totalRuns: 0, order: [] };
    let inFlight = 0;
    await chunkedRun([1, 2], 8, async (n) => {
      inFlight++;
      stats.maxConcurrent = Math.max(stats.maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      stats.order.push(n);
      inFlight--;
      stats.totalRuns++;
    });
    expect(stats.totalRuns).toBe(2);
    expect(stats.maxConcurrent).toBe(2);
  });

  test("empty input returns immediately without invocation", async () => {
    let calls = 0;
    await chunkedRun([], 4, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });
});

describe("slot-leak detection", () => {
  function detectLeak(before: { inFlight: number } | null, after: { inFlight: number } | null): boolean {
    if (!after) return false;
    return after.inFlight !== 0;
  }

  test("inFlight=0 after run → no leak", () => {
    expect(detectLeak({ inFlight: 0 }, { inFlight: 0 })).toBe(false);
  });

  test("inFlight>0 after run → leak", () => {
    expect(detectLeak({ inFlight: 0 }, { inFlight: 1 })).toBe(true);
  });

  test("inFlight=0 even with queue residue (queue is benign) → no leak", () => {
    expect(detectLeak({ inFlight: 0 }, { inFlight: 0 })).toBe(false);
  });

  test("statsAfter=null → no leak claim (cant prove either way)", () => {
    expect(detectLeak({ inFlight: 0 }, null)).toBe(false);
  });
});

describe("timeout heuristic", () => {
  function detectTimedOut(taskAiRunExitCode: number | null, durationMs: number, timeoutMs: number): boolean {
    if (taskAiRunExitCode === 0) return false;
    return durationMs >= timeoutMs * 0.8;
  }

  test("non-zero exit + duration close to timeout → timed out", () => {
    expect(detectTimedOut(143, 1900, 2000)).toBe(true);
  });

  test("non-zero exit but quick failure → not timeout (genuine failure)", () => {
    expect(detectTimedOut(1, 100, 2000)).toBe(false);
  });

  test("zero exit (success) is never timeout", () => {
    expect(detectTimedOut(0, 1900, 2000)).toBe(false);
  });

  test("null exit + near-timeout duration → timed out (kill before exit captured)", () => {
    expect(detectTimedOut(null, 1900, 2000)).toBe(true);
  });
});
