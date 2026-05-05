import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Force tests onto an isolated data dir so they never write to data/vibe-kanban.db.
// data-dir.ts captures VK_DATA_DIR at module load, so this preload must run first.
// The inner /data segment keeps data-dir.test.ts's "ends with /data" assertion valid.
if (!process.env.VK_DATA_DIR) {
  const root = mkdtempSync(path.join(tmpdir(), "vk-test-"));
  process.env.VK_DATA_DIR = path.join(root, "data");
}
