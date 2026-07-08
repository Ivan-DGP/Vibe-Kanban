import type { FastifyPluginAsync } from "fastify";
import * as termService from "../services/terminalService";
import type { PtySession } from "../services/terminalService";
import { readTranscript } from "../services/transcriptService";

// Public shape for a live session — never leaks internals (proc/ws/buffers).
function toSessionInfo(s: PtySession) {
  return {
    id: s.id,
    type: s.type,
    projectId: s.projectId,
    taskId: s.taskId,
    name: s.name,
    cwd: s.cwd,
    alive: s.alive,
    model: s.model,
    claudeSessionId: s.claudeSessionId,
  };
}

const VALID_SESSION_TYPES = [
  "shell",
  "dev",
  "claude-ai",
  "ai-resolve",
  "ai-test",
  "claude-interactive",
];

const terminalRoutes: FastifyPluginAsync = async (fastify) => {
  // ── REST: Check if node-pty is available ─────────────────────
  fastify.get("/terminal/status", async () => {
    return { available: await termService.isAvailable() };
  });

  // ── REST: List sessions ──────────────────────────────────────
  fastify.get("/terminal/sessions", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    return termService.listSessions(projectId).map(toSessionInfo);
  });

  // ── REST: List known Claude interactive sessions (for resume picker) ──
  fastify.get("/terminal/claude-sessions", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    return termService.listClaudeSessions(projectId).map((s) => ({
      id: s.id,
      projectId: s.projectId ?? undefined,
      taskId: s.taskId ?? undefined,
      model: s.model ?? undefined,
      cwd: s.cwd,
      title: s.title ?? undefined,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    }));
  });

  // ── REST: Create session ─────────────────────────────────────
  fastify.post("/terminal/sessions", async (request, reply) => {
    const body = request.body as {
      projectId?: string;
      type?: string;
      cols?: number;
      rows?: number;
      taskId?: string;
      name?: string;
      prompt?: string;
      branch?: string;
      devCommand?: string;
      model?: string;
      resumeSessionId?: string;
      continueLast?: boolean;
    };

    const type = body.type || "shell";
    if (!VALID_SESSION_TYPES.includes(type)) {
      return reply.code(400).send({ error: "Invalid session type" });
    }

    try {
      const session = await termService.createSession({
        type: type as any,
        projectId: body.projectId,
        cols: body.cols,
        rows: body.rows,
        taskId: body.taskId,
        name: body.name,
        prompt: body.prompt,
        branch: body.branch,
        devCommand: body.devCommand,
        model: body.model,
        resumeSessionId: body.resumeSessionId,
        continueLast: body.continueLast,
      });

      return toSessionInfo(session);
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || "Failed to create session" });
    }
  });

  // ── REST: Kill session ───────────────────────────────────────
  fastify.delete("/terminal/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const killed = termService.killSession(sessionId);
    if (!killed) return reply.code(404).send({ error: "Session not found" });
    return { ok: true };
  });

  // ── REST: Write to session (fallback for non-WS clients) ────
  fastify.post("/terminal/sessions/:sessionId/write", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { data } = request.body as { data: string };
    const ok = termService.writeToSession(sessionId, data);
    if (!ok) return reply.code(404).send({ error: "Session not found or not writable" });
    return { ok: true };
  });

  // ── REST: Read a session's persisted transcript ──────────────
  fastify.get("/terminal/transcripts/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    let content: string | null;
    try {
      content = readTranscript(sessionId);
    } catch {
      return reply.code(400).send({ error: "Invalid session id" });
    }
    if (content === null) return reply.code(404).send({ error: "No transcript for this session" });
    return { sessionId, content };
  });

  // ── REST: List AI sessions (sessions with a taskId) ──────────
  fastify.get("/terminal/ai-sessions", async () => {
    return termService
      .listSessions()
      .filter((s) => s.taskId)
      .map(toSessionInfo);
  });

  // ── REST: Batch AI Resolve ─────────────────────────────────
  fastify.post("/terminal/batch-resolve", async (request, reply) => {
    const { projectId, taskIds, concurrency, overrideBranch } = request.body as {
      projectId: string;
      taskIds: string[];
      concurrency?: number;
      overrideBranch?: string;
    };
    if (!projectId || !taskIds?.length) {
      return reply.code(400).send({ error: "projectId and taskIds are required" });
    }
    try {
      const status = await termService.startBatchResolve(
        projectId,
        taskIds,
        concurrency,
        overrideBranch,
      );
      return status;
    } catch (err: any) {
      return reply.code(409).send({ error: err.message });
    }
  });

  fastify.get("/terminal/batch-resolve/status", async () => {
    return termService.getBatchResolveStatus();
  });

  fastify.post("/terminal/batch-resolve/cancel", async () => {
    return termService.cancelBatchResolve();
  });
};

export default terminalRoutes;
