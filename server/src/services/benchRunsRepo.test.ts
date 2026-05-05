import { describe, test, expect, beforeEach } from "bun:test";
import { openDatabase, type DatabaseHandle } from "../lib/runtime";
import { _runMigrations } from "../db";
import * as repo from "./benchRunsRepo";

function freshDb(): DatabaseHandle {
  const db = openDatabase(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  _runMigrations(db);
  return db;
}

describe("benchRunsRepo", () => {
  let db: DatabaseHandle;

  beforeEach(() => {
    db = freshDb();
  });

  test("insert returns the persisted row with running status", () => {
    const row = repo.insert(
      {
        id: "abc12345",
        startedAt: "2099-01-01T00:00:00.000Z",
        fixturesCsv: "01-foo,02-bar",
        mode: "harness",
        mock: true,
        parallel: 2,
      },
      db,
    );
    expect(row.id).toBe("abc12345");
    expect(row.status).toBe("running");
    expect(row.mock).toBe(true);
    expect(row.parallel).toBe(2);
    expect(row.fixturesCsv).toBe("01-foo,02-bar");
    expect(row.finishedAt).toBeNull();
    expect(row.resultFile).toBeNull();
  });

  test("insert persists mock=false correctly (round-trip int 0 → bool false)", () => {
    const row = repo.insert(
      { id: "no-mock", startedAt: "t", fixturesCsv: "", mode: "pipeline", mock: false, parallel: 1 },
      db,
    );
    expect(row.mock).toBe(false);
  });

  test("getById returns null for unknown ids", () => {
    expect(repo.getById("nope", db)).toBeNull();
  });

  test("getById returns the row after insert", () => {
    repo.insert({ id: "x", startedAt: "t", fixturesCsv: "f", mode: "harness", mock: false, parallel: 1 }, db);
    const r = repo.getById("x", db);
    expect(r?.id).toBe("x");
  });

  test("updateOnFinish moves running → succeeded and stamps finished_at + result_file", () => {
    repo.insert(
      { id: "r1", startedAt: "2099-01-01T00:00:00.000Z", fixturesCsv: "01", mode: "harness", mock: true, parallel: 1 },
      db,
    );
    const updated = repo.updateOnFinish("r1", "succeeded", "results/2099-01-01.json", db);
    expect(updated?.status).toBe("succeeded");
    expect(updated?.finishedAt).toBeTruthy();
    expect(updated?.resultFile).toBe("results/2099-01-01.json");
  });

  test("updateOnFinish moves running → failed without result file", () => {
    repo.insert(
      { id: "r2", startedAt: "t", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 },
      db,
    );
    const updated = repo.updateOnFinish("r2", "failed", undefined, db);
    expect(updated?.status).toBe("failed");
    expect(updated?.resultFile).toBeNull();
  });

  test("updateOnFinish on unknown id returns null without throwing", () => {
    expect(repo.updateOnFinish("ghost", "failed", null, db)).toBeNull();
  });

  test("list returns runs newest-first by started_at", () => {
    repo.insert({ id: "old", startedAt: "2099-01-01T00:00:00.000Z", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    repo.insert({ id: "mid", startedAt: "2099-06-01T00:00:00.000Z", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    repo.insert({ id: "new", startedAt: "2099-12-01T00:00:00.000Z", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    const rows = repo.list({}, db);
    expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  test("list filters by status", () => {
    repo.insert({ id: "r1", startedAt: "2099-01-01T00:00:00.000Z", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    repo.insert({ id: "r2", startedAt: "2099-01-02T00:00:00.000Z", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    repo.updateOnFinish("r1", "succeeded", null, db);
    expect(repo.list({ status: "running" }, db).map((r) => r.id)).toEqual(["r2"]);
    expect(repo.list({ status: "succeeded" }, db).map((r) => r.id)).toEqual(["r1"]);
    expect(repo.list({ status: "failed" }, db)).toEqual([]);
  });

  test("list applies limit", () => {
    for (let i = 0; i < 5; i++) {
      repo.insert(
        { id: `r${i}`, startedAt: `2099-01-0${i + 1}T00:00:00.000Z`, fixturesCsv: "", mode: "harness", mock: false, parallel: 1 },
        db,
      );
    }
    expect(repo.list({ limit: 2 }, db).length).toBe(2);
  });

  test("markOrphans flips running rows to failed and returns the count", () => {
    repo.insert({ id: "a", startedAt: "t1", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    repo.insert({ id: "b", startedAt: "t2", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    repo.insert({ id: "c", startedAt: "t3", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    repo.updateOnFinish("c", "succeeded", null, db);

    const flipped = repo.markOrphans(db);
    expect(flipped).toBe(2);

    const all = repo.list({}, db);
    const byId = new Map(all.map((r) => [r.id, r]));
    expect(byId.get("a")?.status).toBe("failed");
    expect(byId.get("a")?.finishedAt).toBeTruthy();
    expect(byId.get("b")?.status).toBe("failed");
    expect(byId.get("c")?.status).toBe("succeeded");
  });

  test("markOrphans is idempotent — second call flips zero rows", () => {
    repo.insert({ id: "a", startedAt: "t1", fixturesCsv: "", mode: "harness", mock: false, parallel: 1 }, db);
    expect(repo.markOrphans(db)).toBe(1);
    expect(repo.markOrphans(db)).toBe(0);
  });

  test("status CHECK constraint rejects bogus statuses", () => {
    expect(() => {
      db.prepare(
        `INSERT INTO bench_runs (id, started_at, fixtures_csv, mode, mock, parallel, status) VALUES (?, ?, ?, ?, 0, 1, ?)`,
      ).run("bad", "t", "", "harness", "in_progress");
    }).toThrow();
  });

  test("started_at index exists for newest-first listing", () => {
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bench_runs_started_at'")
      .get();
    expect(idx).toBeTruthy();
  });
});
