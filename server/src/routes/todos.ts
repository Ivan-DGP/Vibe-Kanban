import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const todoRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // List all todos
  fastify.get("/todos", async () => {
    const rows = db
      .prepare("SELECT * FROM todos ORDER BY completed ASC, sortOrder ASC")
      .all() as any[];
    return rows.map((row) => ({ ...row, completed: !!row.completed }));
  });

  // Create a todo
  fastify.post("/todos", async (request) => {
    const { title, linkedTaskId } = request.body as any;
    const id = uuid();
    const ts = now();

    const maxOrder = db
      .prepare("SELECT MAX(sortOrder) as m FROM todos")
      .get() as { m: number | null };
    const sortOrder = (maxOrder?.m ?? 0) + 1;

    db.prepare(
      "INSERT INTO todos (id, title, completed, linkedTaskId, sortOrder, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?, ?, ?)",
    ).run(id, title, linkedTaskId || null, sortOrder, ts, ts);

    const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as any;
    return { ...row, completed: !!row.completed };
  });

  // Bulk reorder (must be registered before :id routes)
  fastify.patch("/todos/reorder", async (request) => {
    const { todos } = request.body as {
      todos: { id: string; sortOrder: number }[];
    };

    db.transaction(() => {
      for (const todo of todos) {
        db.prepare(
          "UPDATE todos SET sortOrder = ?, updatedAt = ? WHERE id = ?",
        ).run(todo.sortOrder, now(), todo.id);
      }
    })();

    return { ok: true };
  });

  // Clear completed (must be registered before :id routes)
  fastify.delete("/todos/clear-completed", async (_request, reply) => {
    db.prepare("DELETE FROM todos WHERE completed = 1").run();
    return reply.code(204).send();
  });

  // Update a todo
  fastify.patch("/todos/:id", async (request, reply) => {
    const { id } = request.params as any;
    const updates = request.body as any;

    const existing = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Todo not found" });

    const allowedFields = ["title", "completed", "linkedTaskId", "sortOrder"];
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        if (key === "completed") {
          values.push(value ? 1 : 0);
        } else if (key === "linkedTaskId") {
          values.push(value || null);
        } else {
          values.push(value);
        }
      }
    }

    if (fields.length === 0) {
      return { ...(existing as any), completed: !!(existing as any).completed };
    }

    fields.push("updatedAt = ?");
    values.push(now());

    values.push(id);
    db.prepare(`UPDATE todos SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );

    const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as any;
    return { ...row, completed: !!row.completed };
  });

  // Delete a todo
  fastify.delete("/todos/:id", async (request, reply) => {
    const { id } = request.params as any;
    const existing = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Todo not found" });

    db.prepare("DELETE FROM todos WHERE id = ?").run(id);
    return reply.code(204).send();
  });
};

export default todoRoutes;
