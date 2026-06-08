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

/**
 * server-integration mode: declarative HTTP script run against the real
 * Fastify app. Each step is dispatched via app.inject(). URLs and payloads
 * may reference earlier responses with `${var}` after a step uses `saveAs`.
 * `${projectId}` is preset by the harness to the bench-created project.
 */
export interface BenchHttpExpect {
  /** Required exact status code. */
  statusCode?: number;
  /** Substring match against raw body (useful for plain-text endpoints). */
  bodyContains?: string;
  /** Each entry asserts a JSON path equals an exact value. Path uses dot+bracket form: `a.b[0].c`. */
  jsonPath?: { path: string; value: unknown }[];
  /** Save the parsed JSON body under this name for later `${name…}` substitution. */
  saveAs?: string;
}

export interface BenchHttpStep {
  /** Short label rendered in the per-fixture report. */
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path; may reference `${projectId}` and any `saveAs` names with `${name.path}` form. */
  url: string;
  /** Optional JSON body; same `${…}` substitution applies recursively. */
  payload?: unknown;
  expect?: BenchHttpExpect;
}

/**
 * Failure-injection bench (phase I). Each flag exercises a different production
 * resilience path. INJECTED-PASS = system surfaced the failure cleanly (non-zero
 * exit recorded, slot released, row written). INJECTED-FAIL = system silently
 * absorbed it. The expected*` knobs let a fixture pin a specific surface so a
 * "model recovered" pass-through doesn't pretend the system handled the failure.
 */
export interface InjectionSpec {
  /** Have fake-claude emit malformed JSON. Tests parseClaudeOutput streaming-JSON fallback (server/src/services/headlessClaude.ts:67-83). */
  outputFormatBroken?: boolean;
  /** Have fake-claude exit non-zero after this many ms without writing a result envelope. Simulates SIGKILL / OOM mid-run. */
  killAfterMs?: number;
  /** Install a Fastify onRequest hook on `/mcp*` that returns 500 with this probability [0..1]. Tests MCP failure surfacing. */
  mcp500Rate?: number;
  /** Skip installing the fake-claude PATH shim. spawnProcess fails with ENOENT — tests "missing CLI" surfaces, not silent SOLVED. */
  claudeNotFound?: boolean;
  /** Pin the expected exit code so we don't grade "model recovered cleanly" as INJECTED-PASS when it should be INJECTED-FAIL. */
  expectExitNonZero?: boolean;
  /** Pin that summary should be empty/garbage (parser fallback path). */
  expectSummaryEmpty?: boolean;
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
  pipelineMode?: "codebase" | "qa-test" | "dev-fix" | "server-integration";
  /** Drive a multi-task orchestration chain in mock mode. fake-claude steps through these by matching task metadata.type. */
  mockChain?: BenchMockChainStep[];
  /** server-integration mode: ordered HTTP script. AI is never invoked; coverage of real route handlers is the point. */
  httpScript?: BenchHttpStep[];
  /** failure-injection bench (phase I): see InjectionSpec. When set, target/regression scoring is replaced with INJECTED-PASS / INJECTED-FAIL. */
  injection?: InjectionSpec;
  /** Expected final chain depth (root=1, +1 per child). Used to gate Phase C scoring. */
  expectedChainDepth?: number;
  /** Force fake-claude to sleep this many ms before exiting. Used for timeout-recovery tests. */
  mockHangMs?: number;
  /** When set, aggregate flags runs whose summed total_cost_usd >= this budget. Skipped when null. */
  costBudgetUsd?: number;
  /** Harness self-test fixtures (e.g. timeout machinery). Calibrate reports them as "meta" instead of grading solve-rate. */
  excludeFromCalibration?: boolean;
  /** Adversarial bench (phase K): substrings that MUST NOT appear in claude output (summary or stdout). Triggers EXFIL on hit. */
  decoys?: string[];
  /** Adversarial bench (phase K): substrings whose presence in claude output proves the model followed an injected instruction. Triggers PROMPT-INJECTED. */
  injectionMarkers?: string[];
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
  | "INJECTED-PASS"
  | "INJECTED-FAIL"
  | "EXFIL"
  | "PROMPT-INJECTED"
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

  serverIntegration: {
    ran: boolean;
    steps: {
      name: string;
      method: string;
      url: string;
      statusCode: number | null;
      passed: boolean;
      error: string | null;
    }[];
    allPassed: boolean;
  };

  injection: {
    requested: boolean;
    /** Active failure modes, e.g. ["outputFormatBroken"], ["killAfterMs", "mcp500Rate"]. */
    modes: string[];
    /** Number of MCP requests answered 5xx by the injection hook (0 if mcp500Rate not set). */
    mcp500Count: number;
    /** Did the system exit non-zero / record an error / produce empty summary as appropriate? */
    surfaced: boolean;
    /** Did the headless claude concurrency slot leak? */
    slotLeaked: boolean;
    /** Was a task_ai_runs row written despite the injection? */
    rowRecorded: boolean;
    /** surfaced && !slotLeaked && rowRecorded — i.e. system handled the failure cleanly. */
    recovered: boolean;
    notes: string[];
  };

  adversarial: {
    checked: boolean;
    /** Decoy substrings observed in claude output (summary). */
    decoyMatches: string[];
    /** Injection-marker substrings observed in claude output. */
    injectionMatches: string[];
    /** Decoy leakage triggered. */
    exfilDetected: boolean;
    /** Model followed adversarial instruction (marker present in output). */
    promptInjected: boolean;
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
  /** Phase J: optional E2E summary when bench was run with --include-e2e. */
  e2e?: BenchE2EResult;
}

export interface BenchE2EResult {
  ran: boolean;
  /** Number of Playwright tests in the bench-e2e project. */
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  /** Per-test annotations the spec emits — e.g. e2eMs, rowAppearMs. */
  annotations: { type: string; description: string }[];
  /** Non-zero exit code from playwright if the run failed mechanically. */
  exitCode: number | null;
  /** Error message if the runner itself failed (couldn't spawn, etc.). */
  error: string | null;
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
  /** server-integration coverage fixtures: pass/fail rather than AI solve-rate. */
  byCoverage: AggregateBucket[];
  totalCostUsd: number;
  overBudgetFixtures: { fixtureId: string; totalCostUsd: number; budget: number }[];
}

export interface FixtureCompareEntry {
  fixtureId: string;
  before: {
    status: string | null;
    solved: boolean | null;
    totalCostUsd: number | null;
    durationMs: number | null;
  };
  after: {
    status: string | null;
    solved: boolean | null;
    totalCostUsd: number | null;
    durationMs: number | null;
  };
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
