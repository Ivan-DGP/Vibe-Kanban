import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "../db";
import {
  buildAnalyzePrompt,
  buildAiResolvePrompt,
  buildGatherContextPrompt,
  buildDecomposePrompt,
  buildAiTestPrompt,
  buildProfileInstructions,
  rowToProject,
  contextCache,
} from "./aiResolvePrompt";
import type { Task, Project } from "@vibe-kanban/shared";

// Use the Vibe-Kanban project root as a real directory for filesystem-based context
const PROJECT_PATH = "/home/ivanf/projects/Vibe-Kanban";

const TEST_PROJECT_ID = "__test_builder_proj__";
const TEST_TASK_ID = "__test_builder_task__";
const _TEST_TASK_NONEXISTENT_ID = "__test_builder_no_such_task__";
const TEST_PROJECT_NONEXISTENT_ID = "__test_builder_no_such_proj__";
const TEST_PORT = 3099;

// Extra IDs for isolated tests
const EXTRA_PROJECT_ID = "__test_builder_proj_extra__";
const MILESTONE_ID = "__test_builder_milestone__";

let db: ReturnType<typeof getDb>;

beforeAll(() => {
  db = getDb();

  // Insert test project
  db.prepare(
    `
    INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
    VALUES (?, ?, ?, 0, '["TypeScript","React"]', '[]', 'stage', 3)
  `,
  ).run(TEST_PROJECT_ID, "Test Builder Project", PROJECT_PATH);

  // Insert test task
  db.prepare(
    `
    INSERT OR REPLACE INTO tasks (id, projectId, title, description, prompt, status, priority, promptProfile, taskNumber, sortOrder)
    VALUES (?, ?, ?, ?, ?, 'todo', 'medium', 'auto', 1, 0)
  `,
  ).run(
    TEST_TASK_ID,
    TEST_PROJECT_ID,
    "Add widget feature to dashboard",
    "We need a new widget component on the dashboard page.",
    "Create src/components/Widget.tsx using React and Tailwind.",
  );

  // Insert extra project for isolated tests (aiCommitMode variants, AI run stats)
  db.prepare(
    `
    INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth, aiInstructions)
    VALUES (?, ?, ?, 0, '["TypeScript"]', '[]', 'commit', 3, 'Always write tests.')
  `,
  ).run(EXTRA_PROJECT_ID, "Extra Builder Project", PROJECT_PATH + "/extra-test");

  // Insert a milestone with aiInstructions for the extra project
  db.prepare(
    `
    INSERT OR REPLACE INTO milestones (id, projectId, name, aiInstructions)
    VALUES (?, ?, ?, ?)
  `,
  ).run(MILESTONE_ID, EXTRA_PROJECT_ID, "Test Milestone", "Focus on performance.");
});

