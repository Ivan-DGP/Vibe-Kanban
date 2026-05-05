// One-shot cleanup for the local data dir.
//
// Removes:
//   - data/projects/{id}/ dirs whose id is not in the DB.
//   - data/tasks/{id}.json snapshots whose id is not in the DB.
//   - DB rows for projects whose path starts with /tmp/ (test garbage).
//
// Default is dry-run. Pass --apply to actually delete.
//
// Run from the repo root: bun run server/scripts/cleanup-orphans.ts [--apply]

import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");
const DATA_DIR = process.env.VK_DATA_DIR
  ? path.resolve(process.env.VK_DATA_DIR)
  : path.join(REPO_ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "vibe-kanban.db");
const PROJECTS_DIR = path.join(DATA_DIR, "projects");
const TASKS_DIR = path.join(DATA_DIR, "tasks");

const APPLY = process.argv.includes("--apply");

if (!fs.existsSync(DB_PATH)) {
  console.error(`No DB at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
const rows = db.query("SELECT id, name, path FROM projects").all() as {
  id: string;
  name: string;
  path: string;
}[];
const liveIds = new Set(rows.map((r) => r.id));

const orphanDirs: string[] = [];
if (fs.existsSync(PROJECTS_DIR)) {
  for (const entry of fs.readdirSync(PROJECTS_DIR)) {
    const full = path.join(PROJECTS_DIR, entry);
    if (!fs.statSync(full).isDirectory()) continue;
    if (!liveIds.has(entry)) orphanDirs.push(full);
  }
}

const orphanSnapshots: string[] = [];
if (fs.existsSync(TASKS_DIR)) {
  for (const entry of fs.readdirSync(TASKS_DIR)) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5);
    if (!liveIds.has(id)) orphanSnapshots.push(path.join(TASKS_DIR, entry));
  }
}

const garbageProjects = rows.filter((r) => r.path.startsWith("/tmp/"));

console.log(`DB: ${rows.length} project rows (${liveIds.size} live ids)`);
console.log(`Orphan project dirs: ${orphanDirs.length}`);
console.log(`Orphan task snapshots: ${orphanSnapshots.length}`);
console.log(`Test-garbage DB rows (path /tmp/...): ${garbageProjects.length}`);
for (const r of garbageProjects) {
  console.log(`  - ${r.id}  ${r.name}  ${r.path}`);
}

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to delete.");
  process.exit(0);
}

let dirsRemoved = 0;
for (const dir of orphanDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
  dirsRemoved++;
}

let snapsRemoved = 0;
for (const f of orphanSnapshots) {
  fs.rmSync(f, { force: true });
  snapsRemoved++;
}

let rowsRemoved = 0;
const stmt = db.prepare("DELETE FROM projects WHERE id = ?");
for (const r of garbageProjects) {
  stmt.run(r.id);
  rowsRemoved++;
  // Also clean any newly orphaned fs entries for these ids.
  fs.rmSync(path.join(PROJECTS_DIR, r.id), { recursive: true, force: true });
  fs.rmSync(path.join(TASKS_DIR, `${r.id}.json`), { force: true });
}

console.log(
  `\nApplied. Removed ${dirsRemoved} dirs, ${snapsRemoved} snapshots, ${rowsRemoved} DB rows.`,
);
