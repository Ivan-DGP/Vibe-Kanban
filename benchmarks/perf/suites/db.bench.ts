/**
 * SQLite hot paths against a seeded temp DB. The kanban board polls tasks and
 * the API paginates them constantly, so the list query + rowToTask mapping is
 * the single hottest read path in the server.
 *
 * We point VK_DATA_DIR at a throwaway dir, run the real migration ladder, seed
 * N tasks, and benchmark the exact queries routes/tasks.ts issues.
 */
import { rmSync } from "node:fs";
import { PERF_DATA_DIR } from "../setupEnv";
import type { Suite } from "../harness";

const TASK_COUNT = 2_000;
const PAGE_SIZE = 15; // matches the board's virtual-scroll page

export async function buildDbSuite(): Promise<{ suite: Suite; cleanup: () => void }> {
  // setupEnv already pointed VK_DATA_DIR at a throwaway temp dir before any
  // server module loaded, so getDb() opens a fresh DB there — never the real one.
  const dir = PERF_DATA_DIR;
  const { getDb } = await import("../../../server/src/db");
  const { rowToTask } = await import("../../../server/src/services/taskModel");
  const db = getDb();

  const projectId = "perf-project";
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "Perf Project",
    dir,
  );

  const statuses = ["backlog", "todo", "in_progress", "done", "approved"];
  const priorities = ["urgent", "high", "medium", "low"];
  const insert = db.prepare(
    "INSERT INTO tasks (id, projectId, title, description, prompt, status, priority, taskNumber, sortOrder, metadata) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const seed = db.transaction(() => {
    for (let i = 0; i < TASK_COUNT; i++) {
      insert.run(
        `task-${i}`,
        projectId,
        `Task number ${i} — implement the thing`,
        `A description for task ${i} with enough text to be realistic. `.repeat(3),
        `Prompt for task ${i}: fix the bug and keep regression tests green.`,
        statuses[i % statuses.length],
        priorities[i % priorities.length],
        i,
        i,
        JSON.stringify({ agent: "claude", labels: ["a", "b"], estimate: i % 8 }),
      );
    }
  });
  seed();

  const where = " WHERE projectId = ?";
  const orderBy =
    " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, sortOrder";

  const listStmt = db.prepare(`SELECT * FROM tasks${where}${orderBy} LIMIT ? OFFSET ?`);
  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM tasks${where}`);
  const getStmt = db.prepare("SELECT * FROM tasks WHERE id = ? AND projectId = ?");

  const suite: Suite = {
    name: `db — ${TASK_COUNT} tasks seeded (VK_DATA_DIR temp)`,
    cases: [
      {
        name: `list page (LIMIT ${PAGE_SIZE}) — query only`,
        fn: () => listStmt.all(projectId, PAGE_SIZE, 0),
      },
      {
        name: `list page (LIMIT ${PAGE_SIZE}) + rowToTask`,
        fn: () => listStmt.all(projectId, PAGE_SIZE, 0).map(rowToTask),
      },
      {
        name: "list ALL tasks + rowToTask",
        fn: () => listStmt.all(projectId, TASK_COUNT, 0).map(rowToTask),
      },
      { name: "COUNT(*) by project", fn: () => countStmt.get(projectId) },
      { name: "get single task by id", fn: () => rowToTask(getStmt.get("task-1234", projectId)) },
    ],
  };

  const cleanup = () => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true });
  };

  return { suite, cleanup };
}