afterAll(() => {
  // Clean up test data
  db.prepare("DELETE FROM tasks WHERE projectId IN (?, ?)").run(TEST_PROJECT_ID, EXTRA_PROJECT_ID);
  db.prepare("DELETE FROM milestones WHERE id = ?").run(MILESTONE_ID);
  db.prepare("DELETE FROM task_ai_runs WHERE projectId = ?").run(EXTRA_PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id IN (?, ?)").run(TEST_PROJECT_ID, EXTRA_PROJECT_ID);
});

function getTestTask(): Task {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(TEST_TASK_ID) as any;
  return {
    ...row,
    promptProfile: row.promptProfile ?? "auto",
  } as Task;
}

function _getTestProject(): Project {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(TEST_PROJECT_ID) as any;
  return rowToProject(row);
}

// ============================================================
// buildAnalyzePrompt
// ============================================================

describe("buildAnalyzePrompt", () => {
  test("with valid task, returns non-empty string containing the task title", async () => {
    const task = getTestTask();
    const result = await buildAnalyzePrompt(task, TEST_PROJECT_ID);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("Add widget feature to dashboard");
  });

  test("with non-existent projectId, throws error", async () => {
    const task = getTestTask();
    expect(buildAnalyzePrompt(task, TEST_PROJECT_NONEXISTENT_ID)).rejects.toThrow(
      "Project not found",
    );
  });
});

// ============================================================
// buildAiResolvePrompt
// ============================================================

describe("buildAiResolvePrompt", () => {
  test("with valid task, returns string with project context", async () => {
    const task = getTestTask();
    const result = await buildAiResolvePrompt(task, TEST_PROJECT_ID, TEST_PORT);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should contain the project name
    expect(result).toContain("Test Builder Project");
    // Should contain task title
    expect(result).toContain("Add widget feature to dashboard");
    // Should contain the project path
    expect(result).toContain(PROJECT_PATH);
    // Should contain the port for API calls
    expect(result).toContain(String(TEST_PORT));
  });

  // Knowledge injection wiring: with embeddings disabled the prompt must still
  // build (knowledge block omitted) without throwing, even when the project has
  // embedded artifacts. The block-omission itself is proven deterministically in
  // knowledgeInjection.test.ts ("...never calls embedFn when embeddings disabled").
  // NOTE: this builder embeds the live working-tree git diff, so unique-string
  // absence assertions are unreliable here — we assert non-throwing + built.
  test("builds prompt with embeddings disabled and embedded artifacts present (no throw)", async () => {
    const artifactId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO project_artifacts (id, projectId, filename, type, description, tags, sizeBytes, mimeType, createdAt, updatedAt)
       VALUES (?, ?, 'spec.md', 'document', 'Widget Spec', '[]', 10, 'text/markdown', ?, ?)`,
    ).run(artifactId, TEST_PROJECT_ID, now, now);
    db.prepare(
      `INSERT INTO artifact_embeddings (id, artifactId, projectId, chunkIdx, content, vector, model, dim, createdAt)
       VALUES (?, ?, ?, 0, 'widget design notes', ?, 'fake', 3, ?)`,
    ).run(crypto.randomUUID(), artifactId, TEST_PROJECT_ID, Buffer.from([0, 0, 0, 0]), now);

    process.env.VK_DISABLE_EMBEDDINGS = "1";
    try {
      const task = getTestTask();
      contextCache.clear();
      const result = await buildAiResolvePrompt(task, TEST_PROJECT_ID, TEST_PORT);
      expect(typeof result).toBe("string");
      expect(result).toContain("Add widget feature to dashboard");
    } finally {
      delete process.env.VK_DISABLE_EMBEDDINGS;
      db.prepare("DELETE FROM artifact_embeddings WHERE artifactId = ?").run(artifactId);
      db.prepare("DELETE FROM project_artifacts WHERE id = ?").run(artifactId);
    }
  });
});

// ============================================================
// buildGatherContextPrompt
// ============================================================

describe("buildGatherContextPrompt", () => {
  test("with valid inputs, returns string with task title", async () => {
    const result = await buildGatherContextPrompt(
      "Add widget feature to dashboard",
      "We need a new widget component on the dashboard page.",
      TEST_PROJECT_ID,
    );
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("Add widget feature to dashboard");
    expect(result).toContain("Test Builder Project");
  });

  test("with non-existent projectId, throws error", async () => {
    expect(
      buildGatherContextPrompt("some title", null, TEST_PROJECT_NONEXISTENT_ID),
    ).rejects.toThrow("Project not found");
  });
});

// ============================================================
// buildDecomposePrompt
// ============================================================

describe("buildDecomposePrompt", () => {
  test("with valid task, returns string containing parent task info", async () => {
    const task = getTestTask();
    const result = await buildDecomposePrompt(task, TEST_PROJECT_ID);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should contain the task title as parent task
    expect(result).toContain("Add widget feature to dashboard");
    // Should contain decomposition instructions
    expect(result).toContain("subtask");
  });
});

// ============================================================
// buildAiTestPrompt
// ============================================================

describe("buildAiTestPrompt", () => {
  test("with valid task, returns string containing test agent instructions", async () => {
    const task = getTestTask();
    const result = await buildAiTestPrompt(task, TEST_PROJECT_ID, TEST_PORT);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should contain task title
    expect(result).toContain("Add widget feature to dashboard");
    // Should mention it is a testing agent
    expect(result).toContain("testing agent");
    // Should contain port for API calls
    expect(result).toContain(String(TEST_PORT));
  });
});

// ============================================================
// buildProfileInstructions
// ============================================================

describe("buildProfileInstructions", () => {
  const task = {
    id: TEST_TASK_ID,
    projectId: TEST_PROJECT_ID,
    milestoneId: null,
    parentTaskId: null,
    title: "Test task",
    description: "Test description",
    prompt: null,
    branch: null,
    promptProfile: "auto" as const,
    status: "todo" as const,
    priority: "medium" as const,
    taskNumber: 1,
    sortOrder: 0,
    inboxAt: null,
    inProgressAt: null,
    doneAt: null,
    approvedAt: null,
    archivedAt: null,
    notionPageId: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies Task;

  const project: Project = {
    id: TEST_PROJECT_ID,
    name: "Test Project",
    path: PROJECT_PATH,
    favorite: false,
    category: null,
    techStack: ["TypeScript"],
    externalLinks: [],
    aiCommitMode: "stage",
    defaultBranch: null,
    treeDepth: 3,
    aiInstructions: null,
    notionDatabaseId: null,
    autoSpawnEnabled: false,
    qaAgentPath: null,
    qaAgentPython: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const gitInstruction = "Stage your changes with `git add` but do NOT commit.";

  test("quick-fix profile returns minimal-change instructions", () => {
    const result = buildProfileInstructions("quick-fix", project, task, gitInstruction);
    expect(result).toContain("MINIMAL change");
    expect(result).toContain("quick-fix");
    expect(result).toContain(gitInstruction);
  });

  test("feature profile returns full implementation instructions", () => {
    const result = buildProfileInstructions("feature", project, task, gitInstruction);
    expect(result).toContain("Explore the codebase");
    expect(result).toContain("Plan the implementation");
    expect(result).toContain(gitInstruction);
  });

  test("refactor profile returns no-behavior-change instructions", () => {
    const result = buildProfileInstructions("refactor", project, task, gitInstruction);
    expect(result).toContain("NO behavior changes");
    expect(result).toContain("refactor");
    expect(result).toContain(gitInstruction);
  });

  test("bug-fix profile returns reproduce-and-fix instructions", () => {
    const result = buildProfileInstructions("bug-fix", project, task, gitInstruction);
    expect(result).toContain("Reproduce the bug");
    expect(result).toContain("root cause");
    expect(result).toContain(gitInstruction);
  });

  test("docs profile returns documentation-focused instructions", () => {
    const result = buildProfileInstructions("docs", project, task, gitInstruction);
    expect(result).toContain("documentation");
    expect(result).toContain("Do NOT make code changes");
    expect(result).toContain(gitInstruction);
  });
});

// ============================================================
// buildAnalyzePrompt — projectInstructions + milestoneInstructions
// (covers lines 559, 563: the XML blocks for AI instructions)
// ============================================================

describe("buildAnalyzePrompt - AI instructions in context", () => {
  const AI_TASK_ID = `__test_ai_instruct_task_${crypto.randomUUID()}__`;
  const AI_MILESTONE_ID = `__test_ai_instruct_ms_${crypto.randomUUID()}__`;

  beforeAll(() => {
    // Insert milestone with AI instructions on the extra project
    db.prepare(
      `
      INSERT OR REPLACE INTO milestones (id, projectId, name, aiInstructions)
      VALUES (?, ?, ?, ?)
    `,
    ).run(AI_MILESTONE_ID, EXTRA_PROJECT_ID, "AI Test Milestone", "Only use async/await.");

    // Insert task linked to that milestone
    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, milestoneId, title, description, prompt, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?, 'todo', 'medium', 'feature', 99, 0)
    `,
    ).run(
      AI_TASK_ID,
      EXTRA_PROJECT_ID,
      AI_MILESTONE_ID,
      "Implement async widget",
      "Build an async widget that loads data lazily.",
      "Use React Suspense and lazy loading.",
    );
  });

  afterAll(() => {
    db.prepare("DELETE FROM tasks WHERE id = ?").run(AI_TASK_ID);
    db.prepare("DELETE FROM milestones WHERE id = ?").run(AI_MILESTONE_ID);
  });

  test("includes project_ai_instructions when project.aiInstructions is set", async () => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(AI_TASK_ID) as any;
    const task = { ...taskRow, promptProfile: taskRow.promptProfile ?? "auto" } as Task;

    contextCache.clear();
    const result = await buildAnalyzePrompt(task, EXTRA_PROJECT_ID);
    expect(result).toContain("<project_ai_instructions>");
    expect(result).toContain("Always write tests.");
  });

  test("includes milestone_ai_instructions when task has milestoneId", async () => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(AI_TASK_ID) as any;
    const task = { ...taskRow, promptProfile: taskRow.promptProfile ?? "auto" } as Task;

    contextCache.clear();
    const result = await buildAnalyzePrompt(task, EXTRA_PROJECT_ID);
    expect(result).toContain("<milestone_ai_instructions>");
    expect(result).toContain("Only use async/await.");
  });
});

