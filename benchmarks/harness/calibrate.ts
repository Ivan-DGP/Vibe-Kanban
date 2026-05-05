import type { BenchReport, BenchResult, BenchSpec } from "./types";

export type CalibrationRecommendation = "trivial" | "harder" | "ok" | "insufficient" | "meta";

export interface CalibrationEntry {
  fixtureId: string;
  title: string;
  category: string;
  difficulty: string;
  total: number;
  solved: number;
  solveRate: number;
  avgDurationMs: number;
  avgTurns: number | null;
  avgCostUsd: number | null;
  recommendation: CalibrationRecommendation;
  reason: string;
}

export interface CalibrationReport {
  generatedAt: string;
  windowDays: number;
  reportsScanned: number;
  resultsScanned: number;
  trivialThreshold: number;
  harderThreshold: number;
  minSamples: number;
  fixtures: CalibrationEntry[];
}

export interface CalibrationOptions {
  windowDays?: number;
  trivialThreshold?: number;
  harderThreshold?: number;
  minSamples?: number;
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function calibrate(
  reports: BenchReport[],
  specs: Map<string, BenchSpec>,
  opts: CalibrationOptions = {},
): CalibrationReport {
  const windowDays = opts.windowDays ?? 30;
  const trivialThreshold = opts.trivialThreshold ?? 0.95;
  const harderThreshold = opts.harderThreshold ?? 0.20;
  const minSamples = opts.minSamples ?? 3;
  const now = opts.now ?? new Date();
  const cutoffMs = now.getTime() - windowDays * DAY_MS;

  const filtered = reports.filter((r) => {
    const t = Date.parse(r.startedAt);
    return Number.isFinite(t) && t >= cutoffMs;
  });

  const byFixture = new Map<string, BenchResult[]>();
  for (const rep of filtered) {
    if (!Array.isArray(rep.results)) continue;
    for (const r of rep.results) {
      if (r.ai?.invoked === false) continue;
      if (!byFixture.has(r.fixtureId)) byFixture.set(r.fixtureId, []);
      byFixture.get(r.fixtureId)!.push(r);
    }
  }

  const entries: CalibrationEntry[] = [];
  for (const [fixtureId, results] of byFixture) {
    const spec = specs.get(fixtureId);
    const total = results.length;
    const solved = results.filter((r) => r.solved).length;
    const solveRate = total === 0 ? 0 : solved / total;
    const avgDurationMs = total === 0 ? 0 : results.reduce((s, r) => s + (r.durationMs ?? 0), 0) / total;

    const turns = results.map((r) => r.ai?.numTurns).filter((n): n is number => typeof n === "number");
    const avgTurns = turns.length === 0 ? null : turns.reduce((s, n) => s + n, 0) / turns.length;
    const costs = results.map((r) => r.ai?.totalCostUsd).filter((n): n is number => typeof n === "number");
    const avgCostUsd = costs.length === 0 ? null : costs.reduce((s, n) => s + n, 0) / costs.length;

    let recommendation: CalibrationRecommendation;
    let reason: string;
    if (spec?.excludeFromCalibration) {
      recommendation = "meta";
      reason = `harness self-test (excludeFromCalibration) — solve-rate not applicable`;
    } else if (total < minSamples) {
      recommendation = "insufficient";
      reason = `only ${total} sample${total === 1 ? "" : "s"} in window (need ≥${minSamples})`;
    } else if (solveRate >= trivialThreshold) {
      recommendation = "trivial";
      reason = `${pct(solveRate)} ≥ ${pct(trivialThreshold)} → promote difficulty or retire`;
    } else if (solveRate <= harderThreshold) {
      recommendation = "harder";
      reason = `${pct(solveRate)} ≤ ${pct(harderThreshold)} → re-author or check baseline`;
    } else {
      recommendation = "ok";
      reason = `${pct(solveRate)} within calibration band`;
    }

    entries.push({
      fixtureId,
      title: spec?.title ?? "(unknown)",
      category: spec?.category ?? "(unknown)",
      difficulty: spec?.difficulty ?? "(unknown)",
      total,
      solved,
      solveRate,
      avgDurationMs,
      avgTurns,
      avgCostUsd,
      recommendation,
      reason,
    });
  }

  entries.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));

  return {
    generatedAt: now.toISOString(),
    windowDays,
    reportsScanned: filtered.length,
    resultsScanned: filtered.reduce((n, r) => n + (Array.isArray(r.results) ? r.results.length : 0), 0),
    trivialThreshold,
    harderThreshold,
    minSamples,
    fixtures: entries,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtCost(n: number | null): string {
  return n === null ? "—" : `$${n.toFixed(4)}`;
}

function fmtTurns(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function bucket(c: CalibrationReport, rec: CalibrationRecommendation): CalibrationEntry[] {
  return c.fixtures.filter((f) => f.recommendation === rec);
}

export function formatCalibrationText(c: CalibrationReport): string {
  const lines: string[] = [];
  lines.push(`Benchmark calibration · window ${c.windowDays}d · ${c.resultsScanned} results across ${c.reportsScanned} runs`);
  lines.push(`Thresholds: ≥ ${pct(c.trivialThreshold)} trivial · ≤ ${pct(c.harderThreshold)} harder · min ${c.minSamples} samples`);
  lines.push("");

  const trivial = bucket(c, "trivial");
  const harder = bucket(c, "harder");
  const insufficient = bucket(c, "insufficient");
  const meta = bucket(c, "meta");

  if (trivial.length > 0) {
    lines.push(`Promote / retire (${trivial.length}):`);
    for (const f of trivial) {
      lines.push(`  ${f.fixtureId} [${f.difficulty}] ${pct(f.solveRate)} (${f.solved}/${f.total}) · ${fmtTurns(f.avgTurns)} turns · ${fmtCost(f.avgCostUsd)}`);
    }
    lines.push("");
  }
  if (harder.length > 0) {
    lines.push(`Investigate / harden (${harder.length}):`);
    for (const f of harder) {
      lines.push(`  ${f.fixtureId} [${f.difficulty}] ${pct(f.solveRate)} (${f.solved}/${f.total}) · ${fmtTurns(f.avgTurns)} turns · ${fmtCost(f.avgCostUsd)}`);
    }
    lines.push("");
  }
  if (insufficient.length > 0) {
    lines.push(`Need more samples (${insufficient.length}): ${insufficient.map((f) => f.fixtureId).join(", ")}`);
    lines.push("");
  }
  if (meta.length > 0) {
    lines.push(`Harness self-tests (${meta.length}, not graded): ${meta.map((f) => f.fixtureId).join(", ")}`);
    lines.push("");
  }

  lines.push("All fixtures:");
  lines.push("  fixture                              diff   n   solve   turns   cost      rec");
  for (const f of c.fixtures) {
    const flag = f.recommendation === "trivial" ? "trivial"
      : f.recommendation === "harder" ? "harder "
      : f.recommendation === "insufficient" ? "n<min  "
      : f.recommendation === "meta" ? "meta   "
      : "ok     ";
    lines.push(`  ${f.fixtureId.padEnd(36)} ${f.difficulty.padEnd(6)} ${String(f.total).padStart(3)} ${pct(f.solveRate).padStart(7)} ${fmtTurns(f.avgTurns).padStart(7)} ${fmtCost(f.avgCostUsd).padStart(9)}  ${flag}`);
  }
  return lines.join("\n");
}

export function formatCalibrationMd(c: CalibrationReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark calibration — ${c.generatedAt}`);
  lines.push("");
  lines.push(`Window: **${c.windowDays}d** · scanned **${c.resultsScanned}** results across **${c.reportsScanned}** runs`);
  lines.push(`Thresholds: solveRate ≥ **${pct(c.trivialThreshold)}** → trivial · ≤ **${pct(c.harderThreshold)}** → harder · min **${c.minSamples}** samples`);
  lines.push("");

  const sections: { title: string; rec: CalibrationRecommendation }[] = [
    { title: "Promote / retire", rec: "trivial" },
    { title: "Investigate / harden", rec: "harder" },
    { title: "Insufficient samples", rec: "insufficient" },
    { title: "Harness self-tests (not graded)", rec: "meta" },
  ];
  for (const s of sections) {
    const items = bucket(c, s.rec);
    if (items.length === 0) continue;
    lines.push(`## ${s.title} (${items.length})`);
    lines.push("");
    for (const f of items) {
      lines.push(`- **${f.fixtureId}** [${f.difficulty}] — ${pct(f.solveRate)} (${f.solved}/${f.total}) · ${fmtTurns(f.avgTurns)} turns · ${fmtCost(f.avgCostUsd)} — ${f.reason}`);
    }
    lines.push("");
  }

  lines.push("## All fixtures");
  lines.push("| fixture | difficulty | n | solve-rate | avg turns | avg cost | rec |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const f of c.fixtures) {
    lines.push(`| ${f.fixtureId} | ${f.difficulty} | ${f.total} | ${pct(f.solveRate)} | ${fmtTurns(f.avgTurns)} | ${fmtCost(f.avgCostUsd)} | ${f.recommendation} |`);
  }
  lines.push("");
  return lines.join("\n");
}
