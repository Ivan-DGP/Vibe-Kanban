import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isBun,
  spawnProcess,
  spawnProcessSync,
  spawnStreaming,
  writeFile,
  openDatabase,
} from "./runtime";

// Shared temp directory for all tests
const tempDir = mkdtempSync(join(tmpdir(), "runtime-test-"));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── isBun ────────────────────────────────────────────────────────

describe("isBun", () => {
  test("is a boolean", () => {
    expect(typeof isBun).toBe("boolean");
  });

  test("is true in bun environment", () => {
    expect(isBun).toBe(true);
  });
});

// ── spawnProcess ─────────────────────────────────────────────────

describe("spawnProcess", () => {
  test("runs echo and captures stdout", async () => {
    const result = await spawnProcess(["echo", "hello"], { cwd: tempDir });
    expect(result.stdout).toContain("hello");
    expect(result.exitCode).toBe(0);
  });

  test("runs ls on a known directory with exitCode 0", async () => {
    const result = await spawnProcess(["ls", "/tmp"], { cwd: tempDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test("non-existent command returns exitCode != 0 or stderr", async () => {
    const result = await spawnProcess(
      ["bash", "-c", "command_that_does_not_exist_xyz_42"],
      { cwd: tempDir },
    );
    // Either exit code is non-zero or stderr is non-empty
    const failed = result.exitCode !== 0 || result.stderr.length > 0;
    expect(failed).toBe(true);
  });

  test("stdinData — cat echoes stdin back", async () => {
    const result = await spawnProcess(["cat"], {
      cwd: tempDir,
      stdinData: "piped-input-data",
    });
    expect(result.stdout).toContain("piped-input-data");
    expect(result.exitCode).toBe(0);
  });

  test("timeout kills a long-running process", async () => {
    const result = await spawnProcess(["sleep", "10"], {
      cwd: tempDir,
      timeout: 500,
    });
    expect(result.exitCode).not.toBe(0);
  });

  test("custom env variable is visible", async () => {
    const result = await spawnProcess(["env"], {
      cwd: tempDir,
      env: { MY_CUSTOM_VAR: "runtime-test-value-123" },
    });
    expect(result.stdout).toContain("MY_CUSTOM_VAR=runtime-test-value-123");
  });

  test("cwd option changes working directory", async () => {
    const result = await spawnProcess(["pwd"], { cwd: "/tmp" });
    // pwd may resolve symlinks so just check it ends with /tmp or contains it
    expect(result.stdout).toContain("tmp");
    expect(result.exitCode).toBe(0);
  });
});

// ── spawnProcessSync ─────────────────────────────────────────────

describe("spawnProcessSync", () => {
  test("runs echo sync-test and captures stdout", () => {
    const result = spawnProcessSync(["echo", "sync-test"], {});
    expect(result.stdout).toContain("sync-test");
    expect(result.exitCode).toBe(0);
  });

  test("non-existent command returns exitCode != 0", () => {
    const result = spawnProcessSync(
      ["bash", "-c", "command_that_does_not_exist_xyz_42"],
      {},
    );
    expect(result.exitCode).not.toBe(0);
  });
});

// ── spawnStreaming ────────────────────────────────────────────────

describe("spawnStreaming", () => {
  test("echo delivers data via onData callback", async () => {
    const proc = spawnStreaming(["echo", "streaming-test"]);
    const chunks: string[] = [];
    proc.onData((chunk) => chunks.push(chunk));
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    const combined = chunks.join("");
    expect(combined).toContain("streaming-test");
  });

  test("kill() terminates a long-running process", async () => {
    const proc = spawnStreaming(["sleep", "100"]);
    // Give it a moment to start, then kill
    setTimeout(() => proc.kill(), 100);
    const exitCode = await proc.exited;
    // Killed processes usually have non-zero exit codes
    expect(exitCode).not.toBe(0);
  });
});

// ── writeFile ────────────────────────────────────────────────────

describe("writeFile", () => {
  test("writes content to a temp file and reads it back", async () => {
    const filePath = join(tempDir, "write-test.txt");
    await writeFile(filePath, "hello runtime write");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("hello runtime write");
  });

  test("writes unicode content and round-trips it", async () => {
    const filePath = join(tempDir, "write-unicode.txt");
    const unicodeContent = "Hello 世界 🌍 مرحبا Héllo";
    await writeFile(filePath, unicodeContent);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe(unicodeContent);
  });
});

// ── openDatabase ─────────────────────────────────────────────────

describe("openDatabase", () => {
  test("opens a temp DB and exec/prepare/query/close work", () => {
    const dbPath = join(tempDir, "test.db");
    const db = openDatabase(dbPath);

    // exec creates a table
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");

    // prepare().run inserts a row
    db.prepare("INSERT INTO items (name) VALUES (?)").run("alpha");

    // query().all reads rows
    const rows = db.query("SELECT * FROM items").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).name).toBe("alpha");

    // prepare().get reads a single row
    const row = db.prepare("SELECT * FROM items WHERE name = ?").get("alpha");
    expect((row as any).name).toBe("alpha");

    db.close();
  });

  test("transaction commits multiple inserts atomically", () => {
    const dbPath = join(tempDir, "test-tx.db");
    const db = openDatabase(dbPath);

    db.exec("CREATE TABLE nums (val INTEGER)");

    const insertMany = db.transaction(() => {
      db.prepare("INSERT INTO nums (val) VALUES (?)").run(1);
      db.prepare("INSERT INTO nums (val) VALUES (?)").run(2);
      db.prepare("INSERT INTO nums (val) VALUES (?)").run(3);
    });
    insertMany();

    const rows = db.query("SELECT * FROM nums").all();
    expect(rows).toHaveLength(3);

    db.close();
  });

  test("opens in-memory database with :memory:", () => {
    const db = openDatabase(":memory:");

    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)");
    db.prepare("INSERT INTO test (val) VALUES (?)").run("memval");

    const row = db.query("SELECT val FROM test WHERE id = 1").get() as any;
    expect(row.val).toBe("memval");

    db.close();
  });
});
