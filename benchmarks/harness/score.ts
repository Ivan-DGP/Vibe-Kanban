import path from "node:path";
import fs from "node:fs";
import type { BenchReport, BenchResult } from "./types";

export function buildReport(
  results: BenchResult[],
  startedAt: string,
  finishedAt: string,
): BenchReport {
  return {
    startedAt,
    finishedAt,
    totalMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    count: results.length,
    solvedCount: results.filter((r) => r.solved).length,
    results,
  };
}

export function writeReports(
  report: BenchReport,
  outDir: string,
): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `${stamp}.json`);
  const mdPath = path.join(outDir, `${stamp}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  return { jsonPath, mdPath };
}

function renderMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark report — ${report.startedAt}`);
  lines.push("");
  lines.push(
    `Solved: **${report.solvedCount} / ${report.count}** · total ${(report.totalMs / 1000).toFixed(1)}s`,
  );
  lines.push("");
  lines.push("| fixture | status | target | regress | diff (+/-) | files | duration |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of report.results) {
    const filesShort =
      r.diff.filesChanged.length === 0
        ? "—"
        : r.diff.filesChanged.length === 1
          ? r.diff.filesChanged[0]
          : `${r.diff.filesChanged.length} files`;
    lines.push(
      `| ${r.fixtureId} | ${r.status} | ${r.tests.targetPassed ? "pass" : "fail"} | ${r.tests.regressionsHeld ? "held" : "broke"} | +${r.diff.linesAdded}/-${r.diff.linesRemoved} | ${filesShort} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    );
  }
  lines.push("");

  for (const r of report.results) {
    lines.push(`## ${r.fixtureId} — ${r.title}`);
    lines.push("");
    lines.push(`- status: **${r.status}** (solved=${r.solved})`);
    if (r.preflight.misFixture) lines.push(`- mis-fixture: ${r.preflight.reason}`);
    if (r.tampering.detected)
      lines.push(
        `- TAMPERED: tests/ files modified during AI run: [${r.tampering.changedFiles.join(", ")}]`,
      );
    const aiBits = [
      `invoked=${r.ai.invoked}`,
      `exit=${r.ai.exitCode}`,
      `durationMs=${r.ai.durationMs}`,
    ];
    if (r.ai.numTurns !== null) aiBits.push(`turns=${r.ai.numTurns}`);
    if (r.ai.totalCostUsd !== null) aiBits.push(`cost=$${r.ai.totalCostUsd.toFixed(4)}`);
    if (r.ai.models.length > 0) aiBits.push(`models=[${r.ai.models.join(",")}]`);
    lines.push(`- ai: ${aiBits.join(" ")}`);
    if (r.ai.summary)
      lines.push(`- summary: ${r.ai.summary.slice(0, 300)}${r.ai.summary.length > 300 ? "…" : ""}`);
    lines.push(
      `- target: ${r.tests.targetPassed ? "pass" : "fail"} (exit ${r.tests.targetExitCode})`,
    );
    lines.push(
      `- regressions: ${r.tests.regressionsHeld ? "held" : "broke"} (exit ${r.tests.regressionExitCode})`,
    );
    lines.push(
      `- diff: +${r.diff.linesAdded}/-${r.diff.linesRemoved} across [${r.diff.filesChanged.join(", ") || "—"}]`,
    );
    lines.push(
      `- diff budget: ${r.diff.withinBudget ? "within" : "OVER"}; expected-files-only: ${r.diff.expectedFilesOnly}`,
    );
    if (r.chain.depth > 1 || r.chain.expectedDepth !== null) {
      const expectedBit =
        r.chain.expectedDepth !== null
          ? ` (expected ${r.chain.expectedDepth}, met=${r.chain.expectedDepthMet})`
          : "";
      const costBit = r.chain.totalCostUsd > 0 ? ` cost=$${r.chain.totalCostUsd.toFixed(4)}` : "";
      lines.push(
        `- chain: depth=${r.chain.depth}${expectedBit} aiRuns=${r.chain.totalAiRuns} totalDurationMs=${r.chain.totalDurationMs}${costBit} parentLinksValid=${r.chain.parentLinksValid} leaf=${r.chain.leafTaskId ?? "—"} leafStatus=${r.chain.leafStatus ?? "—"}`,
      );
    }
    if (r.sideEffects.checked) {
      const se = r.sideEffects;
      const tsBits = `inbox=${se.timestamps.inboxAtSet} inProgress=${se.timestamps.inProgressAtSet} done=${se.timestamps.doneAtSet} ordered=${se.timestamps.cascadeOrdered}`;
      const embBits = se.embeddings.skipped ? "skipped" : `rows=${se.embeddings.rowCount}`;
      lines.push(
        `- side-effects: allGreen=${se.allGreen} aiRun=${se.taskAiRun.found} ts=[${tsBits}] snapshot=${se.snapshot.fileExists}/${se.snapshot.taskInSnapshot} embeddings=${embBits}`,
      );
    }
    if (r.concurrency.checked) {
      const c = r.concurrency;
      const beforeBits = c.statsBefore
        ? `${c.statsBefore.inFlight}/${c.statsBefore.cap}+${c.statsBefore.queued}q`
        : "—";
      const afterBits = c.statsAfter
        ? `${c.statsAfter.inFlight}/${c.statsAfter.cap}+${c.statsAfter.queued}q`
        : "—";
      lines.push(
        `- concurrency: slotLeak=${c.slotLeak} timedOut=${c.timedOut} before=${beforeBits} after=${afterBits}`,
      );
    }
    if (r.error) lines.push(`- ERROR: ${r.error}`);
    if (!r.tests.targetPassed && r.tests.targetOutput) {
      lines.push("");
      lines.push("<details><summary>target test output (tail)</summary>");
      lines.push("");
      lines.push("```");
      lines.push(r.tests.targetOutput.slice(-2000));
      lines.push("```");
      lines.push("</details>");
    }
    if (!r.tests.regressionsHeld && r.tests.regressionOutput) {
      lines.push("");
      lines.push("<details><summary>regression test output (tail)</summary>");
      lines.push("");
      lines.push("```");
      lines.push(r.tests.regressionOutput.slice(-2000));
      lines.push("```");
      lines.push("</details>");
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function parseNumstat(stdout: string): {
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
} {
  let added = 0;
  let removed = 0;
  const files: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const a = Number(parts[0]);
    const r = Number(parts[1]);
    const f = parts.slice(2).join(" ");
    if (Number.isFinite(a)) added += a;
    if (Number.isFinite(r)) removed += r;
    files.push(f);
  }
  return { filesChanged: files, linesAdded: added, linesRemoved: removed };
}
