import type { Task } from "./task";

// Wire types for the cross-project supervisor REST surface.
//
// A supervisor proposal is just a backlog Task tagged `metadata.origin='supervisor'`
// (with `signalKey`, `signalType`, `score`, and — once dispatched — `dispatchedRunId`
// / `dispatchedAt`). The proposals list therefore reuses `Task` directly.

export type SupervisorProposal = Task;

/** Summary returned by POST /supervisor/scan (counts drive the toast). */
export interface SupervisorScanResult {
  created: number;
  skipped: number;
}

/** Result of POST /supervisor/proposals/:taskId/dispatch. */
export interface SupervisorDispatchResult {
  runId?: string;
  alreadyDispatched: boolean;
}
