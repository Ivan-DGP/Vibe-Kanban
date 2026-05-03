import type { Task, Project } from "@vibe-kanban/shared";

interface QaMetadata {
  qa_scenario?: string;
  qa_target_url?: string;
  parent_task?: string;
}

interface BugReport {
  summary?: string;
  steps?: string[];
  expected?: string;
  actual?: string;
  severity?: string;
  affected_files?: string[];
}

interface DevFixMetadata {
  bug_report?: BugReport;
  parent_task?: string;
  qa_task_id?: string;
}

const QA_SYSTEM_PROMPT = `# Autonomous QA Testing Agent

You are an autonomous QA testing agent. You have two MCP servers available:
- \`qa-agent\` — browser tools (start_qa_session, generate_report, stop_browser, etc.)
- \`vibe-kanban\` — task board API (get_task, update_task, create_task)

Run the test described below in headless mode, capture findings, then report
results back to the Kanban board via the vibe-kanban MCP. Do NOT ask for
confirmation. Do NOT request permissions. Make decisions and act.`;

const DEV_FIX_SYSTEM_PROMPT = `# Autonomous Dev Fix Agent

You are an autonomous developer fixing a bug that QA just found. You have
the \`vibe-kanban\` MCP available (get_task, update_task, create_task).

You will:
1. Read the bug_report from this task's metadata.
2. Investigate and fix the bug in the codebase.
3. Run the project's tests; iterate until they pass.
4. Commit the fix with a clear message.
5. Update this task to status="done" with a short summary in description.
6. Create a follow-up re-QA task in the same project that re-runs the
   original QA scenario, with metadata.type = "qa-test" and
   metadata.parent_task set to this task's id.

Do NOT ask for confirmation. Do NOT request permissions.`;

