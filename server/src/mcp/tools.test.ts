import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb } from "../db";
import {
  listProjects,
  getProject,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getAllTasks,
  listArtifacts,
  readArtifact,
  listGraphNodes,
  tools,
  toolMap,
} from "./tools";
import { getProjectArtifactsDir } from "../lib/data-dir";
import fs from "node:fs";
import path from "node:path";

const TEST_PROJECT_ID = crypto.randomUUID();
const GIT_PROJECT_ID = crypto.randomUUID();
const TEST_TASK_ID = crypto.randomUUID();
const TEST_PROJECT_NAME = `__test_project_${Date.now()}`;
const GIT_PROJECT_NAME = `__test_git_project_${Date.now()}`;
const TEST_TASK_TITLE = `__test_task_${Date.now()}`;

// Track IDs created by createTask so we can clean them up
const createdTaskIds: string[] = [];

// Resolve the repo root (parent of server/)
const REPO_ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");

beforeAll(() => {
  const db = getDb();

  db.query(
    "INSERT INTO projects (id, name, path, techStack, favorite) VALUES (?, ?, ?, ?, ?)"
  ).run(TEST_PROJECT_ID, TEST_PROJECT_NAME, `/tmp/test-project-${Date.now()}`, '["TypeScript","Bun"]', 1);

  // Project pointing at the real git repo for gitStatus / gitDiff tests
  db.query(
    "INSERT INTO projects (id, name, path, techStack, favorite) VALUES (?, ?, ?, ?, ?)"
  ).run(GIT_PROJECT_ID, GIT_PROJECT_NAME, REPO_ROOT, '["TypeScript","Bun"]', 0);

  const now = new Date().toISOString();
  db.query(
    "INSERT INTO tasks (id, projectId, title, description, status, priority, sortOrder, createdAt, updatedAt, inboxAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(TEST_TASK_ID, TEST_PROJECT_ID, TEST_TASK_TITLE, "Test description", "backlog", "medium", 1, now, now, now);
});

afterAll(() => {
  const db = getDb();
  // Clean up tasks created during tests (including the seeded one)
  for (const id of [TEST_TASK_ID, ...createdTaskIds]) {
    db.query("DELETE FROM tasks WHERE id = ?").run(id);
  }
  db.query("DELETE FROM projects WHERE id = ?").run(TEST_PROJECT_ID);
  db.query("DELETE FROM projects WHERE id = ?").run(GIT_PROJECT_ID);
});

describe("MCP tools - listProjects", () => {
  test("returns an array", () => {
    const result = listProjects() as any[];
    expect(Array.isArray(result)).toBe(true);
  });

  test("includes the test project", () => {
    const result = listProjects() as any[];
    const found = result.find((p: any) => p.id === TEST_PROJECT_ID);
    expect(found).toBeDefined();
    expect(found.name).toBe(TEST_PROJECT_NAME);
  });

  test("has correct shape (id, name, path, techStack, favorite)", () => {
    const result = listProjects() as any[];
    const found = result.find((p: any) => p.id === TEST_PROJECT_ID);
    expect(found).toBeDefined();
    expect(typeof found.id).toBe("string");
    expect(typeof found.name).toBe("string");
    expect(typeof found.path).toBe("string");
    expect(Array.isArray(found.techStack)).toBe(true);
    expect(typeof found.favorite).toBe("boolean");
    expect(found.favorite).toBe(true);
    expect(found.techStack).toEqual(["TypeScript", "Bun"]);
  });
});

describe("MCP tools - getProject", () => {
  test("returns project by ID", () => {
    const result = getProject({ projectId: TEST_PROJECT_ID }) as any;
    expect(result.id).toBe(TEST_PROJECT_ID);
    expect(result.name).toBe(TEST_PROJECT_NAME);
    expect(Array.isArray(result.techStack)).toBe(true);
  });

  test("returns error for non-existent ID", () => {
    const result = getProject({ projectId: "non-existent-id" }) as any;
    expect(result.error).toBe("Project not found");
  });
});

describe("MCP tools - listTasks", () => {
  test("returns tasks for the test project", () => {
    const result = listTasks({ projectId: TEST_PROJECT_ID }) as any[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const found = result.find((t: any) => t.id === TEST_TASK_ID);
    expect(found).toBeDefined();
    expect(found.title).toBe(TEST_TASK_TITLE);
  });

  test("returns empty array for non-existent project", () => {
    const result = listTasks({ projectId: "non-existent-project" }) as any[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  test("filters by status", () => {
    const backlog = listTasks({ projectId: TEST_PROJECT_ID, status: "backlog" }) as any[];
    expect(backlog.length).toBeGreaterThanOrEqual(1);

    const inProgress = listTasks({ projectId: TEST_PROJECT_ID, status: "in_progress" }) as any[];
    // Our test task is "backlog", so in_progress should not include it
    const found = inProgress.find((t: any) => t.id === TEST_TASK_ID);
    expect(found).toBeUndefined();
  });
});

describe("MCP tools - getTask", () => {
  test("returns task by ID", () => {
    const result = getTask({ taskId: TEST_TASK_ID }) as any;
    expect(result.id).toBe(TEST_TASK_ID);
    expect(result.title).toBe(TEST_TASK_TITLE);
    expect(result.description).toBe("Test description");
    expect(result.status).toBe("backlog");
    expect(result.priority).toBe("medium");
  });

  test("returns error for non-existent ID", () => {
    const result = getTask({ taskId: "non-existent-task" }) as any;
    expect(result.error).toBe("Task not found");
  });
});

describe("MCP tools - createTask", () => {
  test("creates a task and returns it with an ID", () => {
    const result = createTask({
      projectId: TEST_PROJECT_ID,
      title: "Created via test",
      description: "Test create description",
      status: "todo",
      priority: "high",
    }) as any;

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.title).toBe("Created via test");
    createdTaskIds.push(result.id);

    // Verify it exists in DB
    const fetched = getTask({ taskId: result.id }) as any;
    expect(fetched.title).toBe("Created via test");
    expect(fetched.status).toBe("todo");
    expect(fetched.priority).toBe("high");
  });

  test("uses default status and priority when not provided", () => {
    const result = createTask({
      projectId: TEST_PROJECT_ID,
      title: "Defaults test",
    }) as any;

    expect(result.id).toBeDefined();
    createdTaskIds.push(result.id);

    const fetched = getTask({ taskId: result.id }) as any;
    expect(fetched.status).toBe("backlog");
    expect(fetched.priority).toBe("medium");
  });
});

describe("MCP tools - updateTask", () => {
  test("updates title", () => {
    const result = updateTask({
      taskId: TEST_TASK_ID,
      title: "Updated title",
    }) as any;
    expect(result.updated).toBe(true);

    const fetched = getTask({ taskId: TEST_TASK_ID }) as any;
    expect(fetched.title).toBe("Updated title");
  });

  test("updates status", () => {
    const result = updateTask({
      taskId: TEST_TASK_ID,
      status: "in_progress",
    }) as any;
    expect(result.updated).toBe(true);

    const fetched = getTask({ taskId: TEST_TASK_ID }) as any;
    expect(fetched.status).toBe("in_progress");
  });

  test("returns error when no fields provided", () => {
    const result = updateTask({ taskId: TEST_TASK_ID }) as any;
    expect(result.error).toBe("No fields to update");
  });
});

describe("MCP tools - deleteTask", () => {
  test("removes a task and verifies it is gone", () => {
    // Create a task to delete
    const created = createTask({
      projectId: TEST_PROJECT_ID,
      title: "Task to delete",
    }) as any;
    expect(created.id).toBeDefined();

    // Delete it
    const result = deleteTask({ taskId: created.id }) as any;
    expect(result.deleted).toBe(true);

    // Verify it's gone
    const fetched = getTask({ taskId: created.id }) as any;
    expect(fetched.error).toBe("Task not found");
  });
});

describe("MCP tools - getAllTasks", () => {
  test("returns tasks across all projects", () => {
    const result = getAllTasks({}) as any[];
    expect(Array.isArray(result)).toBe(true);
    // Should include our test task (which was updated to in_progress above)
    const found = result.find((t: any) => t.id === TEST_TASK_ID);
    expect(found).toBeDefined();
    expect(found.projectName).toBe(TEST_PROJECT_NAME);
  });

  test("each task has projectName from the JOIN", () => {
    const result = getAllTasks({}) as any[];
    for (const task of result) {
      expect(typeof task.projectName).toBe("string");
      expect(typeof task.id).toBe("string");
      expect(typeof task.title).toBe("string");
    }
  });
});

describe("MCP tools - getTools (tool definitions)", () => {
  test("returns an array of tool definitions", () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  test("each tool has definition and handler", () => {
    for (const tool of tools) {
      expect(tool.definition).toBeDefined();
      expect(typeof tool.definition.name).toBe("string");
      expect(typeof tool.definition.description).toBe("string");
      expect(tool.definition.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe("function");
    }
  });

  test("includes expected tool names", () => {
    const names = tools.map((t) => t.definition.name);
    expect(names).toContain("list_projects");
    expect(names).toContain("get_project");
    expect(names).toContain("list_tasks");
    expect(names).toContain("get_task");
    expect(names).toContain("create_task");
    expect(names).toContain("update_task");
    expect(names).toContain("delete_task");
    expect(names).toContain("get_all_tasks");
    expect(names).toContain("git_status");
    expect(names).toContain("git_diff");
    expect(names).toContain("list_artifacts");
    expect(names).toContain("read_artifact");
    expect(names).toContain("list_graph_nodes");
  });
});

describe("MCP tools - listArtifacts", () => {
  const artifactId = crypto.randomUUID();

  beforeAll(() => {
    const db = getDb();
    const now = new Date().toISOString();
    db.query(
      "INSERT INTO project_artifacts (id, projectId, filename, type, tags, sizeBytes, mimeType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(artifactId, TEST_PROJECT_ID, "test-doc.md", "document", '["test"]', 100, "text/markdown", now, now);

    // Create file on disk
    const dir = getProjectArtifactsDir(TEST_PROJECT_ID);
    fs.writeFileSync(path.join(dir, artifactId + ".md"), "# Test content");
  });

  afterAll(() => {
    const db = getDb();
    db.query("DELETE FROM project_artifacts WHERE id = ?").run(artifactId);
  });

  test("returns artifacts for project", () => {
    const result = listArtifacts({ projectId: TEST_PROJECT_ID }) as any[];
    expect(Array.isArray(result)).toBe(true);
    const found = result.find((a: any) => a.id === artifactId);
    expect(found).toBeDefined();
    expect(found.filename).toBe("test-doc.md");
    expect(found.tags).toEqual(["test"]);
  });

  test("returns empty for non-existent project", () => {
    const result = listArtifacts({ projectId: "nonexistent" }) as any[];
    expect(result).toEqual([]);
  });
});

describe("MCP tools - readArtifact", () => {
  const artifactId = crypto.randomUUID();

  beforeAll(() => {
    const db = getDb();
    const now = new Date().toISOString();
    db.query(
      "INSERT INTO project_artifacts (id, projectId, filename, type, tags, sizeBytes, mimeType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(artifactId, TEST_PROJECT_ID, "readable.md", "document", '[]', 50, "text/markdown", now, now);

    const dir = getProjectArtifactsDir(TEST_PROJECT_ID);
    fs.writeFileSync(path.join(dir, artifactId + ".md"), "# Readable content");
  });

  afterAll(() => {
    const db = getDb();
    db.query("DELETE FROM project_artifacts WHERE id = ?").run(artifactId);
  });

  test("reads text artifact content", () => {
    const result = readArtifact({ artifactId }) as any;
    expect(result.content).toBe("# Readable content");
    expect(result.filename).toBe("readable.md");
  });

  test("returns error for non-existent artifact", () => {
    const result = readArtifact({ artifactId: "nonexistent" }) as any;
    expect(result.error).toBeDefined();
  });
});

describe("MCP tools - listGraphNodes", () => {
  const nodeId = crypto.randomUUID();

  beforeAll(() => {
    const db = getDb();
    const now = new Date().toISOString();
    db.query(
      "INSERT INTO project_graph_nodes (id, projectId, label, type, metadata, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(nodeId, TEST_PROJECT_ID, "Test Node", "concept", '{}', now, now);
  });

  afterAll(() => {
    const db = getDb();
    db.query("DELETE FROM project_graph_nodes WHERE id = ?").run(nodeId);
  });

  test("returns nodes and edges", () => {
    const result = listGraphNodes({ projectId: TEST_PROJECT_ID }) as any;
    expect(result.nodes).toBeInstanceOf(Array);
    expect(result.edges).toBeInstanceOf(Array);
    const found = result.nodes.find((n: any) => n.id === nodeId);
    expect(found).toBeDefined();
    expect(found.label).toBe("Test Node");
  });

  test("returns empty for non-existent project", () => {
    const result = listGraphNodes({ projectId: "nonexistent" }) as any;
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

describe("MCP tools - gitStatus (via toolMap)", () => {
  test("returns projectPath for a project with a valid git repo", () => {
    const handler = toolMap.get("git_status")!.handler;
    const result = handler({ projectId: GIT_PROJECT_ID }) as any;
    expect(result.projectPath).toBe(REPO_ROOT);
    expect(result.note).toContain("git CLI");
  });

  test("returns error for non-existent project", () => {
    const handler = toolMap.get("git_status")!.handler;
    const result = handler({ projectId: "non-existent-id" }) as any;
    expect(result.error).toBe("Project not found");
  });
});

describe("MCP tools - gitDiff (via toolMap)", () => {
  test("returns diff output for a project with a valid git repo", async () => {
    const handler = toolMap.get("git_diff")!.handler;
    const result = (await handler({ projectId: GIT_PROJECT_ID })) as any;
    // Should have either a diff string or "(no changes)"
    expect(typeof result.diff === "string" || typeof result.stat === "string").toBe(true);
  });

  test("returns { diff } string for a small diff (<=300 lines)", async () => {
    // Create a temp repo with a tiny change so the diff is well under 300 lines
    const db = getDb();
    const { execSync } = await import("node:child_process");
    const fs = await import("node:fs");
    const tinyRepoDir = `/tmp/tiny-diff-${Date.now()}`;
    fs.mkdirSync(tinyRepoDir, { recursive: true });
    execSync("git init", { cwd: tinyRepoDir });
    execSync('git config user.email "t@t.com"', { cwd: tinyRepoDir });
    execSync('git config user.name "T"', { cwd: tinyRepoDir });
    fs.writeFileSync(`${tinyRepoDir}/hello.txt`, "hello\n");
    execSync("git add hello.txt", { cwd: tinyRepoDir });
    execSync('git commit -m "base"', { cwd: tinyRepoDir });
    // One-line change
    fs.writeFileSync(`${tinyRepoDir}/hello.txt`, "hello world\n");

    const tinyProjectId = crypto.randomUUID();
    db.query(
      "INSERT INTO projects (id, name, path, techStack, favorite) VALUES (?, ?, ?, ?, ?)"
    ).run(tinyProjectId, `__tiny_diff_${Date.now()}`, tinyRepoDir, "[]", 0);

    try {
      const handler = toolMap.get("git_diff")!.handler;
      const result = (await handler({ projectId: tinyProjectId })) as any;
      expect(typeof result.diff).toBe("string");
      expect(result.stat).toBeUndefined();
    } finally {
      db.query("DELETE FROM projects WHERE id = ?").run(tinyProjectId);
      fs.rmSync(tinyRepoDir, { recursive: true, force: true });
    }
  });

  test("returns error for non-existent project", async () => {
    const handler = toolMap.get("git_diff")!.handler;
    const result = (await handler({ projectId: "non-existent-id" })) as any;
    expect(result.error).toBe("Project not found");
  });

  test("returns stat-only response when diff output exceeds 300 lines", async () => {
    // Create a temp git repo with enough staged changes to produce >300 diff lines
    const largeRepoDir = `/tmp/large-diff-test-${Date.now()}`;
    const { execSync } = await import("node:child_process");
    const fs = await import("node:fs");
    fs.mkdirSync(largeRepoDir, { recursive: true });
    execSync("git init", { cwd: largeRepoDir });
    execSync('git config user.email "t@t.com"', { cwd: largeRepoDir });
    execSync('git config user.name "T"', { cwd: largeRepoDir });

    // Commit a base file
    const baseLines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    fs.writeFileSync(`${largeRepoDir}/big.txt`, baseLines);
    execSync("git add big.txt", { cwd: largeRepoDir });
    execSync('git commit -m "base"', { cwd: largeRepoDir });

    // Now replace with 400+ lines so git diff HEAD produces >300 lines
    const newLines = Array.from({ length: 400 }, (_, i) => `new line ${i}`).join("\n");
    fs.writeFileSync(`${largeRepoDir}/big.txt`, newLines);

    // Insert a project pointing to this repo
    const db = getDb();
    const largeProjectId = crypto.randomUUID();
    db.query(
      "INSERT INTO projects (id, name, path, techStack, favorite) VALUES (?, ?, ?, ?, ?)"
    ).run(largeProjectId, `__large_diff_${Date.now()}`, largeRepoDir, "[]", 0);

    try {
      const handler = toolMap.get("git_diff")!.handler;
      const result = (await handler({ projectId: largeProjectId })) as any;
      // Should return stat-only because diff > 300 lines
      expect(typeof result.stat).toBe("string");
      expect(result.note).toContain("showing stat only");
    } finally {
      db.query("DELETE FROM projects WHERE id = ?").run(largeProjectId);
      fs.rmSync(largeRepoDir, { recursive: true, force: true });
    }
  });

  test("returns error when git diff command fails (non-zero exit)", async () => {
    // Point a project at a non-git directory so git diff HEAD fails
    const db = getDb();
    const badProjectId = crypto.randomUUID();
    const nonGitDir = `/tmp/non-git-${Date.now()}`;
    const fs = await import("node:fs");
    fs.mkdirSync(nonGitDir, { recursive: true });
    db.query(
      "INSERT INTO projects (id, name, path, techStack, favorite) VALUES (?, ?, ?, ?, ?)"
    ).run(badProjectId, `__bad_git_${Date.now()}`, nonGitDir, "[]", 0);

    try {
      const handler = toolMap.get("git_diff")!.handler;
      const result = (await handler({ projectId: badProjectId })) as any;
      // git diff HEAD on a non-git dir will fail with non-zero exit
      expect(result.error).toBeDefined();
    } finally {
      db.query("DELETE FROM projects WHERE id = ?").run(badProjectId);
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  test("returns error when spawn throws (catch branch)", async () => {
    // Point a project at a path that doesn't exist so spawn throws
    const db = getDb();
    const throwProjectId = crypto.randomUUID();
    db.query(
      "INSERT INTO projects (id, name, path, techStack, favorite) VALUES (?, ?, ?, ?, ?)"
    ).run(throwProjectId, `__throw_git_${Date.now()}`, "/nonexistent/path/that/cannot/exist/ever", "[]", 0);

    try {
      const handler = toolMap.get("git_diff")!.handler;
      const result = (await handler({ projectId: throwProjectId })) as any;
      // spawn with a bad cwd may either fail with non-zero exit or throw
      // Either way we get an error field back
      expect(result.error).toBeDefined();
    } finally {
      db.query("DELETE FROM projects WHERE id = ?").run(throwProjectId);
    }
  });
});
