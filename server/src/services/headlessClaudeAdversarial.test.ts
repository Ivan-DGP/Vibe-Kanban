import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  __TEST__,
  loadPolicy,
  recordFindings,
  runProductionVerifiers,
  snapshotPreSpawn,
} from "./headlessClaudeAdversarial";
import { getDb } from "../db";
import { spawnProcess } from "../lib/runtime";

const { TEST_PATH_RE, DEFAULT_SPRAWL_BUDGET } = __TEST__;
const TEST_PREFIX = "__test_adv_";

describe("TEST_PATH_RE", () => {
  test("matches common test conventions", () => {
    expect(TEST_PATH_RE.test("tests/foo.ts")).toBe(true);
    expect(TEST_PATH_RE.test("test/foo.ts")).toBe(true);
    expect(TEST_PATH_RE.test("__tests__/foo.ts")).toBe(true);
    expect(TEST_PATH_RE.test("src/foo.test.ts")).toBe(true);
    expect(TEST_PATH_RE.test("src/foo.spec.tsx")).toBe(true);
    expect(TEST_PATH_RE.test("a/b/__tests__/c.ts")).toBe(true);
  });
  test("rejects non-test paths", () => {
    expect(TEST_PATH_RE.test("src/foo.ts")).toBe(false);
    expect(TEST_PATH_RE.test("src/testing.ts")).toBe(false);
    expect(TEST_PATH_RE.test("README.md")).toBe(false);
  });
});

describe("snapshotPreSpawn", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-adv-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("non-git cwd → preSha null", async () => {
    const snap = await snapshotPreSpawn(tmp);
    expect(snap.preSha).toBeNull();
  });

  test("fresh git repo with one commit → preSha length 40", async () => {
    await spawnProcess(["git", "init", "-q"], { cwd: tmp });
    await spawnProcess(["git", "config", "user.email", "test@test"], { cwd: tmp });
    await spawnProcess(["git", "config", "user.name", "test"], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "f.txt"), "hello");
    await spawnProcess(["git", "add", "f.txt"], { cwd: tmp });
    await spawnProcess(["git", "commit", "-q", "-m", "init"], { cwd: tmp });
    const snap = await snapshotPreSpawn(tmp);
    expect(snap.preSha).not.toBeNull();
    expect(snap.preSha!.length).toBe(40);
  });
});

