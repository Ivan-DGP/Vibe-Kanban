// ============================================================
// Benchmarks (harness/pipeline eval wire types)
// Canonical DTOs shared by the client api layer and the server
// /benchmarks routes. Server request handlers validate raw bodies
// defensively before trusting these shapes.
// ============================================================

export interface BenchRunSummary {
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  totalMs: number | null;
  count: number;
  solvedCount: number | null;
  totalCostUsd: number;
  models: string[];
}

export interface BenchFixture {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  pipelineMode: string;
  expectedFilesChanged: string[];
  maxDiffLines: number;
  timeoutMs: number;
}

export interface BenchActiveRun {
  runId: string;
  startedAt: string;
  args: string[];
  pid: number | null;
  exitCode: number | null;
  status: "running" | "done" | "error";
  output: string;
}

export interface BenchTriggerInput {
  fixtures?: string[];
  mock?: boolean;
  mockClaude?: boolean;
  mode?: "harness" | "pipeline";
  parallel?: number;
  lenient?: boolean;
}

export interface BenchAggregateBucket {
  key: string;
  total: number;
  solved: number;
  solveRate: number;
  totalCostUsd: number;
  totalDurationMs: number;
  overBudget?: boolean;
}

export interface BenchDriftProjectAgg {
  hash: string;
  count: number;
  lastAt: string;
  lastExitCode: number | null;
}

export interface BenchDriftStats {
  totalCaptures: number;
  projectCount: number;
  latestCaptureAt: string | null;
  byProject: BenchDriftProjectAgg[];
}

export interface BenchAggregate {
  generatedAt: string;
  reportsScanned: number;
  resultsScanned: number;
  byFixture: BenchAggregateBucket[];
  byModel: BenchAggregateBucket[];
  byWeek: BenchAggregateBucket[];
  totalCostUsd: number;
  overBudgetFixtures: { fixtureId: string; totalCostUsd: number; budget: number }[];
}

export interface BenchAiInfo {
  invoked: boolean;
  exitCode: number | null;
  durationMs: number;
  durationApiMs: number | null;
  summary: string | null;
  sessionId: string | null;
  models: string[];
  numTurns: number | null;
  totalCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
  terminalReason: string | null;
  permissionDenials: number | null;
}

export interface BenchTestsInfo {
  targetPassed: boolean;
  regressionsHeld: boolean;
  targetExitCode: number | null;
  regressionExitCode: number | null;
  targetOutput: string;
  regressionOutput: string;
}

export interface BenchDiffInfo {
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  withinBudget: boolean;
  expectedFilesOnly: boolean;
}

export interface BenchResult {
  fixtureId: string;
  title: string;
  runId: string;
  startedAt: string;
  durationMs: number;
  workDir: string;
  status: string;
  solved: boolean;
  error: string | null;
  ai: BenchAiInfo;
  tests: BenchTestsInfo;
  diff: BenchDiffInfo;
  preflight: { ran: boolean; misFixture: boolean; reason: string | null };
  tampering: { checked: boolean; detected: boolean; changedFiles: string[] };
  chain: {
    depth: number;
    parentLinksValid: boolean;
    leafTaskId: string | null;
    leafStatus: string | null;
    totalAiRuns: number;
    totalDurationMs: number;
    totalCostUsd: number;
    expectedDepth: number | null;
    expectedDepthMet: boolean;
  };
  concurrency: {
    checked: boolean;
    statsBefore: { inFlight: number; queued: number; cap: number } | null;
    statsAfter: { inFlight: number; queued: number; cap: number } | null;
    slotLeak: boolean;
    timedOut: boolean;
  };
  sideEffects: {
    checked: boolean;
    taskAiRun: {
      found: boolean;
      exitCode: number | null;
      success: number | null;
      durationMs: number | null;
      sessionIdSet: boolean;
      summarySet: boolean;
    };
    timestamps: {
      inboxAtSet: boolean;
      inProgressAtSet: boolean;
      doneAtSet: boolean;
      cascadeOrdered: boolean;
    };
    snapshot: { fileExists: boolean; taskInSnapshot: boolean };
    embeddings: { rowCount: number; skipped: boolean };
    allGreen: boolean;
  };
}

export interface BenchReport {
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  count: number;
  solvedCount: number;
  results: BenchResult[];
}
