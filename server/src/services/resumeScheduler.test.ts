/**
 * Exercises the sweep's row selection + atomic claim WITHOUT launching a real
 * Claude subprocess. Mocks are installed in beforeAll and fully restored (spread
 * of the real namespace) in afterAll so the stubs never leak into other files.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { getDb } from "../db";
import * as realHeadlessNs from "./headlessClaude";
import * as realSpawnerNs from "./taskSpawner";
import { sweepResumeQueue } from "./resumeScheduler";

// Freeze the real exports into plain objects NOW (before mocking). `import * as`
// namespaces are live bindings that mock.module mutates, so restoring to them
// would leak the stubs; a shallow copy captured at load time restores cleanly.
const realHeadless = { ...realHeadlessNs };
const realSpawner = { ...realSpawnerNs };

const spawnCalls: { runId: string }[] = [];

const projectId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const dueRunId = crypto.randomUUID();
const futureRunId = crypto.randomUUID();
const nullRunId = crypto.randomUUID(); // buildSpawnOpts returns null for this one

const flush = () => new Promise((r) => setTimeout(r, 25));

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "sched-test",
    "/tmp/sched",
  );
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    taskId,
    projectId,
    "sched task",
  );
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  db.prepare(
    `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, sessionId, resumeReason, resumeAt, resumeAttempts, runMode)
     VALUES (?, ?, ?, 'headless', 'waiting_limit', ?, 'sess-a', 'usage-limit', ?, 1, 'in_place')`,
  ).run(dueRunId, taskId, projectId, past, past);
  db.prepare(
    `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, sessionId, resumeReason, resumeAt, resumeAttempts, runMode)
     VALUES (?, ?, ?, 'headless', 'waiting_limit', ?, 'sess-b', 'usage-limit', ?, 1, 'in_place')`,
  ).run(futureRunId, taskId, projectId, past, future);
  // Due row whose task/config has vanished → buildSpawnOpts returns null.
  db.prepare(
    `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, sessionId, resumeReason, resumeAt, resumeAttempts, runMode)
     VALUES (?, ?, ?, 'headless', 'waiting_limit', ?, 'sess-c', 'usage-limit', ?, 1, 'in_place')`,
  ).run(nullRunId, taskId, projectId, past, past);

  // Stub the spawn + opts-build layers; keep every other export real via spread.
  mock.module("./headlessClaude", () => ({
    ...realHeadless,
    spawnHeadlessClaude: mock(async (opts: { runId: string }) => {
      spawnCalls.push({ runId: opts.runId });
      return { exitCode: 0, summary: null, sessionId: null, durationMs: 1, runId: opts.runId };
    }),
  }));
  mock.module("./taskSpawner", () => ({
    ...realSpawner,
    buildSpawnOpts: mock(async (tid: string, rid: string) =>
      rid === nullRunId
        ? null
        : {
            prompt: "x",
            taskId: tid,
            projectId: "p",
            mcpConfigPath: "/tmp/x.json",
            cwd: "/tmp",
            profile: "headless",
            cleanup: () => {},
          },
    ),
  }));
});

afterAll(() => {
  mock.module("./headlessClaude", () => realHeadless);
  mock.module("./taskSpawner", () => realSpawner);
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
});

describe("resume scheduler sweep", () => {
  test("resumes only due rows, leaves future-dated rows parked", async () => {
    await sweepResumeQueue();
    await flush();

    // The due row spawns; the null-opts row is claimed but never spawns.
    expect(spawnCalls.map((c) => c.runId)).toContain(dueRunId);
    expect(spawnCalls.map((c) => c.runId)).not.toContain(nullRunId);

    const db = getDb();
    const due = db.prepare("SELECT status FROM task_ai_runs WHERE id = ?").get(dueRunId) as {
      status: string;
    };
    const future = db.prepare("SELECT status FROM task_ai_runs WHERE id = ?").get(futureRunId) as {
      status: string;
    };
    expect(due.status).toBe("running"); // claimed
    expect(future.status).toBe("waiting_limit"); // not yet due
  });

  test("a due row whose spawn opts can't be rebuilt is failed (not left running)", async () => {
    await sweepResumeQueue();
    await flush();
    const row = getDb().prepare("SELECT status FROM task_ai_runs WHERE id = ?").get(nullRunId) as {
      status: string;
    };
    expect(row.status).toBe("failed");
  });

  test("a second sweep does not double-resume an already-claimed row", async () => {
    await sweepResumeQueue();
    await flush();
    // Still only the single resume — the row is 'running' now, so the
    // WHERE status='waiting_limit' claim no longer matches it.
    expect(spawnCalls.filter((c) => c.runId === dueRunId)).toHaveLength(1);
  });
});
