/**
 * End-to-end park → resume of a single run, with the `claude` subprocess stubbed.
 * Worktrees are disabled (VK_TASK_WORKTREES=0) so the run is in-place — this keeps
 * the test off real git plumbing and exercises the runMode='in_place' path.
 *
 * Mock lifecycle mirrors tasks.integration.test.ts: capture the REAL runtime
 * exports as named bindings, install the mock in beforeAll, and restore the real
 * exports in afterAll so the spawnProcess stub never leaks into other test files.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  spawnProcess as realSpawnProcess,
  spawnProcessSync as realSpawnProcessSync,
  spawnStreaming as realSpawnStreaming,
  spawnPty as realSpawnPty,
  writeFile as realWriteFile,
  openDatabase as realOpenDatabase,
  isBun as realIsBun,
} from "../lib/runtime";
import { getDb } from "../db";
import { spawnHeadlessClaude, getResumeMaxAttempts } from "./headlessClaude";

const claudeCalls: string[][] = [];
// Switchable result so each test controls whether the next claude run hits the limit.
let claudeMode: "limit" | "success" = "limit";

const RATE_LIMIT = JSON.stringify({
  is_error: true,
  subtype: "error_during_execution",
  result: "Claude usage limit reached. Try again later.",
  session_id: "sess-park-1",
});
const SUCCESS = JSON.stringify({
  session_id: "sess-park-1",
  result: "completed after resume",
  total_cost_usd: 0.02,
});

const realRuntime = {
  isBun: realIsBun,
  spawnProcess: realSpawnProcess,
  spawnProcessSync: realSpawnProcessSync,
  spawnStreaming: realSpawnStreaming,
  spawnPty: realSpawnPty,
  writeFile: realWriteFile,
  openDatabase: realOpenDatabase,
};

const projectId = crypto.randomUUID();
const taskId = crypto.randomUUID();
let tmpDir: string;

const prevWorktrees = process.env.VK_TASK_WORKTREES;
const prevAutoresume = process.env.VK_AUTORESUME_ENABLED;

beforeAll(() => {
  process.env.VK_TASK_WORKTREES = "0";
  delete process.env.VK_AUTORESUME_ENABLED; // default = enabled

  const db = getDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-resume-e2e-"));
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "resume-e2e",
    tmpDir,
  );
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    taskId,
    projectId,
    "resume task",
  );

  mock.module("../lib/runtime", () => ({
    ...realRuntime,
    spawnProcess: mock(async (cmd: string[]) => {
      if (cmd[0] === "claude") {
        claudeCalls.push(cmd);
        return claudeMode === "limit"
          ? { stdout: RATE_LIMIT, stderr: "", exitCode: 1 }
          : { stdout: SUCCESS, stderr: "", exitCode: 0 };
      }
      // git (rev-parse/diff) — degrade gracefully so snapshot/capture are no-ops.
      return { stdout: "", stderr: "", exitCode: 1 };
    }),
  }));
});

afterAll(() => {
  mock.module("../lib/runtime", () => realRuntime); // restore real impls (no leak)
  if (prevWorktrees === undefined) delete process.env.VK_TASK_WORKTREES;
  else process.env.VK_TASK_WORKTREES = prevWorktrees;
  if (prevAutoresume === undefined) delete process.env.VK_AUTORESUME_ENABLED;
  else process.env.VK_AUTORESUME_ENABLED = prevAutoresume;
  try {
    getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("usage-limit park → resume", () => {
  const runId = crypto.randomUUID();

  test("a usage-limit hit parks the run as waiting_limit (not failed)", async () => {
    claudeMode = "limit";
    const res = await spawnHeadlessClaude({
      prompt: "do the task",
      taskId,
      projectId,
      mcpConfigPath: "/tmp/none.json",
      cwd: tmpDir,
      runId,
    });
    expect(res.parked).toBe(true);
    expect(res.sessionId).toBe("sess-park-1");

    const row = getDb()
      .prepare(
        "SELECT status, sessionId, resumeReason, resumeAt, resumeAttempts, runMode FROM task_ai_runs WHERE id = ?",
      )
      .get(runId) as Record<string, unknown>;
    expect(row.status).toBe("waiting_limit");
    expect(row.sessionId).toBe("sess-park-1");
    expect(row.resumeReason).toBe("usage-limit");
    expect(row.resumeAt).toBeTruthy();
    expect(row.resumeAttempts).toBe(1);
    expect(row.runMode).toBe("in_place");
  });

  test("resume reuses the row, splices --resume <sessionId>, and succeeds", async () => {
    claudeMode = "success";
    const res = await spawnHeadlessClaude({
      prompt: "Continue the task where you left off.",
      taskId,
      projectId,
      mcpConfigPath: "/tmp/none.json",
      cwd: tmpDir,
      runId, // same id as the parked row
      resumeSessionId: "sess-park-1",
      inPlaceResume: true,
      resumeAttempts: 1,
    });
    expect(res.parked).toBeFalsy();
    expect(res.exitCode).toBe(0);

    const resumeCmd = claudeCalls[claudeCalls.length - 1];
    const idx = resumeCmd.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(resumeCmd[idx + 1]).toBe("sess-park-1");
    expect(resumeCmd[resumeCmd.length - 1]).toBe("Continue the task where you left off.");

    const row = getDb().prepare("SELECT status FROM task_ai_runs WHERE id = ?").get(runId) as {
      status: string;
    };
    expect(row.status).toBe("succeeded");
  });

  test("at the attempt cap, a further limit hit fails (does not re-park)", async () => {
    claudeMode = "limit";
    const giveUpRunId = crypto.randomUUID();
    const max = getResumeMaxAttempts();
    getDb()
      .prepare(
        `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, sessionId, resumeReason, resumeAttempts, runMode)
         VALUES (?, ?, ?, 'headless', 'waiting_limit', ?, 'sess-park-1', 'usage-limit', ?, 'in_place')`,
      )
      .run(giveUpRunId, taskId, projectId, new Date().toISOString(), max);

    const res = await spawnHeadlessClaude({
      prompt: "Continue.",
      taskId,
      projectId,
      mcpConfigPath: "/tmp/none.json",
      cwd: tmpDir,
      runId: giveUpRunId,
      resumeSessionId: "sess-park-1",
      inPlaceResume: true,
      resumeAttempts: max,
    });
    expect(res.parked).toBeFalsy();

    const row = getDb()
      .prepare("SELECT status, summary FROM task_ai_runs WHERE id = ?")
      .get(giveUpRunId) as { status: string; summary: string | null };
    expect(row.status).toBe("failed");
    expect(row.summary).toContain("gave up");
  });

  test("kill switch (VK_AUTORESUME_ENABLED=0): a limit hit is marked failed, not parked", async () => {
    process.env.VK_AUTORESUME_ENABLED = "0";
    claudeMode = "limit";
    const killRunId = crypto.randomUUID();
    try {
      const res = await spawnHeadlessClaude({
        prompt: "do it",
        taskId,
        projectId,
        mcpConfigPath: "/tmp/none.json",
        cwd: tmpDir,
        runId: killRunId,
      });
      expect(res.parked).toBeFalsy();
      const row = getDb()
        .prepare("SELECT status FROM task_ai_runs WHERE id = ?")
        .get(killRunId) as { status: string };
      expect(row.status).toBe("failed");
    } finally {
      delete process.env.VK_AUTORESUME_ENABLED;
    }
  });
});
