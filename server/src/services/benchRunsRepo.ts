import type { DatabaseHandle } from "../lib/runtime";
import { getDb } from "../db";

export type BenchRunStatus = "running" | "succeeded" | "failed";

export interface BenchRunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  fixturesCsv: string;
  mode: string;
  mock: boolean;
  parallel: number;
  resultFile: string | null;
  status: BenchRunStatus;
}

export interface InsertBenchRunInput {
  id: string;
  startedAt: string;
  fixturesCsv: string;
  mode: string;
  mock: boolean;
  parallel: number;
}

interface RawRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  fixtures_csv: string;
  mode: string;
  mock: number;
  parallel: number;
  result_file: string | null;
  status: BenchRunStatus;
}

function fromRaw(r: RawRow): BenchRunRow {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    fixturesCsv: r.fixtures_csv,
    mode: r.mode,
    mock: r.mock !== 0,
    parallel: r.parallel,
    resultFile: r.result_file,
    status: r.status,
  };
}

export function insert(input: InsertBenchRunInput, db: DatabaseHandle = getDb()): BenchRunRow {
  db.prepare(
    `INSERT INTO bench_runs (id, started_at, fixtures_csv, mode, mock, parallel, status)
     VALUES (?, ?, ?, ?, ?, ?, 'running')`,
  ).run(
    input.id,
    input.startedAt,
    input.fixturesCsv,
    input.mode,
    input.mock ? 1 : 0,
    input.parallel,
  );
  const row = db.prepare("SELECT * FROM bench_runs WHERE id = ?").get(input.id) as RawRow;
  return fromRaw(row);
}

export function updateOnFinish(
  id: string,
  status: Exclude<BenchRunStatus, "running">,
  resultFile?: string | null,
  db: DatabaseHandle = getDb(),
): BenchRunRow | null {
  db.prepare(`UPDATE bench_runs SET status = ?, finished_at = ?, result_file = ? WHERE id = ?`).run(
    status,
    new Date().toISOString(),
    resultFile ?? null,
    id,
  );
  const row = db.prepare("SELECT * FROM bench_runs WHERE id = ?").get(id) as RawRow | undefined;
  return row ? fromRaw(row) : null;
}

export function getById(id: string, db: DatabaseHandle = getDb()): BenchRunRow | null {
  const row = db.prepare("SELECT * FROM bench_runs WHERE id = ?").get(id) as RawRow | undefined;
  return row ? fromRaw(row) : null;
}

export interface ListOpts {
  status?: BenchRunStatus;
  limit?: number;
}

export function list(opts: ListOpts = {}, db: DatabaseHandle = getDb()): BenchRunRow[] {
  const where = opts.status ? "WHERE status = ?" : "";
  const limit =
    typeof opts.limit === "number" && opts.limit > 0 ? `LIMIT ${Math.floor(opts.limit)}` : "";
  const sql = `SELECT * FROM bench_runs ${where} ORDER BY started_at DESC ${limit}`.trim();
  const stmt = db.prepare(sql);
  const rows = (opts.status ? stmt.all(opts.status) : stmt.all()) as RawRow[];
  return rows.map(fromRaw);
}

export function markOrphans(db: DatabaseHandle = getDb()): number {
  const finishedAt = new Date().toISOString();
  const before = (
    db.prepare("SELECT COUNT(*) as c FROM bench_runs WHERE status = 'running'").get() as {
      c: number;
    }
  ).c;
  db.prepare(
    `UPDATE bench_runs SET status = 'failed', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'`,
  ).run(finishedAt);
  return before;
}
