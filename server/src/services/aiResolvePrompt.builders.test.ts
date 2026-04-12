import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb } from "../db";
import {
  buildAnalyzePrompt,
  buildAiResolvePrompt,
  buildGatherContextPrompt,
  buildDecomposePrompt,
  buildAiTestPrompt,
  buildProfileInstructions,
  rowToProject,
} from "./aiResolvePrompt";
import type { Task, Project } from "@vibe-kanban/shared";

// Use the Vibe-Kanban project root as a real directory for filesystem-based context
const PROJECT_PATH = "/home/ivanf/projects/Vibe-Kanban";

const TEST_PROJECT_ID = "__test_builder_proj__";
const TEST_TASK_ID = "__test_builder_task__";
const TEST_TASK_NONEXISTENT_ID = "__test_builder_no_such_task__";
const TEST_PROJECT_NONEXISTENT_ID = "__test_builder_no_such_proj__";
const TEST_PORT = 3099;

let db: ReturnType<typeof getDb>;

beforeAll(() => {
  db = getDb();

  // Insert test project
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
    VALUES (?, ?, ?, 0, '["TypeScript","React"]', '[]', 'stage', 3)
  `).run(TEST_PROJECT_ID, "Test Builder Project", PROJECT_PATH);

  // Insert test task
  db.prepare(`
    INSERT OR REPLACE INTO tasks (id, projectId, title, description, prompt, status, priority, promptProfile, taskNumber, sortOrder)
    VALUES (?, ?, ?, ?, ?, 'todo', 'medium', 'auto', 1, 0)
  `).run(
    TEST_TASK_ID,
    TEST_PROJECT_ID,
    "Add widget feature to dashboard",
    "We need a new widget component on the dashboard page.",
    "Create src/components/Widget.tsx using React and Tailwind.",
  );
});

afterAll(() => {
  // Clean up test data
  db.prepare("DELETE FROM tasks WHERE id = ?").run(TEST_TASK_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(TEST_PROJECT_ID);
});

function getTestTask(): Task {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(TEST_TASK_ID) as any;
  return {
    ...row,
    promptProfile: row.promptProfile ?? "auto",
  } as Task;
}

function getTestProject(): Project {
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
    expect(buildAnalyzePrompt(task, TEST_PROJECT_NONEXISTENT_ID)).rejects.toThrow("Project not found");
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
    treeDepth: 3,
    aiInstructions: null,
    notionDatabaseId: null,
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
