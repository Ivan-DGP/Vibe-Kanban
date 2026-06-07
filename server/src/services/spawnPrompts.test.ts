import { describe, test, expect } from "bun:test";
import type { Task, Project } from "@vibe-kanban/shared";
import { buildQaTestPrompt, buildDevFixPrompt } from "./spawnPrompts";

const baseProject: Project = {
  id: "proj-1",
  name: "Acme",
  path: "/home/dev/acme",
  category: null,
  description: null,
  techStack: [],
  externalLinks: [],
  favorite: false,
  aiCommitMode: "off",
  notionDatabaseId: null,
  treeDepth: null,
  aiInstructions: null,
  qaAgentPath: null,
  qaAgentPython: null,
  autoSpawnEnabled: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as unknown as Project;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "QA: login flow",
    description: null,
    prompt: null,
    branch: null,
    promptProfile: "auto",
    status: "todo",
    priority: "medium",
    taskNumber: 1,
    sortOrder: 0,
    inboxAt: null,
    inProgressAt: null,
    doneAt: null,
    approvedAt: null,
    archivedAt: null,
    milestoneId: null,
    parentTaskId: null,
    notionPageId: null,
    metadata: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Task;
}

describe("buildQaTestPrompt", () => {
  test("renders system header + parameters", () => {
    const out = buildQaTestPrompt({
      task: makeTask(),
      project: baseProject,
    });
    expect(out).toContain("Autonomous QA Testing Agent");
    expect(out).toContain("## Test Parameters");
    expect(out).toContain("Task ID: task-1");
    expect(out).toContain("Project: Acme (proj-1)");
    // Title is fenced as untrusted data (prompt-injection neutralization)
    expect(out).toContain(
      "<<<UNTRUSTED_TASK_TITLE>>>\nQA: login flow\n<<<END_UNTRUSTED_TASK_TITLE>>>",
    );
    expect(out).toContain("Headless: true");
  });

  test("uses scenario when metadata.qa_scenario is present", () => {
    const out = buildQaTestPrompt({
      task: makeTask({ metadata: { qa_scenario: "login-test" } }),
      project: baseProject,
    });
    expect(out).toContain('scenario_name="login-test"');
    // Scenario is fenced as untrusted data
    expect(out).toContain(
      "<<<UNTRUSTED_QA_SCENARIO>>>\nlogin-test\n<<<END_UNTRUSTED_QA_SCENARIO>>>",
    );
  });

  test("uses url + task fallback when only target_url is set", () => {
    const out = buildQaTestPrompt({
      task: makeTask({
        description: "click sign-in",
        metadata: { qa_target_url: "https://app.test/" },
      }),
      project: baseProject,
    });
    expect(out).toContain('url="https://app.test/"');
    expect(out).toContain('task="click sign-in"');
    // Target URL is fenced as untrusted data
    expect(out).toContain(
      "<<<UNTRUSTED_QA_TARGET_URL>>>\nhttps://app.test/\n<<<END_UNTRUSTED_QA_TARGET_URL>>>",
    );
  });

  test("escapes embedded quotes in task description", () => {
    const out = buildQaTestPrompt({
      task: makeTask({
        description: 'click "Sign In"',
        metadata: { qa_target_url: "https://app.test/" },
      }),
      project: baseProject,
    });
    expect(out).toContain('task="click \\"Sign In\\""');
  });

  test("includes failure-path instructions to spawn dev-fix task", () => {
    const out = buildQaTestPrompt({
      task: makeTask(),
      project: baseProject,
    });
    expect(out).toContain('type: "dev-fix"');
    expect(out).toContain('parent_task: "task-1"');
    expect(out).toContain('projectId="proj-1"');
    expect(out).toContain("create_task");
    expect(out).toContain("update_task");
  });

  test("falls back to scenario hint when neither scenario nor url is set", () => {
    const out = buildQaTestPrompt({
      task: makeTask(),
      project: baseProject,
    });
    expect(out).toContain("using the task title as the scenario hint");
  });
});

describe("buildDevFixPrompt", () => {
  const bugMeta = {
    type: "dev-fix",
    parent_task: "qa-99",
    qa_task_id: "qa-99",
    bug_report: {
      summary: "Login button does nothing",
      steps: ["Open /login", "Click Sign In"],
      expected: "redirect to /home",
      actual: "no navigation occurs",
      severity: "high",
      affected_files: ["client/src/pages/Login.tsx"],
    },
  };

  test("renders system header + project + task ids", () => {
    const out = buildDevFixPrompt({
      task: makeTask({ id: "fix-1", metadata: bugMeta }),
      project: baseProject,
    });
    expect(out).toContain("Autonomous Dev Fix Agent");
    expect(out).toContain("Task ID: fix-1");
    expect(out).toContain("Project: Acme (proj-1)");
    expect(out).toContain("Project path: /home/dev/acme");
    expect(out).toContain("Originating QA task: qa-99");
  });

  test("renders structured bug_report when provided", () => {
    const out = buildDevFixPrompt({
      task: makeTask({ metadata: bugMeta }),
      project: baseProject,
    });
    expect(out).toContain("Summary: Login button does nothing");
    expect(out).toContain("Expected: redirect to /home");
    expect(out).toContain("Actual: no navigation occurs");
    expect(out).toContain("Severity: high");
    expect(out).toContain("1. Open /login");
    expect(out).toContain("2. Click Sign In");
    expect(out).toContain("client/src/pages/Login.tsx");
  });

  test("falls back to a notice when bug_report is empty", () => {
    const out = buildDevFixPrompt({
      task: makeTask({ metadata: { type: "dev-fix" } }),
      project: baseProject,
    });
    expect(out).toContain("(No structured bug report");
  });

  test("instructs creating a re-QA task with type=qa-test", () => {
    const out = buildDevFixPrompt({
      task: makeTask({ id: "fix-1", metadata: bugMeta }),
      project: baseProject,
    });
    expect(out).toContain('type: "qa-test"');
    expect(out).toContain('parent_task: "fix-1"');
    expect(out).toContain("Re-QA:");
    expect(out).toContain("create_task");
    expect(out).toContain("update_task");
  });

  test("required steps list runs from investigate to re-QA", () => {
    const out = buildDevFixPrompt({
      task: makeTask({ metadata: bugMeta }),
      project: baseProject,
    });
    expect(out).toContain("1. Investigate");
    expect(out).toContain("3. Run the project's test suite");
    expect(out).toContain("4. Commit");
    expect(out).toContain("5. Use `vibe-kanban` MCP `update_task`");
    expect(out).toContain("6. Use `vibe-kanban` MCP `create_task`");
  });
});
