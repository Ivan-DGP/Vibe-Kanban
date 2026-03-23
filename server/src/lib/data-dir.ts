import path from "node:path";
import fs from "node:fs";

const DATA_DIR = path.resolve(
  import.meta.dir,
  "..",
  "..",
  "..",
  "data",
);

export function getDataDir(): string {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}

export function getDbPath(): string {
  return path.join(getDataDir(), "vibe-kanban.db");
}

export function getTaskSnapshotDir(): string {
  const dir = path.join(getDataDir(), "tasks");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
