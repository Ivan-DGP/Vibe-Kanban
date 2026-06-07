import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";

const logRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.get("/logs", async (request) => {
    const { level, category, limit = "100", offset = "0" } = request.query as any;

    let sql = "SELECT * FROM system_logs";
    const conditions: string[] = [];
    const params: any[] = [];

    if (level) {
      conditions.push("level = ?");
      params.push(level);
    }
    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");

    const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
    const countResult = db.prepare(countSql).get(...params) as { total: number };

    sql += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));

    const items = db.prepare(sql).all(...params);

    return {
      items: (items as any[]).map((item) => ({
        ...item,
        details: item.details ? JSON.parse(item.details) : null,
      })),
      total: countResult.total,
      hasMore: parseInt(offset) + parseInt(limit) < countResult.total,
    };
  });

  fastify.delete("/logs", async (_request, reply) => {
    db.prepare("DELETE FROM system_logs").run();
    return reply.code(204).send();
  });
};

export default logRoutes;
