/**
 * MUST be imported before any server module. server/src/lib/data-dir.ts freezes
 * the data directory into a module-level const at first import, and crypto.ts
 * (pulled in transitively by the suites) imports it. If VK_DATA_DIR isn't set by
 * then, the benchmarks would open — and seed — the developer's REAL database.
 * Point it at a throwaway temp dir here, before that const is ever evaluated.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (!process.env.VK_DATA_DIR) {
  process.env.VK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "vk-perf-"));
}

export const PERF_DATA_DIR = process.env.VK_DATA_DIR;
