/**
 * Coverage for the AI-resolve coupling: an interactive PTY resolve session that
 * hits the usage limit must PARK (status='waiting_limit') with a known Claude
 * session id + runMode='in_place', so the resume scheduler can continue it.
 *
 * spawnPty + spawnProcessSync are stubbed; the rest of runtime stays real (frozen
 * + restored in afterAll) so the stub never leaks into other files.
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
import { createSession, sessions } from "./terminalService";

const realRuntime = {
  isBun: realIsBun,
  spawnProcess: realSpawnProcess,
  spawnProcessSync: realSpawnProcessSync,
  spawnStreaming: realSpawnStreaming,
  spawnPty: realSpawnPty,
  writeFile: realWriteFile,
  openDatabase: realOpenDatabase,
};

let onDataCb: ((d: string) => void) | null = null;
let onExitCb: ((code: number | null) => void) | null = null;

const projectId = crypto.randomUUID();
const taskId = crypto.randomUUID();
let tmpDir: string;

const prevAutoresume = process.env.VK_AUTORESUME_ENABLED;

beforeAll(() => {
  delete process.env.VK_AUTORESUME_ENABLED; // default = enabled
  const db = getDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-ptyresolve-"));
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "pty-resolve",
    tmpDir,
  );
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    taskId,
    projectId,
    "pty task",
  );

  mock.module("../lib/runtime", () => ({
    ...realRuntime,
    spawnProcessSync: mock(() => ({ stdout: "claude", exitCode: 0 })),
    spawnPty: mock(() => ({
      write: () => {},
      resize: () => {},
      kill: mock(() => {
        if (onExitCb) onExitCb(1);
      }),
      onData: (cb: (d: string) => void) => {
        onDataCb = cb;
      },
      onExit: (cb: (code: number | null) => void) => {
        onExitCb = cb;
      },
    })),
  }));
});

afterAll(() => {
  mock.module("../lib/runtime", () => realRuntime);
  if (prevAutoresume === undefined) delete process.env.VK_AUTORESUME_ENABLED;
  else process.env.VK_AUTORESUME_ENABLED = prevAutoresume;
  try {
    getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("AI-resolve PTY usage-limit parking", () => {
  test("a usage-limit line in the stream parks the run for auto-resume", async () => {
    onDataCb = null;
    onExitCb = null;
    const session = await createSession({
      type: "ai-resolve",
      projectId,
      taskId,
      name: "resolve",
      prompt: "fix the failing test",
    });
    expect(onDataCb).toBeTruthy();

    // Claude prints the limit message; detection kills the pty → onExit parks.
    onDataCb!("\nClaude usage limit reached. Your limit will reset at 5pm.\n");

    const row = getDb()
      .prepare(
        "SELECT status, sessionId, resumeReason, resumeAt, runMode FROM task_ai_runs WHERE taskId = ? AND status = 'waiting_limit'",
      )
      .get(taskId) as {
      status: string;
      sessionId: string;
      resumeReason: string;
      resumeAt: string | null;
      runMode: string;
    };
    expect(row).toBeTruthy();
    expect(row.status).toBe("waiting_limit");
    expect(row.resumeReason).toBe("usage-limit");
    expect(row.runMode).toBe("in_place");
    expect(row.resumeAt).toBeTruthy();
    // A real Claude session id (uuid) was pinned for `--resume`.
    expect(typeof row.sessionId).toBe("string");
    expect(row.sessionId.length).toBeGreaterThanOrEqual(32);

    expect(sessions.has(session.id)).toBe(false); // session cleaned up
  });

  test("a normal exit (no limit) records an ordinary run, not a parked one", async () => {
    onDataCb = null;
    onExitCb = null;
    const otherTaskId = crypto.randomUUID();
    getDb()
      .prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)")
      .run(otherTaskId, projectId, "normal exit task");

    await createSession({
      type: "ai-resolve",
      projectId,
      taskId: otherTaskId,
      name: "resolve2",
      prompt: "do something normal",
    });
    // Exit cleanly without ever emitting a limit message.
    onExitCb!(0);

    const parked = getDb()
      .prepare("SELECT COUNT(*) c FROM task_ai_runs WHERE taskId = ? AND status = 'waiting_limit'")
      .get(otherTaskId) as { c: number };
    expect(parked.c).toBe(0);
    const any = getDb()
      .prepare("SELECT COUNT(*) c FROM task_ai_runs WHERE taskId = ?")
      .get(otherTaskId) as { c: number };
    expect(any.c).toBe(1); // an ordinary run row was written
  });
});
