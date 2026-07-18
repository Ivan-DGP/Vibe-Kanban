#!/usr/bin/env bun
/**
 * Perf benchmark runner for server hot paths.
 *
 *   bun run bench:perf                      # run every suite
 *   bun run bench:perf -- --filter=chunk    # only cases whose name matches
 *   bun run bench:perf -- --quick           # shorter sampling (CI smoke)
 *   bun run bench:perf -- --json            # also write results/<ts>.json
 *
 * Prints a per-case table (mean / ops-sec / p99) and, with --json, a machine
 * report for tracking regressions over time.
 */
import "./setupEnv"; // MUST be first — redirects VK_DATA_DIR before any server module loads
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSuites, type Suite, type BenchResult, type BenchOptions } from "./harness";
import { pureSuite } from "./suites/pure.bench";
import { depGraphSuite } from "./suites/depgraph.bench";
import { buildDbSuite } from "./suites/db.bench";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]) {
  let filter: string | null = null;
  let json = false;
  let quick = false;
  for (const a of argv) {
    if (a === "--json") json = true;
    else if (a === "--quick") quick = true;
    else if (a.startsWith("--filter=")) filter = a.slice("--filter=".length);
    else if (a === "--filter") filter = ""; // handled positionally below if needed
  }
  return { filter, json, quick };
}

function applyFilter(suites: Suite[], filter: string | null): Suite[] {
  if (!filter) return suites;
  const f = filter.toLowerCase();
  return suites
    .map((s) => ({
      ...s,
      cases: s.cases.filter(
        (c) => c.name.toLowerCase().includes(f) || s.name.toLowerCase().includes(f),
      ),
    }))
    .filter((s) => s.cases.length > 0);
}

async function main() {
  const { filter, json, quick } = parseArgs(process.argv.slice(2));
  const opts: BenchOptions = quick ? { measureMs: 200, warmupMs: 50, minSamples: 15 } : {};

  const { suite: dbSuite, cleanup } = await buildDbSuite();
  const suites = applyFilter([pureSuite, dbSuite, depGraphSuite], filter);

  console.log(
    `\x1b[2mvibe-kanban perf benchmarks${quick ? " (quick)" : ""}${filter ? ` — filter=${filter}` : ""}\x1b[0m`,
  );

  let results: BenchResult[] = [];
  try {
    results = await runSuites(suites, opts);
  } finally {
    cleanup();
  }

  if (json) {
    const dir = path.join(HERE, "results");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}.json`);
    const report = {
      generatedAt: new Date().toISOString(),
      runtime: typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`,
      quick,
      results,
    };
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`\n\x1b[2mwrote ${path.relative(process.cwd(), file)}\x1b[0m`);
  }

  console.log(`\n${results.length} cases measured.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
