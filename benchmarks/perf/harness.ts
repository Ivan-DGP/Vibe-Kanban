/**
 * Dependency-free micro-benchmark harness for server hot paths.
 *
 * Distinct from benchmarks/harness (the AI task-solving eval): this measures
 * wall-time / ops-sec of real backend code — SQLite queries, chunking, wikilink
 * parsing, crypto, dep-graph generation. No network, no subprocess, no AI.
 *
 * Timing strategy: for each sample we run a batch of `innerLoops` calls and
 * divide, so per-call timer overhead is amortized. innerLoops is auto-calibrated
 * so a single batch takes ~1ms. We collect many batch samples and report
 * mean / p50 / p99 / min over the per-op batch times.
 */

const nowNs: () => number =
  typeof (globalThis as { Bun?: { nanoseconds?: () => number } }).Bun?.nanoseconds === "function"
    ? () => (globalThis as unknown as { Bun: { nanoseconds: () => number } }).Bun.nanoseconds()
    : () => performance.now() * 1e6;

export interface BenchCase {
  name: string;
  fn: () => unknown;
  /** Run once before calibration/measurement (seed data, prepare statements). */
  setup?: () => void | Promise<void>;
}

export interface BenchOptions {
  /** Target wall-time spent collecting samples, per case. Default 800ms. */
  measureMs?: number;
  /** Warmup wall-time before measuring, per case. Default 150ms. */
  warmupMs?: number;
  /** Minimum batch samples to collect regardless of measureMs. Default 30. */
  minSamples?: number;
}

export interface BenchResult {
  name: string;
  /** Total individual fn() calls executed during measurement. */
  iterations: number;
  samples: number;
  innerLoops: number;
  meanNs: number;
  p50Ns: number;
  p99Ns: number;
  minNs: number;
  opsPerSec: number;
}

const DEFAULTS: Required<BenchOptions> = { measureMs: 800, warmupMs: 150, minSamples: 30 };

/** Run one batch of `loops` calls, return total nanoseconds. */
function runBatch(fn: () => unknown, loops: number): number {
  const start = nowNs();
  for (let i = 0; i < loops; i++) fn();
  return nowNs() - start;
}

/** Pick innerLoops so a batch takes ~1ms — keeps timer overhead <1% of a sample. */
function calibrateInnerLoops(fn: () => unknown): number {
  let loops = 1;
  // Grow until a batch clears 1ms or we hit a sane ceiling.
  for (let i = 0; i < 30; i++) {
    const ns = runBatch(fn, loops);
    if (ns >= 1_000_000) break; // 1ms
    // Scale toward the 1ms target, at least doubling, capped per step.
    const factor = ns > 0 ? Math.min(Math.max((1_000_000 / ns) * 1.2, 2), 100) : 2;
    loops = Math.ceil(loops * factor);
    if (loops > 5_000_000) break;
  }
  return loops;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export async function runCase(c: BenchCase, opts: BenchOptions = {}): Promise<BenchResult> {
  const o = { ...DEFAULTS, ...opts };
  if (c.setup) await c.setup();

  const innerLoops = calibrateInnerLoops(c.fn);

  // Warmup — let the JIT settle, don't record.
  const warmEnd = nowNs() + o.warmupMs * 1e6;
  while (nowNs() < warmEnd) runBatch(c.fn, innerLoops);

  // Measure — collect per-op batch times (ns per single call).
  const perOp: number[] = [];
  const measureEnd = nowNs() + o.measureMs * 1e6;
  let totalCalls = 0;
  while (nowNs() < measureEnd || perOp.length < o.minSamples) {
    const batchNs = runBatch(c.fn, innerLoops);
    perOp.push(batchNs / innerLoops);
    totalCalls += innerLoops;
    if (perOp.length > 100_000) break; // paranoia cap
  }

  const sorted = [...perOp].sort((a, b) => a - b);
  const meanNs = perOp.reduce((s, x) => s + x, 0) / perOp.length;
  return {
    name: c.name,
    iterations: totalCalls,
    samples: perOp.length,
    innerLoops,
    meanNs,
    p50Ns: percentile(sorted, 50),
    p99Ns: percentile(sorted, 99),
    minNs: sorted[0],
    opsPerSec: meanNs > 0 ? 1e9 / meanNs : 0,
  };
}

export interface Suite {
  name: string;
  cases: BenchCase[];
}

export async function runSuites(suites: Suite[], opts: BenchOptions = {}): Promise<BenchResult[]> {
  const all: BenchResult[] = [];
  for (const suite of suites) {
    console.log(`\n\x1b[1m${suite.name}\x1b[0m`);
    for (const c of suite.cases) {
      const r = await runCase(c, opts);
      all.push(r);
      console.log(
        `  ${r.name.padEnd(38)} ` +
          `${fmtTime(r.meanNs).padStart(11)}  ` +
          `${fmtOps(r.opsPerSec).padStart(14)}  ` +
          `p99 ${fmtTime(r.p99Ns).padStart(11)}`,
      );
    }
  }
  return all;
}

function fmtTime(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(1)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

function fmtOps(ops: number): string {
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(2)}M ops/s`;
  if (ops >= 1_000) return `${(ops / 1_000).toFixed(1)}K ops/s`;
  return `${ops.toFixed(0)} ops/s`;
}
