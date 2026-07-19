import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { runScan } from "../services/supervisor";
import { dispatchProposal, type DispatchReason } from "../services/supervisorDispatch";
import { rowToTask } from "../services/taskModel";

interface ScanBody {
  limit?: number;
}

interface DispatchParams {
  taskId: string;
}

// Map a dispatch refusal reason to an HTTP status.
const REASON_STATUS: Record<DispatchReason, number> = {
  disabled: 403,
  not_found: 404,
  not_supervisor: 400,
  run_in_flight: 409,
  assemble_failed: 409,
  error: 500,
};

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

  // Dispatch ONE proposal into the isolated headless runner. The human invoking
  // this per-proposal IS the approval; gated behind the VK_SUPERVISOR_DISPATCH_ENABLED
  // master switch (default off → 403). Changes stay in a throwaway worktree — no merge.
  fastify.post<{ Params: DispatchParams }>(
    "/supervisor/proposals/:taskId/dispatch",
    async (request, reply) => {
      const { taskId } = request.params;
      const result = await dispatchProposal(taskId);
      if (!result.ok) {
        const status = result.reason ? REASON_STATUS[result.reason] : 500;
        return reply.code(status).send({ error: result.reason ?? "error" });
      }
      return { runId: result.runId, alreadyDispatched: !!result.alreadyDispatched };
    },
  );

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
