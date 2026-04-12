import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";

const PRIORITY_HOURS: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function getDateRange(period: string, from?: string, to?: string): { from: string; to: string } {
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
      return { from: firstOfMonth.toISOString(), to: new Date(now.getTime() + 86400000).toISOString() };
    }
    case "last-7": {
      const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);
      return { from: sevenDaysAgo.toISOString(), to: new Date(now.getTime() + 86400000).toISOString() };
    }
    case "last-30": {
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
      return { from: thirtyDaysAgo.toISOString(), to: new Date(now.getTime() + 86400000).toISOString() };
    }
    case "custom":
      return { from: from || today.toISOString(), to: to || new Date(now.getTime() + 86400000).toISOString() };
    default:
      return { from: today.toISOString(), to: new Date(now.getTime() + 86400000).toISOString() };
  }
}

export function calculateHours(task: any): number {
  if (task.inProgressAt && task.doneAt) {
    const start = new Date(task.inProgressAt).getTime();
    const end = new Date(task.doneAt).getTime();
    const hours = (end - start) / 3600000;
    if (hours > 0 && hours < 1000) return Math.round(hours * 10) / 10;
  }
  return PRIORITY_HOURS[task.priority] || 2;
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

    const byProject: Record<string, { projectId: string; projectName: string; tasks: any[]; totalHours: number }> = {};

    let totalHours = 0;

    for (const task of tasks) {
      const hours = calculateHours(task);
      totalHours += hours;

      if (!byProject[task.projectId]) {
        byProject[task.projectId] = {
          projectId: task.projectId,
          projectName: task.projectName,
          tasks: [],
          totalHours: 0,
        };
      }
      byProject[task.projectId].tasks.push({ task, projectName: task.projectName, hours });
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
};

export default reportRoutes;
