import { describe, test, expect, beforeAll, afterEach, afterAll, mock } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Stub spawnHeadlessClaude so NO real CLI/worktree run happens; track calls to
// assert the dispatch opts. hasRunningRun is kept real (spread ...real) so the
// in-flight guard behaves normally (no active runs in tests → false).
type SpawnOpts = { taskId: string; projectId: string; prompt: string; cwd: string; runId?: string };
const spawnCalls: SpawnOpts[] = [];
mock.module("./headlessClaude", () => {
  const real = require("./headlessClaude");
  return {
    ...real,
    spawnHeadlessClaude: async (opts: SpawnOpts) => {
      spawnCalls.push(opts);
      return { exitCode: 0, summary: null, sessionId: "s", durationMs: 1, runId: opts.runId };
    },
  };
});

import { dispatchProposal } from "./supervisorDispatch";
import { getDb } from "../db";

const PROJECT_ID = `__sup_dispatch_${crypto.randomUUID()}__`;
const PROJECT_BAD = `__sup_dispatch_bad_${crypto.randomUUID()}__`;
let projectDir: string;

function seedTask(opts: { origin?: string; status?: string; projectId?: string }): string {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = opts.origin
    ? JSON.stringify({ origin: opts.origin, signalKey: "roadmap:x" })
    : "{}";
  db.prepare(
    `INSERT INTO tasks (id, projectId, title, description, status, priority, taskNumber, sortOrder, inboxAt, metadata, createdAt, updatedAt)
     VALUES (?, ?, 'Ship widget', 'rationale text', ?, 'medium', 1, 1, ?, ?, ?, ?)`,
  ).run(id, opts.projectId ?? PROJECT_ID, opts.status ?? "backlog", now, metadata, now, now);
  return id;
}

function taskRow(id: string) {
  return getDb().prepare("SELECT status, metadata FROM tasks WHERE id = ?").get(id) as {
    status: string;
    metadata: string;
  };
}

beforeAll(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sup-dispatch-"));
  const db = getDb();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    PROJECT_ID,
    "Dispatch Test",
    projectDir,
  );
  // A project whose path does NOT exist → buildSpawnOpts returns null.
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    PROJECT_BAD,
    "Bad Path",
    "/nonexistent/supervisor-dispatch-xyz",
  );
});

afterEach(() => {
  delete process.env.VK_SUPERVISOR_DISPATCH_ENABLED;
  spawnCalls.length = 0;
  getDb().prepare("DELETE FROM tasks WHERE projectId IN (?, ?)").run(PROJECT_ID, PROJECT_BAD);
});

afterAll(() => {
  const db = getDb();
  db.prepare("DELETE FROM tasks WHERE projectId IN (?, ?)").run(PROJECT_ID, PROJECT_BAD);
  db.prepare("DELETE FROM projects WHERE id IN (?, ?)").run(PROJECT_ID, PROJECT_BAD);
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("dispatchProposal — master switch (default OFF)", () => {
  test("refuses and does NOT spawn when the switch is off", async () => {
    const id = seedTask({ origin: "supervisor" });
    const res = await dispatchProposal(id);
    expect(res).toEqual({ ok: false, reason: "disabled" });
    expect(spawnCalls.length).toBe(0);
    expect(taskRow(id).status).toBe("backlog"); // unchanged
  });
});

describe("dispatchProposal — enabled", () => {
  test("dispatches a supervisor proposal: spawns, stamps metadata, moves to in_progress", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const id = seedTask({ origin: "supervisor" });

    const res = await dispatchProposal(id);
    expect(res.ok).toBe(true);
    expect(res.runId).toBeTruthy();

    // Spawn called with the right opts (into the isolated runner).
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].taskId).toBe(id);
    expect(spawnCalls[0].projectId).toBe(PROJECT_ID);
    expect(spawnCalls[0].cwd).toBe(projectDir);
    expect(spawnCalls[0].prompt).toContain("Ship widget"); // fallback = title + description
    expect(spawnCalls[0].runId).toBe(res.runId);

    // Task moved + stamped.
    const t = taskRow(id);
    expect(t.status).toBe("in_progress");
    const m = JSON.parse(t.metadata);
    expect(m.dispatchedRunId).toBe(res.runId);
    expect(m.dispatchedAt).toBeTruthy();
    expect(m.origin).toBe("supervisor"); // preserved
  });

  test("is idempotent: a second dispatch does not spawn again", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const id = seedTask({ origin: "supervisor" });

    const first = await dispatchProposal(id);
    expect(spawnCalls.length).toBe(1);

    const second = await dispatchProposal(id);
    expect(second).toEqual({ ok: true, runId: first.runId, alreadyDispatched: true });
    expect(spawnCalls.length).toBe(1); // no second spawn
  });

  test("rejects a non-supervisor task with reason not_supervisor", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const id = seedTask({ origin: undefined }); // metadata '{}'
    const res = await dispatchProposal(id);
    expect(res).toEqual({ ok: false, reason: "not_supervisor" });
    expect(spawnCalls.length).toBe(0);
    expect(taskRow(id).status).toBe("backlog");
  });

  test("returns not_found for a missing task", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const res = await dispatchProposal("no-such-task");
    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(spawnCalls.length).toBe(0);
  });

  test("assemble failure (project path gone) → assemble_failed, no spawn, no stamp", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const id = seedTask({ origin: "supervisor", projectId: PROJECT_BAD });
    const res = await dispatchProposal(id);
    expect(res).toEqual({ ok: false, reason: "assemble_failed" });
    expect(spawnCalls.length).toBe(0);
    const t = taskRow(id);
    expect(t.status).toBe("backlog"); // not moved
    expect(JSON.parse(t.metadata).dispatchedRunId).toBeUndefined(); // not stamped
  });

  test("concurrent dispatches race to a SINGLE run (atomic claim closes the double-run window)", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const id = seedTask({ origin: "supervisor" });

    // Two dispatches interleave at the buildSpawnOpts await, then race on the CAS.
    const [a, b] = await Promise.all([dispatchProposal(id), dispatchProposal(id)]);

    // Exactly one real run was fired.
    expect(spawnCalls.length).toBe(1);
    const spawnedRunId = spawnCalls[0].runId;
    // Both callers succeed and agree on the winning runId.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect([a.runId, b.runId]).toContain(spawnedRunId);
    expect(a.runId).toBe(b.runId);
    // Exactly one dispatchedRunId persisted.
    expect(JSON.parse(taskRow(id).metadata).dispatchedRunId).toBe(spawnedRunId);
  });
});
