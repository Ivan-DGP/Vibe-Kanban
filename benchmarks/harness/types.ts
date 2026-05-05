export interface BenchMockChainStep {
  /** Match by metadata.type of the task being processed. fake-claude looks up its own task to decide. */
  whenType: string;
  /** Files to write into cwd, applied before PATCHing the task. */
  applyFix?: Record<string, string>;
  /** Optionally create a child task with this metadata.type — fake-claude POSTs /api/projects/:id/tasks. */
  createChildType?: string;
  /** Title of the child task (default: "Re-QA: ..."). */
  createChildTitle?: string;
  /** metadata to attach to the child (parent_task is filled in automatically). */
  createChildMetadata?: Record<string, unknown>;
}

export interface BenchSpec {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  prompt: string;
  targetTestPath: string;
  regressionTestPath: string;
  expectedFilesChanged?: string[];
  /** Strict multi-file enforcement: every listed path must have a non-trivial change (not just whitespace/comments). */
  requireFiles?: string[];
  maxDiffLines: number;
  timeoutMs: number;
  /** Optional reference fix used by --mock to validate scoring without burning tokens. Map of relative path → full file content. */
  mockFix?: Record<string, string>;
  /** Pipeline-mode dispatch hint. Defaults to "codebase" (bench-codebase spawn). */
  pipelineMode?: "codebase" | "qa-test" | "dev-fix";
  /** Drive a multi-task orchestration chain in mock mode. fake-claude steps through these by matching task metadata.type. */
  mockChain?: BenchMockChainStep[];
  /** Expected final chain depth (root=1, +1 per child). Used to gate Phase C scoring. */
  expectedChainDepth?: number;
  /** Force fake-claude to sleep this many ms before exiting. Used for timeout-recovery tests. */
  mockHangMs?: number;
  /** When set, aggregate flags runs whose summed total_cost_usd >= this budget. Skipped when null. */
  costBudgetUsd?: number;
  /** Harness self-test fixtures (e.g. timeout machinery). Calibrate reports them as "meta" instead of grading solve-rate. */
  excludeFromCalibration?: boolean;
}

export type BenchStatus =
  | "SOLVED"
  | "TARGET-FAIL"
  | "TARGET-ONLY"
  | "REGRESSED"
  | "SPRAWL"
  | "TAMPERED"
  | "MIS-FIXTURE"
  | "TIMEOUT"
  | "INSUFFICIENT-FILES"
  | "ERROR";

export interface BenchResult {
  fixtureId: string;
  title: string;
  runId: string;
  startedAt: string;
  durationMs: number;
  workDir: string;

  ai: {
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
  };

  tests: {
    targetPassed: boolean;
    regressionsHeld: boolean;
    targetExitCode: number | null;
    regressionExitCode: number | null;
    targetOutput: string;
    regressionOutput: string;
  };

  diff: {
    filesChanged: string[];
    linesAdded: number;
    linesRemoved: number;
    withinBudget: boolean;
    expectedFilesOnly: boolean;
  };

  preflight: {
    ran: boolean;
    misFixture: boolean;
    reason: string | null;
  };

  tampering: {
    checked: boolean;
    detected: boolean;
    changedFiles: string[];
  };

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
    snapshot: {
      fileExists: boolean;
      taskInSnapshot: boolean;
    };
    embeddings: {
      rowCount: number;
      skipped: boolean;
    };
    allGreen: boolean;
  };

  multiFile: {
    checked: boolean;
    required: string[];
    missing: string[];
    trivial: string[];
    allTouched: boolean;
  };

  status: BenchStatus;
  solved: boolean;
  error: string | null;
}

export interface BenchReport {
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  count: number;
  solvedCount: number;
  results: BenchResult[];
}

export interface AggregateBucket {
  key: string;
  total: number;
  solved: number;
  solveRate: number;
  totalCostUsd: number;
  totalDurationMs: number;
  overBudget?: boolean;
}

export interface BenchAggregateReport {
  generatedAt: string;
  reportsScanned: number;
  resultsScanned: number;
  byFixture: AggregateBucket[];
  byModel: AggregateBucket[];
  byWeek: AggregateBucket[];
  totalCostUsd: number;
  overBudgetFixtures: { fixtureId: string; totalCostUsd: number; budget: number }[];
}

export interface FixtureCompareEntry {
  fixtureId: string;
  before: { status: string | null; solved: boolean | null; totalCostUsd: number | null; durationMs: number | null };
  after: { status: string | null; solved: boolean | null; totalCostUsd: number | null; durationMs: number | null };
  delta: "regression" | "improvement" | "status-change" | "no-change" | "added" | "removed";
  costDeltaUsd: number | null;
  durationDeltaMs: number | null;
}

export interface BenchCompareReport {
  generatedAt: string;
  beforePath: string;
  afterPath: string;
  beforeStartedAt: string;
  afterStartedAt: string;
  fixtures: FixtureCompareEntry[];
  regressions: number;
  improvements: number;
  statusChanges: number;
  totalCostBeforeUsd: number;
  totalCostAfterUsd: number;
  costDeltaUsd: number;
}

export interface BaselineComparison {
  regressions: string[];
  improvements: string[];
  added: string[];
  removed: string[];
  costDelta: number;
}
