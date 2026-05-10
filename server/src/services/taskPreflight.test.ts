import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  loadPreflightConfig,
  maybeRunPreflight,
  runPreflight,
  tokenizeCommand,
} from "./taskPreflight";
import { getDb } from "../db";

const TEST_PREFIX = "__test_pre_";

describe("tokenizeCommand", () => {
  test("plain words split on whitespace", () => {
    expect(tokenizeCommand("bun test")).toEqual(["bun", "test"]);
    expect(tokenizeCommand("  npm   run   test  ")).toEqual(["npm", "run", "test"]);
  });

  test("double-quoted segments are kept as one token", () => {
    expect(tokenizeCommand('node "scripts/run tests.js"')).toEqual([
      "node",
      "scripts/run tests.js",
    ]);
  });

  test("rejects shell-special characters", () => {
    expect(tokenizeCommand("bun test | tee log")).toBeNull();
    expect(tokenizeCommand("bun test && echo")).toBeNull();
    expect(tokenizeCommand("bun test ; rm -rf /")).toBeNull();
    expect(tokenizeCommand("bun test > out.txt")).toBeNull();
    expect(tokenizeCommand("`whoami`")).toBeNull();
    expect(tokenizeCommand("$EVIL")).toBeNull();
  });

  test("empty / whitespace-only returns null", () => {
    expect(tokenizeCommand("")).toBeNull();
    expect(tokenizeCommand("   ")).toBeNull();
  });
});

describe("runPreflight", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-preflight-"));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("passing command → ran=true, passed=true, exit=0", async () => {
    const out = await runPreflight({
      projectId: "p",
      cwd: tmp,
      config: { testCommand: "true", timeoutMs: 5000 },
    });
    expect(out.ran).toBe(true);
    expect(out.passed).toBe(true);
    expect(out.exitCode).toBe(0);
    expect(out.detail).toBeNull();
  });

  test("failing command → ran=true, passed=false, non-zero exit, detail captured", async () => {
    const out = await runPreflight({
      projectId: "p",
      cwd: tmp,
      config: { testCommand: "false", timeoutMs: 5000 },
    });
    expect(out.ran).toBe(true);
    expect(out.passed).toBe(false);
    expect(out.exitCode).not.toBe(0);
    expect(out.detail).toContain("exit=");
  });

  test("unsafe testCommand short-circuits to ran=false", async () => {
    const out = await runPreflight({
      projectId: "p",
      cwd: tmp,
      config: { testCommand: "rm -rf /; bun test", timeoutMs: 5000 },
    });
    expect(out.ran).toBe(false);
    expect(out.passed).toBe(false);
    expect(out.detail).toContain("unsafe");
  });
});

