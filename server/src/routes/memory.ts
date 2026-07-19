import type { FastifyPluginAsync } from "fastify";
import { appendMemory, listMemory, getMemory, supersede } from "../services/projectMemory";
import { searchMemory } from "../services/memorySearch";
import type { MemoryType, CreateMemoryInput } from "@vibe-kanban/shared";

interface ProjectParams {
  projectId: string;
}
interface MemoryIdParams {
  projectId: string;
  id: string;
}

const MEMORY_TYPES: MemoryType[] = [
  "decision",
  "gotcha",
  "attempt_failed",
  "convention",
  "fragile_file",
];

interface ListQuery {
  type?: string;
  includeSuperseded?: string | boolean;
  limit?: string | number;
}

// Body of POST /memory — projectId comes from the path, not the body.
type CreateBody = Omit<CreateMemoryInput, "projectId">;

interface CrossSearchBody {
  query?: string;
  k?: number;
  minScore?: number;
  type?: MemoryType;
  includeSuperseded?: boolean;
}

const memoryRoutes: FastifyPluginAsync = async (fastify) => {
  // Cross-project semantic memory search: rank past lessons across ALL projects.
  // Each hit carries its source `project`. No projectId in the path.
  fastify.post<{ Body: CrossSearchBody }>(
    "/cross-project/memory/search",
    async (request, reply) => {
      const { query, k, minScore, type, includeSuperseded } = request.body ?? {};
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return reply.code(400).send({ error: "query required" });
      }
      const typeFilter = type && MEMORY_TYPES.includes(type) ? type : undefined;
      const result = await searchMemory({
        query,
        k,
        minScore,
        type: typeFilter,
        includeSuperseded: includeSuperseded === true,
      });
      return {
        query,
        model: result.model,
        results: result.hits,
        totalCandidates: result.totalCandidates,
      };
    },
  );

  fastify.get<{ Params: ProjectParams; Querystring: ListQuery }>(
    "/projects/:projectId/memory",
    async (request) => {
      const { projectId } = request.params;
      const { type, includeSuperseded, limit } = request.query ?? {};
      const typeFilter =
        type && MEMORY_TYPES.includes(type as MemoryType) ? (type as MemoryType) : undefined;
      const events = listMemory(projectId, {
        type: typeFilter,
        includeSuperseded: includeSuperseded === "true" || includeSuperseded === true,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      return { events };
    },
  );

  fastify.post<{ Params: ProjectParams; Body: CreateBody }>(
    "/projects/:projectId/memory",
    async (request, reply) => {
      const { projectId } = request.params;
      const body = request.body ?? ({} as CreateBody);

      if (!body.type || !MEMORY_TYPES.includes(body.type)) {
        return reply.code(400).send({ error: `type must be one of ${MEMORY_TYPES.join(", ")}` });
      }
      if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
        return reply.code(400).send({ error: "title required" });
      }

      const event = appendMemory({
        projectId,
        type: body.type,
        title: body.title.trim(),
        body: body.body,
        files: Array.isArray(body.files) ? body.files : undefined,
        taskId: body.taskId ?? null,
        runId: body.runId ?? null,
        // Route default: entries created via the API without an explicit origin
        // are human-authored (auto-capture sets ai_captured explicitly).
        origin: body.origin ?? "human",
      });
      return reply.code(201).send({ event });
    },
  );

  fastify.post<{ Params: MemoryIdParams; Body: { newEventId?: string } }>(
    "/projects/:projectId/memory/:id/supersede",
    async (request, reply) => {
      const { id } = request.params;
      const newEventId = request.body?.newEventId;
      if (!newEventId || typeof newEventId !== "string") {
        return reply.code(400).send({ error: "newEventId required" });
      }
      if (newEventId === id) {
        return reply.code(400).send({ error: "an event cannot supersede itself" });
      }
      if (!getMemory(newEventId)) {
        return reply.code(400).send({ error: "newEventId does not exist" });
      }
      const updated = supersede(id, newEventId);
      if (!updated) return reply.code(404).send({ error: "memory event not found" });
      return { event: updated };
    },
  );
};

export default memoryRoutes;
