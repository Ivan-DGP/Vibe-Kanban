import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { runScan } from "../services/supervisor";
import { rowToTask } from "../services/taskModel";

interface ScanBody {
  limit?: number;
}

const supervisorRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // Run a cross-project scan: collect signals → rank + ground → emit idempotent
  // backlog tasks. Propose-only — no runs dispatched, no code changed.
  fastify.post<{ Body: ScanBody }>("/supervisor/scan", async (request) => {
    const { limit } = request.body ?? {};
    const result = await runScan({ limit });
    return {
      created: result.created,
      skipped: result.skipped,
      proposals: result.proposals,
    };
  });

  // List the tasks the supervisor created (any status — newest first).
  fastify.get("/supervisor/proposals", async () => {
    const rows = db
      .prepare(
        `SELECT * FROM tasks
          WHERE json_extract(metadata, '$.origin') = 'supervisor'
          ORDER BY createdAt DESC
          LIMIT 200`,
      )
      .all() as Record<string, unknown>[];
    return { proposals: rows.map(rowToTask) };
  });
};

export default supervisorRoutes;
