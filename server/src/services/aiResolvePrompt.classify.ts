import type { Task, Project, PromptProfile } from "@vibe-kanban/shared";

export type ResolvedProfile = Exclude<PromptProfile, "auto">;

export interface ProfileConfig {
  includeTree: boolean;
  treeMaxDepth: number;
  includeDeps: boolean;
  includeCommits: boolean;
  commitCount: number;
  includeOtherTasks: boolean;
  includeRules: boolean;
}

export const PROFILE_CONFIGS: Record<ResolvedProfile, ProfileConfig> = {
  "quick-fix": {
    includeTree: false,
    treeMaxDepth: 0,
    includeDeps: false,
    includeCommits: false,
    commitCount: 0,
    includeOtherTasks: false,
    includeRules: true,
  },
  feature: {
    includeTree: true,
    treeMaxDepth: 3,
    includeDeps: true,
    includeCommits: true,
    commitCount: 10,
    includeOtherTasks: true,
    includeRules: true,
  },
  refactor: {
    includeTree: true,
    treeMaxDepth: 4,
    includeDeps: true,
    includeCommits: true,
    commitCount: 10,
    includeOtherTasks: false,
    includeRules: true,
  },
  "bug-fix": {
    includeTree: true,
    treeMaxDepth: 3,
    includeDeps: true,
    includeCommits: true,
    commitCount: 20,
    includeOtherTasks: false,
    includeRules: true,
  },
  docs: {
    includeTree: true,
    treeMaxDepth: 2,
    includeDeps: false,
    includeCommits: false,
    commitCount: 0,
    includeOtherTasks: false,
    includeRules: true,
  },
};

/**
 * Auto-detect the best prompt profile from task content.
 * Exported so it can be used by the API to show the resolved profile to users.
 */
export function classifyTaskProfile(
  task: Pick<Task, "title" | "description" | "prompt">,
): ResolvedProfile {
  const text = `${task.title} ${task.description ?? ""} ${task.prompt ?? ""}`.toLowerCase();

  // Documentation signals
  if (
    /\b(docs?|documentation|readme|jsdoc|typedoc|changelog|guide|api docs)\b/.test(text) &&
    !/\b(fix|bug|implement|add feature|create|build)\b/.test(text)
  ) {
    return "docs";
  }

  // Quick-fix signals: typos, config tweaks, one-liners
  if (
    /\b(typo|rename|config|env var|constant|version bump|one-liner|tweak|toggle|flag|wording|spelling)\b/.test(
      text,
    )
  ) {
    return "quick-fix";
  }

  // Bug-fix signals
  if (
    /\b(bug|fix|crash|error|broken|regression|issue|failing|undefined is not|null pointer|exception|wrong|incorrect|doesn'?t work)\b/.test(
      text,
    )
  ) {
    return "bug-fix";
  }

  // Refactor signals (with negative guard for features)
  if (
    /\b(refactor|restructure|reorganize|clean ?up|extract|decouple|simplify|migrate|move files?|split|consolidate|tech debt)\b/.test(
      text,
    ) &&
    !/\b(add|new|create|implement)\b/.test(text)
  ) {
    return "refactor";
  }

  // Default: feature (safest — provides full context)
  return "feature";
}

/**
 * Estimate task complexity from content length and structure.
 * Returns a multiplier that adjusts context depth:
 *   "small" = less context (0.5x), "medium" = standard (1x), "large" = more context (1.5x)
 */
export function estimateComplexity(
  task: Pick<Task, "title" | "description" | "prompt">,
): "small" | "medium" | "large" {
  const titleLen = task.title?.length ?? 0;
  const descLen = task.description?.length ?? 0;
  const promptLen = task.prompt?.length ?? 0;
  const totalLen = titleLen + descLen + promptLen;

  // Heuristics: short title, no desc/prompt = small
  if (totalLen < 100 && !task.prompt) return "small";
  // Long descriptions or detailed prompts = large
  if (totalLen > 500 || promptLen > 200) return "large";
  return "medium";
}

export function applyComplexityToConfig(
  config: ProfileConfig,
  complexity: "small" | "medium" | "large",
): ProfileConfig {
  if (complexity === "small") {
    return {
      ...config,
      treeMaxDepth: Math.max(config.treeMaxDepth - 1, 1),
      commitCount: Math.min(config.commitCount, 5),
      includeOtherTasks: false,
    };
  }
  if (complexity === "large") {
    return {
      ...config,
      treeMaxDepth: config.treeMaxDepth + 1,
      commitCount: Math.max(config.commitCount, 15),
    };
  }
  return config;
}

export function buildProfileInstructions(
  profile: ResolvedProfile,
  project: Project,
  task: Task,
  gitInstruction: string,
): string {
  const explore = `Explore the codebase at ${project.path} to understand the current state`;

  switch (profile) {
    case "quick-fix":
      return `## Instructions
1. Read the task description and technical details above carefully
2. Make the MINIMAL change required to accomplish this task
3. Do NOT refactor surrounding code or make unrelated improvements
4. ${gitInstruction}

IMPORTANT: This is a quick-fix task. Keep changes to as few files and lines as possible.`;

    case "feature":
      return `## Instructions
1. Read the task description and technical details above carefully
2. ${explore}
3. Plan the implementation before writing code
4. Implement the required changes
5. Add or update tests if a test framework is available
6. ${gitInstruction}`;

    case "refactor":
      return `## Instructions
1. Read the task description and technical details above carefully
2. ${explore}
3. CRITICAL: This is a refactor. There must be NO behavior changes. Inputs and outputs must remain identical.
4. Run existing tests before making changes to establish a baseline
5. Implement the restructuring
6. Run tests again to confirm no regressions
7. If tests fail, revert and try a different approach
8. ${gitInstruction}

IMPORTANT: After completing changes, do a self-review: compare your diff against the original behavior. Any functional change is a bug.`;

    case "bug-fix":
      return `## Instructions
1. Read the task description and technical details above carefully
2. ${explore}
3. FIRST: Reproduce the bug. Identify the exact failure condition.
4. Identify the root cause (not just symptoms)
5. Implement the fix
6. Verify the fix resolves the issue
7. Check for similar bugs in related code paths
8. ${gitInstruction}

IMPORTANT: Include details of what caused the bug and how it was fixed in your commit message / task summary.`;

    case "docs":
      return `## Instructions
1. Read the task description above carefully
2. Review existing documentation style and conventions in the project
3. Write or update documentation as specified
4. Do NOT make code changes unless the task explicitly requires them
5. Follow the existing documentation format (markdown style, heading levels, etc.)
6. ${gitInstruction}

IMPORTANT: Focus only on documentation. Do not refactor or fix code.`;
  }
}