export function buildQaTestPrompt(ctx: { task: Task; project: Project }): string {
  const { task, project } = ctx;
  const meta = (task.metadata || {}) as QaMetadata;
  const scenario = meta.qa_scenario?.trim() || "";
  const targetUrl = meta.qa_target_url?.trim() || "";

  const lines: string[] = [QA_SYSTEM_PROMPT, ""];

  lines.push("## Test Parameters");
  lines.push(`- Task ID: ${task.id}`);
  lines.push(`- Project: ${project.name} (${project.id})`);
  lines.push(`- Title: ${task.title}`);
  if (scenario) lines.push(`- Scenario: ${scenario}`);
  if (targetUrl) lines.push(`- Target URL: ${targetUrl}`);
  if (task.description) lines.push(`- Description: ${task.description}`);
  lines.push("- Headless: true");
  lines.push("");

  lines.push("## Steps");
  if (scenario) {
    lines.push(
      `1. Call \`start_qa_session\` with scenario_name="${scenario}" headless=true.`,
    );
  } else if (targetUrl) {
    const taskText = (task.description || task.title).replace(/"/g, '\\"');
    lines.push(
      `1. Call \`start_qa_session\` with url="${targetUrl}" task="${taskText}" headless=true.`,
    );
  } else {
    lines.push(
      "1. Call `start_qa_session` using the task title as the scenario hint.",
    );
  }
  lines.push("2. Execute the scenario, capturing every unexpected finding.");
  lines.push("3. Call `generate_report` and then `stop_browser`.");
  lines.push("");

  lines.push("## Reporting Back");
  lines.push("");
  lines.push("If the test PASSES (no unexpected findings):");
  lines.push("- Use the `vibe-kanban` MCP tool `update_task` with:");
  lines.push(`  - taskId="${task.id}"`);
  lines.push(`  - status="done"`);
  lines.push(`  - description containing the verdict and counts`);
  lines.push("");
  lines.push("If the test FAILS (any unexpected finding):");
  lines.push("- Update this task to status=\"done\" and write a verdict summary in description.");
  lines.push("- Then call `vibe-kanban` MCP `create_task` to spawn a dev-fix task with:");
  lines.push(`  - projectId="${project.id}"`);
  lines.push(`  - title="Fix: <short failure summary>"`);
  lines.push(`  - status="todo"`);
  lines.push(`  - priority="high"`);
  lines.push(`  - metadata={`);
  lines.push(`      type: "dev-fix",`);
  lines.push(`      parent_task: "${task.id}",`);
  lines.push(`      qa_task_id: "${task.id}",`);
  lines.push(`      bug_report: {`);
  lines.push(`        summary: "<one-line summary>",`);
  lines.push(`        steps: ["<reproduction step 1>", "<step 2>"],`);
  lines.push(`        expected: "<what should happen>",`);
  lines.push(`        actual: "<what actually happened>",`);
  lines.push(`        severity: "<low|medium|high>"`);
  lines.push(`      }`);
  lines.push(`    }`);
  lines.push("");
  lines.push("The dev-fix task will be picked up automatically by another");
  lines.push("Claude session — you do NOT need to invoke it yourself.");

  return lines.join("\n");
}

export function buildDevFixPrompt(ctx: { task: Task; project: Project }): string {
  const { task, project } = ctx;
  const meta = (task.metadata || {}) as DevFixMetadata;
  const bug = meta.bug_report || {};
  const qaTaskId = meta.qa_task_id || meta.parent_task || "";

  const lines: string[] = [DEV_FIX_SYSTEM_PROMPT, ""];

  lines.push("## This Task");
  lines.push(`- Task ID: ${task.id}`);
  lines.push(`- Project: ${project.name} (${project.id})`);
  lines.push(`- Project path: ${project.path}`);
  lines.push(`- Title: ${task.title}`);
  if (task.description) lines.push(`- Description: ${task.description}`);
  if (qaTaskId) lines.push(`- Originating QA task: ${qaTaskId}`);
  lines.push("");

  lines.push("## Bug Report");
  if (bug.summary) lines.push(`- Summary: ${bug.summary}`);
  if (bug.expected) lines.push(`- Expected: ${bug.expected}`);
  if (bug.actual) lines.push(`- Actual: ${bug.actual}`);
  if (bug.severity) lines.push(`- Severity: ${bug.severity}`);
  if (Array.isArray(bug.steps) && bug.steps.length) {
    lines.push("- Steps to reproduce:");
    bug.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  if (Array.isArray(bug.affected_files) && bug.affected_files.length) {
    lines.push(`- Affected files (hint): ${bug.affected_files.join(", ")}`);
  }
  if (!bug.summary && !bug.actual && !bug.steps?.length) {
    lines.push("- (No structured bug report — read the task description.)");
  }
  lines.push("");

  lines.push("## Required Steps");
  lines.push("1. Investigate the bug. Reproduce it locally if possible.");
  lines.push("2. Implement the fix. Keep changes scoped to the actual defect.");
  lines.push("3. Run the project's test suite. Iterate until tests pass.");
  lines.push("4. Commit the fix with a clear message describing the bug + fix.");
  lines.push(`5. Use \`vibe-kanban\` MCP \`update_task\` with taskId="${task.id}",`);
  lines.push(`   status="done", and a description that summarizes what you fixed.`);
  lines.push("6. Use `vibe-kanban` MCP `create_task` to create a re-QA task with:");
  lines.push(`   - projectId="${project.id}"`);
  lines.push(`   - title="Re-QA: <original scenario>"`);
  lines.push(`   - status="todo"`);
  lines.push(`   - priority="high"`);
  lines.push(`   - metadata={`);
  lines.push(`       type: "qa-test",`);
  lines.push(`       parent_task: "${task.id}",`);
  if (qaTaskId) {
    lines.push(`       qa_scenario: "<copy from original QA task ${qaTaskId}>",`);
    lines.push(`       qa_target_url: "<copy from original QA task ${qaTaskId}>"`);
  } else {
    lines.push(`       qa_scenario: "<scenario name>",`);
    lines.push(`       qa_target_url: "<target url>"`);
  }
  lines.push(`     }`);
  lines.push("");
  lines.push("If you cannot fix the bug, set this task back to status=\"todo\"");
  lines.push("with a description explaining why, and do NOT create a re-QA task.");

  return lines.join("\n");
}