// ============================================================
// buildAnalyzePrompt — otherTasks with both related and unrelated
// (covers lines 577-587: task line mixing)
// ============================================================

describe("buildAnalyzePrompt - other tasks mixing related and unrelated", () => {
  const MIX_TASK_ID = `__test_mix_task_${crypto.randomUUID()}__`;
  const RELATED_TASK_ID = `__test_related_task_${crypto.randomUUID()}__`;
  const UNRELATED_TASK_ID = `__test_unrelated_task_${crypto.randomUUID()}__`;

  beforeAll(() => {
    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, title, description, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, ?, 'in_progress', 'high', 'feature', 10, 0)
    `,
    ).run(
      MIX_TASK_ID,
      TEST_PROJECT_ID,
      "Add widget component to sidebar",
      "Widget implementation task",
    );

    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, title, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, 'todo', 'medium', 'feature', 11, 1)
    `,
    ).run(RELATED_TASK_ID, TEST_PROJECT_ID, "Refactor widget sidebar layout");

    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, title, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, 'todo', 'low', 'feature', 12, 2)
    `,
    ).run(UNRELATED_TASK_ID, TEST_PROJECT_ID, "Update database schema migrations");
  });

  afterAll(() => {
    db.prepare("DELETE FROM tasks WHERE id IN (?, ?, ?)").run(
      MIX_TASK_ID,
      RELATED_TASK_ID,
      UNRELATED_TASK_ID,
    );
  });

  test("includes both related and unrelated tasks in output", async () => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(MIX_TASK_ID) as any;
    const task = { ...taskRow, promptProfile: taskRow.promptProfile ?? "auto" } as Task;

    contextCache.clear();
    const result = await buildAnalyzePrompt(task, TEST_PROJECT_ID);
    expect(result).toContain("other_active_tasks");
    // Related task should be labeled
    expect(result).toContain("(related)");
    // Unrelated task should appear without the (related) label
    expect(result).toContain("database");
  });
});

// ============================================================
// buildAiResolvePrompt — aiCommitMode branches
// (covers lines 678: "none" mode, 681: "stage" mode)
// ============================================================

describe("buildAiResolvePrompt - aiCommitMode variants", () => {
  const NONE_PROJECT_ID = `__test_commitmode_none_${crypto.randomUUID()}__`;
  const STAGE_PROJECT_ID = `__test_commitmode_stage_${crypto.randomUUID()}__`;
  const NONE_TASK_ID = `__test_commitmode_none_task_${crypto.randomUUID()}__`;
  const STAGE_TASK_ID = `__test_commitmode_stage_task_${crypto.randomUUID()}__`;

  beforeAll(() => {
    // Use unique subpaths to avoid UNIQUE(path) conflicts with other test projects
    db.prepare(
      `
      INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
      VALUES (?, ?, ?, 0, '[]', '[]', 'none', 2)
    `,
    ).run(NONE_PROJECT_ID, "None-commit Project", PROJECT_PATH + "/none-test-" + NONE_PROJECT_ID);

    db.prepare(
      `
      INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
      VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 2)
    `,
    ).run(
      STAGE_PROJECT_ID,
      "Stage-commit Project",
      PROJECT_PATH + "/stage-test-" + STAGE_PROJECT_ID,
    );

    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, title, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, 'todo', 'medium', 'quick-fix', 1, 0)
    `,
    ).run(NONE_TASK_ID, NONE_PROJECT_ID, "Fix typo in header");

    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, title, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, 'todo', 'medium', 'quick-fix', 1, 0)
    `,
    ).run(STAGE_TASK_ID, STAGE_PROJECT_ID, "Fix typo in footer");
  });

  afterAll(() => {
    db.prepare("DELETE FROM tasks WHERE id IN (?, ?)").run(NONE_TASK_ID, STAGE_TASK_ID);
    db.prepare("DELETE FROM projects WHERE id IN (?, ?)").run(NONE_PROJECT_ID, STAGE_PROJECT_ID);
  });

  test("aiCommitMode=none produces 'Do NOT create any git commits' instruction", async () => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(NONE_TASK_ID) as any;
    const task = { ...taskRow, promptProfile: taskRow.promptProfile ?? "auto" } as Task;

    contextCache.clear();
    const result = await buildAiResolvePrompt(task, NONE_PROJECT_ID, TEST_PORT);
    expect(result).toContain("Do NOT create any git commits");
  });

  test("aiCommitMode=stage produces 'Stage your changes' instruction", async () => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(STAGE_TASK_ID) as any;
    const task = { ...taskRow, promptProfile: taskRow.promptProfile ?? "auto" } as Task;

    contextCache.clear();
    const result = await buildAiResolvePrompt(task, STAGE_PROJECT_ID, TEST_PORT);
    expect(result).toContain("Stage your changes with");
    expect(result).toContain("do NOT commit");
  });
});

// ============================================================
// buildAiResolvePrompt — otherTasks mixing + AI run stats
// (covers lines 715-745, 757-758)
// ============================================================

describe("buildAiResolvePrompt - otherTasks and AI run stats", () => {
  const STATS_PROJECT_ID = `__test_stats_proj_${crypto.randomUUID()}__`;
  const STATS_TASK_ID = `__test_stats_task_${crypto.randomUUID()}__`;
  const STATS_MILESTONE_ID = `__test_stats_ms_${crypto.randomUUID()}__`;
  const RELATED2_TASK_ID = `__test_stats_related_${crypto.randomUUID()}__`;
  const UNRELATED2_TASK_ID = `__test_stats_unrelated_${crypto.randomUUID()}__`;

  beforeAll(() => {
    // aiInstructions set so line 714-716 (project_ai_instructions in buildAiResolvePrompt) is covered
    db.prepare(
      `
      INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth, aiInstructions)
      VALUES (?, ?, ?, 0, '["TypeScript"]', '[]', 'commit', 2, 'Always write tests.')
    `,
    ).run(STATS_PROJECT_ID, "Stats Test Project", PROJECT_PATH + "/stats-test-" + STATS_PROJECT_ID);

    // Milestone with aiInstructions so line 718-720 (milestone_ai_instructions) is covered
    db.prepare(
      `
      INSERT OR REPLACE INTO milestones (id, projectId, name, aiInstructions)
      VALUES (?, ?, ?, ?)
    `,
    ).run(STATS_MILESTONE_ID, STATS_PROJECT_ID, "Stats Milestone", "Prefer functional components.");

    // Task with feature profile (includes otherTasks).
    // Description must be >= 100 chars (no prompt) to get medium complexity and includeOtherTasks=true.
    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, milestoneId, title, description, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, ?, ?, 'in_progress', 'high', 'feature', 1, 0)
    `,
    ).run(
      STATS_TASK_ID,
      STATS_PROJECT_ID,
      STATS_MILESTONE_ID,
      "Add widget component",
      "Build a widget feature that loads data lazily using React Suspense. The widget should support multiple data sources and graceful error boundaries.",
    );

    // Related task (keyword overlap with "widget component")
    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, title, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, 'todo', 'medium', 'feature', 2, 1)
    `,
    ).run(RELATED2_TASK_ID, STATS_PROJECT_ID, "Test widget component rendering");

    // Unrelated task
    db.prepare(
      `
      INSERT OR REPLACE INTO tasks (id, projectId, title, status, priority, promptProfile, taskNumber, sortOrder)
      VALUES (?, ?, ?, 'todo', 'low', 'feature', 3, 2)
    `,
    ).run(UNRELATED2_TASK_ID, STATS_PROJECT_ID, "Database migration scripts cleanup");

    // Insert AI run stats
    const aiRunId1 = crypto.randomUUID();
    const aiRunId2 = crypto.randomUUID();
    db.prepare(
      `
      INSERT INTO task_ai_runs (id, taskId, projectId, profile, complexity, success, exitCode)
      VALUES (?, ?, ?, 'feature', 'medium', 1, 0)
    `,
    ).run(aiRunId1, STATS_TASK_ID, STATS_PROJECT_ID);
    db.prepare(
      `
      INSERT INTO task_ai_runs (id, taskId, projectId, profile, complexity, success, exitCode)
      VALUES (?, ?, ?, 'feature', 'medium', 0, 1)
    `,
    ).run(aiRunId2, STATS_TASK_ID, STATS_PROJECT_ID);
  });

  afterAll(() => {
    db.prepare("DELETE FROM task_ai_runs WHERE projectId = ?").run(STATS_PROJECT_ID);
    db.prepare("DELETE FROM tasks WHERE projectId = ?").run(STATS_PROJECT_ID);
    db.prepare("DELETE FROM milestones WHERE id = ?").run(STATS_MILESTONE_ID);
    db.prepare("DELETE FROM projects WHERE id = ?").run(STATS_PROJECT_ID);
  });

  test("includes both related and unrelated tasks in other_active_tasks", async () => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(STATS_TASK_ID) as any;
    const task = { ...taskRow, promptProfile: "feature" } as Task;

    contextCache.clear();
    const result = await buildAiResolvePrompt(task, STATS_PROJECT_ID, TEST_PORT);
    expect(result).toContain("other_active_tasks");
    expect(result).toContain("(related)");
    // The unrelated task title should also appear
    expect(result).toContain("Database migration");
  });

  test("includes ai_run_history when project has AI run stats", async () => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(STATS_TASK_ID) as any;
    const task = { ...taskRow, promptProfile: "feature" } as Task;

    contextCache.clear();
    const result = await buildAiResolvePrompt(task, STATS_PROJECT_ID, TEST_PORT);
    expect(result).toContain("ai_run_history");
    expect(result).toContain("Previous AI runs on this project");
    expect(result).toContain("2 total");
  });
});