describe("loadPreflightConfig", () => {
  const PROJECT_NONE = `${TEST_PREFIX}proj_none`;
  const PROJECT_FREE = `${TEST_PREFIX}proj_free`;
  const PROJECT_OK = `${TEST_PREFIX}proj_ok`;
  const PROJECT_PARTIAL = `${TEST_PREFIX}proj_partial`;
  const PROJECT_BAD_CMD = `${TEST_PREFIX}proj_badcmd`;

  beforeAll(() => {
    const db = getDb();
    const ins = db.prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, aiInstructions) VALUES (?, ?, ?, ?)`,
    );
    ins.run(PROJECT_NONE, "p1", "/tmp/p1", null);
    ins.run(PROJECT_FREE, "p2", "/tmp/p2", "free-form text, not JSON");
    ins.run(
      PROJECT_OK,
      "p3",
      "/tmp/p3",
      JSON.stringify({ preflight: { testCommand: "bun test", timeoutMs: 30000 } }),
    );
    ins.run(
      PROJECT_PARTIAL,
      "p4",
      "/tmp/p4",
      JSON.stringify({ preflight: { testCommand: "bun test" } }),
    );
    ins.run(
      PROJECT_BAD_CMD,
      "p5",
      "/tmp/p5",
      JSON.stringify({ preflight: { testCommand: "   ", timeoutMs: 1000 } }),
    );
  });

  afterAll(() => {
    const db = getDb();
    db.prepare("DELETE FROM projects WHERE id LIKE ?").run(`${TEST_PREFIX}%`);
  });

  test("missing aiInstructions → null", () => {
    expect(loadPreflightConfig(PROJECT_NONE)).toBeNull();
  });

  test("free-form aiInstructions (not JSON) → null", () => {
    expect(loadPreflightConfig(PROJECT_FREE)).toBeNull();
  });

  test("valid preflight block → config", () => {
    const cfg = loadPreflightConfig(PROJECT_OK);
    expect(cfg).not.toBeNull();
    expect(cfg!.testCommand).toBe("bun test");
    expect(cfg!.timeoutMs).toBe(30000);
  });

  test("missing timeoutMs falls back to default", () => {
    const cfg = loadPreflightConfig(PROJECT_PARTIAL);
    expect(cfg).not.toBeNull();
    expect(cfg!.timeoutMs).toBe(60000);
  });

  test("blank testCommand → null", () => {
    expect(loadPreflightConfig(PROJECT_BAD_CMD)).toBeNull();
  });
});

describe("maybeRunPreflight", () => {
  const PROJECT_NOOP = `${TEST_PREFIX}proj_noop`;
  const PROJECT_RED = `${TEST_PREFIX}proj_red`;
  const PROJECT_GREEN = `${TEST_PREFIX}proj_green`;
  const TASK_RED = `${TEST_PREFIX}task_red`;
  const TASK_GREEN = `${TEST_PREFIX}task_green`;
  let tmp: string;
  let tmpRed: string;
  let tmpGreen: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-preflight-maybe-"));
    tmpRed = fs.mkdtempSync(path.join(os.tmpdir(), "vk-preflight-red-"));
    tmpGreen = fs.mkdtempSync(path.join(os.tmpdir(), "vk-preflight-green-"));
    const db = getDb();
    db.prepare("DELETE FROM task_ai_findings WHERE id LIKE ? OR taskId LIKE ?").run(
      `${TEST_PREFIX}%`,
      `${TEST_PREFIX}%`,
    );
    db.prepare("DELETE FROM tasks WHERE id LIKE ?").run(`${TEST_PREFIX}%`);
    db.prepare("DELETE FROM projects WHERE id LIKE ?").run(`${TEST_PREFIX}%`);
    db.prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, aiInstructions) VALUES (?, ?, ?, ?)`,
    ).run(PROJECT_NOOP, "n", `/tmp/n-${PROJECT_NOOP}`, null);
    db.prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, aiInstructions) VALUES (?, ?, ?, ?)`,
    ).run(
      PROJECT_RED,
      "r",
      tmpRed,
      JSON.stringify({ preflight: { testCommand: "false", timeoutMs: 5000 } }),
    );
    db.prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, aiInstructions) VALUES (?, ?, ?, ?)`,
    ).run(
      PROJECT_GREEN,
      "g",
      tmpGreen,
      JSON.stringify({ preflight: { testCommand: "true", timeoutMs: 5000 } }),
    );
    const insTask = db.prepare(
      `INSERT OR REPLACE INTO tasks (id, projectId, title) VALUES (?, ?, ?)`,
    );
    insTask.run(TASK_RED, PROJECT_RED, "red");
    insTask.run(TASK_GREEN, PROJECT_GREEN, "green");
  });

  afterAll(() => {
    const db = getDb();
    db.prepare("DELETE FROM task_ai_findings WHERE id LIKE ? OR taskId LIKE ?").run(
      `${TEST_PREFIX}%`,
      `${TEST_PREFIX}%`,
    );
    db.prepare("DELETE FROM tasks WHERE id LIKE ?").run(`${TEST_PREFIX}%`);
    db.prepare("DELETE FROM projects WHERE id LIKE ?").run(`${TEST_PREFIX}%`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tmpRed, { recursive: true, force: true });
    fs.rmSync(tmpGreen, { recursive: true, force: true });
  });

  test("project not opted in → returns null, no findings", async () => {
    const out = await maybeRunPreflight({
      runId: `${TEST_PREFIX}run_noop`,
      taskId: TASK_RED,
      projectId: PROJECT_NOOP,
      cwd: tmpRed,
    });
    expect(out).toBeNull();
  });

  test("preflight green → outcome.passed=true, no PREFLIGHT-RED finding", async () => {
    const runId = `${TEST_PREFIX}run_green`;
    const out = await maybeRunPreflight({
      runId,
      taskId: TASK_GREEN,
      projectId: PROJECT_GREEN,
      cwd: tmpGreen,
    });
    expect(out).not.toBeNull();
    expect(out!.passed).toBe(true);
    const db = getDb();
    const findings = db.prepare("SELECT kind FROM task_ai_findings WHERE runId = ?").all(runId) as {
      kind: string;
    }[];
    expect(findings).toHaveLength(0);
  });

  test("preflight red → records PREFLIGHT-RED finding under runId", async () => {
    const runId = `${TEST_PREFIX}run_red`;
    const out = await maybeRunPreflight({
      runId,
      taskId: TASK_RED,
      projectId: PROJECT_RED,
      cwd: tmpRed,
    });
    expect(out).not.toBeNull();
    expect(out!.passed).toBe(false);
    const db = getDb();
    const findings = db
      .prepare("SELECT kind, detail FROM task_ai_findings WHERE runId = ?")
      .all(runId) as { kind: string; detail: string }[];
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("PREFLIGHT-RED");
    expect(findings[0].detail).toContain("exit=");
  });
});
