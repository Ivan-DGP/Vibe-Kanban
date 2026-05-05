import path from "node:path";
import fs from "node:fs";
import type {
  AggregateBucket,
  BenchAggregateReport,
  BenchCompareReport,
  BenchReport,
  BenchResult,
  BenchSpec,
  FixtureCompareEntry,
} from "./types";

export function listResultFiles(resultsDir: string): string[] {
  if (!fs.existsSync(resultsDir)) return [];
  return fs
    .readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("aggregate-") && !f.startsWith("compare-") && !f.startsWith("calibrate-"))
    .map((f) => path.join(resultsDir, f))
    .sort();
}

export function loadReport(file: string): BenchReport {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as BenchReport;
}

export function loadAllReports(resultsDir: string): BenchReport[] {
  const reports: BenchReport[] = [];
  for (const f of listResultFiles(resultsDir)) {
    try {
      reports.push(loadReport(f));
    } catch {
      // skip malformed history files instead of poisoning the roll-up
    }
  }
  return reports;
}

export function loadFixtureSpecs(fixturesDir: string): Map<string, BenchSpec> {
  const out = new Map<string, BenchSpec>();
  if (!fs.existsSync(fixturesDir)) return out;
  for (const entry of fs.readdirSync(fixturesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const specPath = path.join(fixturesDir, entry.name, "bench.json");
    if (!fs.existsSync(specPath)) continue;
    try {
      const spec = JSON.parse(fs.readFileSync(specPath, "utf-8")) as BenchSpec;
      out.set(spec.id ?? entry.name, spec);
    } catch {
      // skip
    }
  }
  return out;
}

function emptyBucket(key: string): AggregateBucket {
  return { key, total: 0, solved: 0, solveRate: 0, totalCostUsd: 0, totalDurationMs: 0 };
}

function addToBucket(b: AggregateBucket, r: BenchResult): void {
  b.total++;
  if (r.solved) b.solved++;
  const cost = r.ai?.totalCostUsd;
  if (typeof cost === "number") b.totalCostUsd += cost;
  if (typeof r.durationMs === "number") b.totalDurationMs += r.durationMs;
}

function finalizeBuckets(buckets: Map<string, AggregateBucket>): AggregateBucket[] {
  const arr = Array.from(buckets.values());
  for (const b of arr) b.solveRate = b.total === 0 ? 0 : b.solved / b.total;
  return arr.sort((a, b) => a.key.localeCompare(b.key));
}

export function groupByFixture(reports: BenchReport[]): AggregateBucket[] {
  const m = new Map<string, AggregateBucket>();
  for (const rep of reports) {
    for (const r of rep.results) {
      const key = r.fixtureId;
      if (!m.has(key)) m.set(key, emptyBucket(key));
      addToBucket(m.get(key)!, r);
    }
  }
  return finalizeBuckets(m);
}

export function groupByModel(reports: BenchReport[]): AggregateBucket[] {
  const m = new Map<string, AggregateBucket>();
  for (const rep of reports) {
    for (const r of rep.results) {
      const arr = Array.isArray(r.ai?.models) ? r.ai.models : [];
      const models = arr.length > 0 ? arr : ["(unknown)"];
      for (const model of models) {
        if (!m.has(model)) m.set(model, emptyBucket(model));
        addToBucket(m.get(model)!, r);
      }
    }
  }
  return finalizeBuckets(m);
}

export function isoWeek(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function groupByWeek(reports: BenchReport[]): AggregateBucket[] {
  const m = new Map<string, AggregateBucket>();
  for (const rep of reports) {
    const week = isoWeek(rep.startedAt);
    for (const r of rep.results) {
      if (!m.has(week)) m.set(week, emptyBucket(week));
      addToBucket(m.get(week)!, r);
    }
  }
  return finalizeBuckets(m);
}

export function computeOverBudget(
  fixtureBuckets: AggregateBucket[],
  specs: Map<string, BenchSpec>,
): { fixtureId: string; totalCostUsd: number; budget: number }[] {
  const out: { fixtureId: string; totalCostUsd: number; budget: number }[] = [];
  for (const b of fixtureBuckets) {
    const spec = specs.get(b.key);
    const budget = spec?.costBudgetUsd;
    if (typeof budget === "number" && budget > 0 && b.totalCostUsd >= budget) {
      out.push({ fixtureId: b.key, totalCostUsd: b.totalCostUsd, budget });
      b.overBudget = true;
    }
  }
  return out;
}

export function aggregate(reports: BenchReport[], specs: Map<string, BenchSpec>): BenchAggregateReport {
  const byFixture = groupByFixture(reports);
  const byModel = groupByModel(reports);
  const byWeek = groupByWeek(reports);
  const overBudgetFixtures = computeOverBudget(byFixture, specs);
  const totalCostUsd = byFixture.reduce((acc, b) => acc + b.totalCostUsd, 0);
  return {
    generatedAt: new Date().toISOString(),
    reportsScanned: reports.length,
    resultsScanned: reports.reduce((n, r) => n + r.results.length, 0),
    byFixture,
    byModel,
    byWeek,
    totalCostUsd,
    overBudgetFixtures,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function bucketRow(b: AggregateBucket): string {
  const flag = b.overBudget ? " ⚠️" : "";
  return `| ${b.key} | ${b.solved}/${b.total} | ${pct(b.solveRate)} | ${fmtCost(b.totalCostUsd)}${flag} | ${(b.totalDurationMs / 1000).toFixed(1)}s |`;
}

export function formatAggregateMd(a: BenchAggregateReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark aggregate — ${a.generatedAt}`);
  lines.push("");
  lines.push(`Scanned **${a.resultsScanned}** results across **${a.reportsScanned}** runs · total cost ${fmtCost(a.totalCostUsd)}`);
  lines.push("");
  if (a.overBudgetFixtures.length > 0) {
    lines.push(`⚠️ **Over budget:** ${a.overBudgetFixtures.map((o) => `${o.fixtureId} (${fmtCost(o.totalCostUsd)} ≥ ${fmtCost(o.budget)})`).join(", ")}`);
    lines.push("");
  }
  lines.push("## by fixture");
  lines.push("| fixture | solved/total | solve-rate | cost | duration |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const b of a.byFixture) lines.push(bucketRow(b));
  lines.push("");
  lines.push("## by model");
  lines.push("| model | solved/total | solve-rate | cost | duration |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const b of a.byModel) lines.push(bucketRow(b));
  lines.push("");
  lines.push("## by week");
  lines.push("| week | solved/total | solve-rate | cost | duration |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const b of a.byWeek) lines.push(bucketRow(b));
  lines.push("");
  return lines.join("\n");
}

function indexResults(report: BenchReport): Map<string, BenchResult> {
  const m = new Map<string, BenchResult>();
  for (const r of report.results) {
    if (!m.has(r.fixtureId)) m.set(r.fixtureId, r);
  }
  return m;
}

function classifyDelta(
  before: BenchResult | undefined,
  after: BenchResult | undefined,
): FixtureCompareEntry["delta"] {
  if (!before && after) return "added";
  if (before && !after) return "removed";
  if (!before || !after) return "no-change";
  if (before.solved && !after.solved) return "regression";
  if (!before.solved && after.solved) return "improvement";
  if (before.status !== after.status) return "status-change";
  return "no-change";
}

export function compareReports(
  before: BenchReport,
  after: BenchReport,
  beforePath: string,
  afterPath: string,
): BenchCompareReport {
  const beforeMap = indexResults(before);
  const afterMap = indexResults(after);
  const allIds = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);
  const fixtures: FixtureCompareEntry[] = [];
  let regressions = 0;
  let improvements = 0;
  let statusChanges = 0;
  let totalCostBefore = 0;
  let totalCostAfter = 0;

  for (const id of Array.from(allIds).sort()) {
    const b = beforeMap.get(id);
    const a = afterMap.get(id);
    const delta = classifyDelta(b, a);
    if (delta === "regression") regressions++;
    else if (delta === "improvement") improvements++;
    else if (delta === "status-change") statusChanges++;
    const bc = b?.ai.totalCostUsd ?? null;
    const ac = a?.ai.totalCostUsd ?? null;
    if (typeof bc === "number") totalCostBefore += bc;
    if (typeof ac === "number") totalCostAfter += ac;
    fixtures.push({
      fixtureId: id,
      before: {
        status: b?.status ?? null,
        solved: b?.solved ?? null,
        totalCostUsd: bc,
        durationMs: b?.durationMs ?? null,
      },
      after: {
        status: a?.status ?? null,
        solved: a?.solved ?? null,
        totalCostUsd: ac,
        durationMs: a?.durationMs ?? null,
      },
      costDeltaUsd: bc !== null && ac !== null ? ac - bc : null,
      durationDeltaMs: b && a ? a.durationMs - b.durationMs : null,
      delta,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    beforePath,
    afterPath,
    beforeStartedAt: before.startedAt,
    afterStartedAt: after.startedAt,
    fixtures,
    regressions,
    improvements,
    statusChanges,
    totalCostBeforeUsd: totalCostBefore,
    totalCostAfterUsd: totalCostAfter,
    costDeltaUsd: totalCostAfter - totalCostBefore,
  };
}

function deltaIcon(d: FixtureCompareEntry["delta"]): string {
  switch (d) {
    case "regression":
      return "🔴";
    case "improvement":
      return "🟢";
    case "status-change":
      return "🟡";
    case "added":
      return "➕";
    case "removed":
      return "➖";
    default:
      return "·";
  }
}

export function formatCompareMd(c: BenchCompareReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark compare — ${c.generatedAt}`);
  lines.push("");
  lines.push(`Before: ${c.beforePath} (started ${c.beforeStartedAt})`);
  lines.push(`After:  ${c.afterPath} (started ${c.afterStartedAt})`);
  lines.push("");
  lines.push(`**Regressions:** ${c.regressions} · **Improvements:** ${c.improvements} · **Status changes:** ${c.statusChanges}`);
  lines.push(`**Cost:** ${fmtCost(c.totalCostBeforeUsd)} → ${fmtCost(c.totalCostAfterUsd)} (Δ ${fmtCost(c.costDeltaUsd)})`);
  lines.push("");
  lines.push("| | fixture | before | after | Δcost | Δduration |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const f of c.fixtures) {
    const dCost = f.costDeltaUsd === null ? "—" : fmtCost(f.costDeltaUsd);
    const dDur = f.durationDeltaMs === null ? "—" : `${(f.durationDeltaMs / 1000).toFixed(1)}s`;
    const beforeBit = f.before.status ? `${f.before.status}` : "—";
    const afterBit = f.after.status ? `${f.after.status}` : "—";
    lines.push(`| ${deltaIcon(f.delta)} | ${f.fixtureId} | ${beforeBit} | ${afterBit} | ${dCost} | ${dDur} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeAggregate(a: BenchAggregateReport, outDir: string): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = a.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `aggregate-${stamp}.json`);
  const mdPath = path.join(outDir, `aggregate-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(a, null, 2));
  fs.writeFileSync(mdPath, formatAggregateMd(a));
  return { jsonPath, mdPath };
}

export function writeCompare(c: BenchCompareReport, outDir: string): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = c.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `compare-${stamp}.json`);
  const mdPath = path.join(outDir, `compare-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(c, null, 2));
  fs.writeFileSync(mdPath, formatCompareMd(c));
  return { jsonPath, mdPath };
}
