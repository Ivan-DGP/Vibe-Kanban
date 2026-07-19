// ============================================================
// Task
// ============================================================

import type { GroundedArtifact } from "./artifact";
import type { GroundedMemory } from "./memory";
import type { AiAgent } from "./misc";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done" | "approved" | "archived";
export type TaskPriority = "urgent" | "high" | "medium" | "low";
export type PromptProfile = "auto" | "quick-fix" | "feature" | "refactor" | "bug-fix" | "docs";

export interface Task {
  id: string;
  projectId: string;
  milestoneId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  prompt: string | null;
  branch: string | null;
  promptProfile: PromptProfile;
  status: TaskStatus;
  priority: TaskPriority;
  taskNumber: number;
  sortOrder: number;
  inboxAt: string | null;
  inProgressAt: string | null;
  doneAt: string | null;
  approvedAt: string | null;
  archivedAt: string | null;
  notionPageId: string | null;
  // Per-task resolver override; null = inherit batch/global default.
  agent: AiAgent | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  prompt?: string;
  branch?: string;
  promptProfile?: PromptProfile;
  status?: TaskStatus;
  priority?: TaskPriority;
  milestoneId?: string | null;
  parentTaskId?: string | null;
  agent?: AiAgent | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  prompt?: string | null;
  branch?: string | null;
  promptProfile?: PromptProfile;
  status?: TaskStatus;
  priority?: TaskPriority;
  milestoneId?: string | null;
  agent?: AiAgent | null;
  sortOrder?: number;
  // Full-replace of the task's metadata JSON bag. Merge with the existing value
  // client-side before sending — the server overwrites, it does not deep-merge.
  metadata?: Record<string, unknown>;
}

/** A reference from a task to a knowledge artifact, stored in task.metadata.artifacts.
 *  Roles: 'spec' | 'prototype' | 'impl-notes' | 'quiz' | 'reference' (free-form). */
export interface TaskArtifactRef {
  id: string;
  role: string;
}

export interface AiPreflightResult {
  taskId: string;
  title: string;
  detectedProfile: Exclude<PromptProfile, "auto">;
  effectiveProfile: PromptProfile;
  scope: "small" | "medium" | "large";
  hasDescription: boolean;
  hasPrompt: boolean;
  warnings: string[];
  branch: string | null;
}

export interface TaskAiRun {
  id: string;
  taskId: string;
  projectId: string;
  sessionId: string | null;
  profile: string;
  complexity: "small" | "medium" | "large";
  exitCode: number | null;
  success: boolean;
  filesChanged: number | null;
  durationMs: number | null;
  summary: string | null;
  createdAt: string;
  // Durable lifecycle (added with the worktree/cancellable run engine).
  // 'waiting_limit' = parked after a subscription usage-limit hit, awaiting
  // auto-resume of the same Claude session when the window resets.
  status?: "running" | "succeeded" | "failed" | "canceled" | "waiting_limit" | string;
  startedAt?: string | null;
  finishedAt?: string | null;
  totalCostUsd?: number | null;
  // Auto-resume after usage-limit (set while status === 'waiting_limit').
  resumeAt?: string | null;
  resumeReason?: string | null;
  resumeAttempts?: number | null;
  // O6: knowledge artifacts injected into this run's prompt. Empty when no
  // knowledge was grounded (embeddings disabled, no artifacts, or timeout).
  groundedArtifacts?: GroundedArtifact[];
  // Memory events injected into this run's prompt (past decisions/gotchas/failed
  // attempts). Empty when no memory was grounded.
  groundedMemory?: GroundedMemory[];
  // Per-run deviations log recorded by the resolve agent via the
  // record_run_deviations MCP tool: how it diverged from the plan, plus the
  // impl-notes artifact it authored. Null when the agent logged nothing.
  deviations?: RunDeviations | null;
}

export interface RunDeviations {
  notes?: string;
  artifactId?: string;
}

export interface ProjectAiStats {
  totalRuns: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number | null;
  commonFailures: string[];
  profileBreakdown: Record<string, number>;
  totalCostUsd?: number;
  runningCount?: number;
}

export interface TaskFilters {
  status?: TaskStatus;
  milestoneId?: string | null;
  search?: string;
  sort?: "priority" | "newest" | "oldest" | "updated";
  limit?: number;
  offset?: number;
}
