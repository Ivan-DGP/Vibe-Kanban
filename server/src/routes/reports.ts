import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { runAgentOneShot } from "../services/aiAgent";
import { getSafeEnv } from "../services/terminalRegistry";

const PRIORITY_HOURS: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function getDateRange(
  period: string,
  from?: string,
  to?: string,
): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case "today":
      return { from: today.toISOString(), to: new Date(today.getTime() + 86400000).toISOString() };
    case "yesterday": {
      const yesterday = new Date(today.getTime() - 86400000);
      return { from: yesterday.toISOString(), to: today.toISOString() };
    }
    case "this-week": {
      const dayOfWeek = today.getDay();
      const monday = new Date(today.getTime() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86400000);
      return { from: monday.toISOString(), to: new Date(now.getTime() + 86400000).toISOString() };
    }
    case "this-month": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        from: firstOfMonth.toISOString(),
        to: new Date(now.getTime() + 86400000).toISOString(),
      };
    }
    case "last-7": {
      const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);
      return {
        from: sevenDaysAgo.toISOString(),
        to: new Date(now.getTime() + 86400000).toISOString(),
      };
    }
    case "last-30": {
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
      return {
        from: thirtyDaysAgo.toISOString(),
        to: new Date(now.getTime() + 86400000).toISOString(),
      };
    }
    case "custom":
      return {
        from: from || today.toISOString(),
        to: to || new Date(now.getTime() + 86400000).toISOString(),
      };
    default:
      return { from: today.toISOString(), to: new Date(now.getTime() + 86400000).toISOString() };
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function calculateHours(task: any, runDurationMs = 0): number {
  if (runDurationMs > 0) return round1(runDurationMs / 3_600_000);
  if (task.inProgressAt && task.doneAt) {
    const start = new Date(task.inProgressAt).getTime();
    const end = new Date(task.doneAt).getTime();
    const hours = (end - start) / 3_600_000;
    if (hours > 0) return round1(Math.min(hours, 8));
  }
  return PRIORITY_HOURS[task.priority] ?? 2;
}

const reportRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.get("/reports", async (request) => {
    const { period = "today", from, to } = request.query as any;
    const range = getDateRange(period, from, to);

    const tasks = db
      .prepare(
        `SELECT t.*, p.name as projectName, p.id as pid
         FROM tasks t
         JOIN projects p ON t.projectId = p.id
         WHERE t.doneAt >= ? AND t.doneAt < ?
         ORDER BY t.doneAt DESC`,
      )
      .all(range.from, range.to) as any[];

    // Sum run durations + grab latest successful summary per returned task.
    const runInfo = new Map<string, { ms: number; latestSummary: string | null }>();
    if (tasks.length) {
      const ids = tasks.map((t) => t.id);
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT taskId,
                  SUM(COALESCE(durationMs, 0)) as ms,
                  (SELECT summary FROM task_ai_runs r2
                     WHERE r2.taskId = r.taskId AND r2.success = 1
                       AND r2.summary IS NOT NULL AND r2.summary != ''
                     ORDER BY r2.createdAt DESC LIMIT 1) as latestSummary
           FROM task_ai_runs r
           WHERE r.taskId IN (${placeholders})
           GROUP BY taskId`,
        )
        .all(...ids) as any[];
      for (const row of rows) {
        runInfo.set(row.taskId, {
          ms: Number(row.ms) || 0,
          latestSummary: row.latestSummary ?? null,
        });
      }
    }

    const byProject: Record<
      string,
      { projectId: string; projectName: string; tasks: any[]; totalHours: number }
    > = {};

    let totalHours = 0;

    for (const task of tasks) {
      const info = runInfo.get(task.id);
      const hours = calculateHours(task, info?.ms ?? 0);
      totalHours += hours;

      let reportSummary: string | null = null;
      try {
        if (task.metadata) reportSummary = JSON.parse(task.metadata).reportSummary ?? null;
      } catch {
        reportSummary = null;
      }
      const summary = reportSummary ?? info?.latestSummary ?? null;

      if (!byProject[task.projectId]) {
        byProject[task.projectId] = {
          projectId: task.projectId,
          projectName: task.projectName,
          tasks: [],
          totalHours: 0,
        };
      }
      byProject[task.projectId].tasks.push({
        task,
        projectName: task.projectName,
        hours,
        summary,
      });
      byProject[task.projectId].totalHours += hours;
    }

    return {
      period,
      from: range.from,
      to: range.to,
      totalTasks: tasks.length,
      totalHours: Math.round(totalHours * 10) / 10,
      avgHoursPerTask: tasks.length ? Math.round((totalHours / tasks.length) * 10) / 10 : 0,
      byProject: Object.values(byProject),
    };
  });

  fastify.post("/reports/summaries/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as any;
    if (!task) return reply.code(404).send({ error: "Task not found" });

    let metadata: Record<string, any> = {};
    try {
      if (task.metadata) metadata = JSON.parse(task.metadata) || {};
    } catch {
      metadata = {};
    }

    // Idempotent: already cached.
    if (typeof metadata.reportSummary === "string" && metadata.reportSummary.trim()) {
      return { summary: metadata.reportSummary };
    }

    const persist = (summary: string) => {
      metadata.reportSummary = summary;
      db.prepare(`UPDATE tasks SET metadata = ?, updatedAt = ? WHERE id = ?`).run(
        JSON.stringify(metadata),
        new Date().toISOString(),
        taskId,
      );
    };

    // Reuse latest successful run summary if available.
    const run = db
      .prepare(
        `SELECT summary FROM task_ai_runs
         WHERE taskId = ? AND success = 1 AND summary IS NOT NULL AND summary != ''
         ORDER BY createdAt DESC LIMIT 1`,
      )
      .get(taskId) as any;
    if (run?.summary) {
      persist(run.summary);
      return { summary: run.summary };
    }

    // Generate via agent.
    const lines = ["Title: " + task.title];
    if (task.description) lines.push("Description: " + task.description);
    if (task.prompt) lines.push("Prompt: " + task.prompt);
    const prompt =
      "Summarize what this task accomplished in 1-2 plain sentences for a status report. " +
      "Output ONLY the summary, no preamble.\n\n" +
      lines.join("\n");

    const raw = runAgentOneShot(prompt, getSafeEnv(), task.agent ?? undefined);
    if (raw === null) {
      return reply.code(503).send({ error: "Summary agent unavailable" });
    }

    let summary = raw.trim().replace(/\s+/g, " ");
    const sentences = summary.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 2) summary = sentences.slice(0, 2).join(" ").trim();
    if (summary.length > 400) summary = summary.slice(0, 400).trim();

    persist(summary);
    return { summary };
  });
};

export default reportRoutes;