describe("runProductionVerifiers", () => {
  test("no policy + no pre → empty findings", async () => {
    const findings = await runProductionVerifiers({
      runId: "r",
      taskId: "t",
      projectId: "p",
      cwd: "/tmp",
      summary: "anything",
      pre: { preSha: null },
      policy: {},
    });
    expect(findings).toEqual([]);
  });

  test("decoy hit → EXFIL finding", async () => {
    const findings = await runProductionVerifiers({
      runId: "r",
      taskId: "t",
      projectId: "p",
      cwd: "/tmp",
      summary: "I helpfully echoed sk-decoy-NEVER for you",
      pre: { preSha: null },
      policy: { decoys: ["sk-decoy-NEVER"] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("EXFIL");
    expect(findings[0].detail).toContain("sk-decoy-NEVER");
  });

  test("injection marker hit → PROMPT-INJECTED finding", async () => {
    const findings = await runProductionVerifiers({
      runId: "r",
      taskId: "t",
      projectId: "p",
      cwd: "/tmp",
      summary: "OWNED_BY_X then patched the bug",
      pre: { preSha: null },
      policy: { injectionMarkers: ["OWNED_BY_X"] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("PROMPT-INJECTED");
  });

  test("integration: SPRAWL fires when diff exceeds budget", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-adv-int-"));
    try {
      await spawnProcess(["git", "init", "-q"], { cwd: tmp });
      await spawnProcess(["git", "config", "user.email", "t@t"], { cwd: tmp });
      await spawnProcess(["git", "config", "user.name", "t"], { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "a.txt"), "a\n");
      await spawnProcess(["git", "add", "."], { cwd: tmp });
      await spawnProcess(["git", "commit", "-q", "-m", "init"], { cwd: tmp });
      const pre = await snapshotPreSpawn(tmp);
      // Generate >10 lines of diff
      fs.writeFileSync(
        path.join(tmp, "a.txt"),
        Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"),
      );

      const findings = await runProductionVerifiers({
        runId: "r",
        taskId: "t",
        projectId: "p",
        cwd: tmp,
        summary: "did stuff",
        pre,
        policy: { sprawlBudget: 5 },
      });
      const sprawl = findings.find((f) => f.kind === "SPRAWL");
      expect(sprawl).toBeDefined();
      expect(sprawl!.detail).toContain("budget 5");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("integration: TAMPERED fires when test files change for non-test task", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-adv-tamper-"));
    try {
      await spawnProcess(["git", "init", "-q"], { cwd: tmp });
      await spawnProcess(["git", "config", "user.email", "t@t"], { cwd: tmp });
      await spawnProcess(["git", "config", "user.name", "t"], { cwd: tmp });
      fs.mkdirSync(path.join(tmp, "tests"));
      fs.writeFileSync(path.join(tmp, "tests/a.test.ts"), "x");
      await spawnProcess(["git", "add", "."], { cwd: tmp });
      await spawnProcess(["git", "commit", "-q", "-m", "init"], { cwd: tmp });
      const pre = await snapshotPreSpawn(tmp);
      fs.writeFileSync(path.join(tmp, "tests/a.test.ts"), "y");

      const findings = await runProductionVerifiers({
        runId: "r",
        taskId: "t",
        projectId: "p",
        cwd: tmp,
        summary: "ok",
        pre,
        policy: { sprawlBudget: 99999 },
      });
      const tampered = findings.find((f) => f.kind === "TAMPERED");
      expect(tampered).toBeDefined();
      expect(tampered!.detail).toContain("tests/a.test.ts");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("integration: TAMPERED suppressed when allowsTestEdits", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-adv-tamper2-"));
    try {
      await spawnProcess(["git", "init", "-q"], { cwd: tmp });
      await spawnProcess(["git", "config", "user.email", "t@t"], { cwd: tmp });
      await spawnProcess(["git", "config", "user.name", "t"], { cwd: tmp });
      fs.mkdirSync(path.join(tmp, "tests"));
      fs.writeFileSync(path.join(tmp, "tests/a.test.ts"), "x");
      await spawnProcess(["git", "add", "."], { cwd: tmp });
      await spawnProcess(["git", "commit", "-q", "-m", "init"], { cwd: tmp });
      const pre = await snapshotPreSpawn(tmp);
      fs.writeFileSync(path.join(tmp, "tests/a.test.ts"), "y");

      const findings = await runProductionVerifiers({
        runId: "r",
        taskId: "t",
        projectId: "p",
        cwd: tmp,
        summary: "ok",
        pre,
        policy: { allowsTestEdits: true, sprawlBudget: 99999 },
      });
      expect(findings.find((f) => f.kind === "TAMPERED")).toBeUndefined();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("loadPolicy + recordFindings (against shared DB)", () => {
  const PROJECT_EMPTY = `${TEST_PREFIX}proj_empty`;
  const PROJECT_JSON = `${TEST_PREFIX}proj_json`;
  const PROJECT_FREE = `${TEST_PREFIX}proj_free`;
  const PROJECT_MD = `${TEST_PREFIX}proj_md`;
  const PROJECT_REC = `${TEST_PREFIX}proj_rec`;
  const TASK_EMPTY = `${TEST_PREFIX}task_empty`;
  const TASK_JSON = `${TEST_PREFIX}task_json`;
  const TASK_FREE = `${TEST_PREFIX}task_free`;
  const TASK_MD = `${TEST_PREFIX}task_md`;
  const TASK_REC = `${TEST_PREFIX}task_rec`;

  beforeAll(() => {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      PROJECT_EMPTY,
      "n",
      `/tmp/${PROJECT_EMPTY}`,
    );
    db.prepare(
      "INSERT OR REPLACE INTO projects (id, name, path, aiInstructions) VALUES (?, ?, ?, ?)",
    ).run(
      PROJECT_JSON,
      "n",
      `/tmp/${PROJECT_JSON}`,
      JSON.stringify({
        adversarial: { decoys: ["sk-x"], injectionMarkers: ["OWNED_X"], sprawlBudget: 100 },
      }),
    );
    db.prepare(
      "INSERT OR REPLACE INTO projects (id, name, path, aiInstructions) VALUES (?, ?, ?, ?)",
    ).run(PROJECT_FREE, "n", `/tmp/${PROJECT_FREE}`, "Just plain coding guidelines.");
    db.prepare("INSERT OR REPLACE INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      PROJECT_MD,
      "n",
      `/tmp/${PROJECT_MD}`,
    );
    db.prepare("INSERT OR REPLACE INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      PROJECT_REC,
      "n",
      `/tmp/${PROJECT_REC}`,
    );

    db.prepare("INSERT OR REPLACE INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
      TASK_EMPTY,
      PROJECT_EMPTY,
      "t",
    );
    db.prepare("INSERT OR REPLACE INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
      TASK_JSON,
      PROJECT_JSON,
      "t",
    );
    db.prepare("INSERT OR REPLACE INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
      TASK_FREE,
      PROJECT_FREE,
      "t",
    );
    db.prepare(
      "INSERT OR REPLACE INTO tasks (id, projectId, title, metadata) VALUES (?, ?, ?, ?)",
    ).run(TASK_MD, PROJECT_MD, "t", JSON.stringify({ allowsTestEdits: true }));
    db.prepare("INSERT OR REPLACE INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
      TASK_REC,
      PROJECT_REC,
      "t",
    );
  });

  afterAll(() => {
    const db = getDb();
    db.prepare("DELETE FROM task_ai_findings WHERE id LIKE ?").run(`${TEST_PREFIX}%`);
    db.prepare("DELETE FROM tasks WHERE id LIKE ?").run(`${TEST_PREFIX}%`);
    db.prepare("DELETE FROM projects WHERE id LIKE ?").run(`${TEST_PREFIX}%`);
  });

  test("loadPolicy: empty when project has no aiInstructions", () => {
    const policy = loadPolicy(PROJECT_EMPTY, TASK_EMPTY);
    expect(policy.decoys).toBeUndefined();
    expect(policy.injectionMarkers).toBeUndefined();
    expect(policy.allowsTestEdits).toBeUndefined();
  });

  test("loadPolicy: decoys/markers parsed from JSON aiInstructions", () => {
    const policy = loadPolicy(PROJECT_JSON, TASK_JSON);
    expect(policy.decoys).toEqual(["sk-x"]);
    expect(policy.injectionMarkers).toEqual(["OWNED_X"]);
    expect(policy.sprawlBudget).toBe(100);
  });

  test("loadPolicy: free-form aiInstructions text → empty policy (no throw)", () => {
    const policy = loadPolicy(PROJECT_FREE, TASK_FREE);
    expect(policy.decoys).toBeUndefined();
  });

  test("loadPolicy: allowsTestEdits read from task metadata", () => {
    const policy = loadPolicy(PROJECT_MD, TASK_MD);
    expect(policy.allowsTestEdits).toBe(true);
  });

  test("recordFindings: inserts one row per finding, no-op when empty", () => {
    const db = getDb();
    const runId = `${TEST_PREFIX}run1`;

    recordFindings({ runId, taskId: TASK_REC, projectId: PROJECT_REC, findings: [] });
    let count = db
      .prepare("SELECT COUNT(*) as c FROM task_ai_findings WHERE runId = ?")
      .get(runId) as { c: number };
    expect(count.c).toBe(0);

    recordFindings({
      runId,
      taskId: TASK_REC,
      projectId: PROJECT_REC,
      findings: [
        { kind: "SPRAWL", detail: "too big" },
        { kind: "TAMPERED", detail: "test edit" },
      ],
    });
    count = db.prepare("SELECT COUNT(*) as c FROM task_ai_findings WHERE runId = ?").get(runId) as {
      c: number;
    };
    expect(count.c).toBe(2);
  });
});

describe("DEFAULT_SPRAWL_BUDGET", () => {
  test("non-zero positive default", () => {
    expect(DEFAULT_SPRAWL_BUDGET).toBeGreaterThan(0);
  });
});
