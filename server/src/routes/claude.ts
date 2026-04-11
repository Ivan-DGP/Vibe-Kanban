import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import { spawnStreaming } from "../lib/runtime";
import { log } from "../lib/logger";
import { buildAnalyzePrompt, buildGatherContextPrompt } from "../services/aiResolvePrompt";
import type { Task } from "@vibe-kanban/shared";

let cliAvailableCache: boolean | null = null;
let cliCheckTime = 0;

async function isCliAvailable(): Promise<boolean> {
  if (cliAvailableCache !== null && Date.now() - cliCheckTime < 60000) {
    return cliAvailableCache;
  }
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = await spawn([cmd, "claude"], { cwd: "." });
    cliAvailableCache = result.exitCode === 0;
  } catch {
    cliAvailableCache = false;
  }
  cliCheckTime = Date.now();
  return cliAvailableCache;
}

function getApiKey(): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'claudeApiKey'").get() as any;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

const claudeRoutes: FastifyPluginAsync = async (fastify) => {
  // Status check
  fastify.get("/claude/status", async () => {
    return {
      cliAvailable: await isCliAvailable(),
      apiKeyConfigured: !!getApiKey(),
    };
  });

  // SSE streaming chat
  fastify.post("/claude/chat", async (request, reply) => {
    const { message, projectId } = request.body as any;

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let context = "";
    if (projectId) {
      const db = getDb();
      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
      if (project) {
        const tasks = db.prepare("SELECT title, status, priority FROM tasks WHERE projectId = ? LIMIT 50").all(projectId);
        context = `Project: ${project.name}\nPath: ${project.path}\nTech: ${project.techStack}\nTasks:\n${(tasks as any[]).map((t) => `- [${t.status}] ${t.title} (${t.priority})`).join("\n")}\n\n`;
      }
    }

    const fullPrompt = context ? `${context}User: ${message}` : message;

    try {
      if (await isCliAvailable()) {
        // Use Claude CLI in print mode — pipe prompt via stdin to avoid CLI arg length limits
        const proc = spawnStreaming(["claude", "-p"], { stdinData: fullPrompt });

        // Kill process after 30s to prevent hangs
        const timeout = setTimeout(() => proc.kill(), 30_000);

        await new Promise<void>((resolve) => {
          proc.onData((chunk) => {
            reply.raw.write(`data: ${JSON.stringify({ type: "delta", text: chunk })}\n\n`);
          });
          proc.exited.then(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } else {
        // Fall back to API
        const apiKey = getApiKey();
        if (!apiKey) {
          reply.raw.write(`data: ${JSON.stringify({ type: "error", message: "No Claude CLI or API key configured" })}\n\n`);
          reply.raw.end();
          return;
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            stream: true,
            messages: [{ role: "user", content: fullPrompt }],
          }),
        });

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  reply.raw.write(`data: ${JSON.stringify({ type: "delta", text: parsed.delta.text })}\n\n`);
                }
              } catch {}
            }
          }
        }
      }

      reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    } catch (err: any) {
      log("error", "claude", "Chat error", { error: err.message });
      reply.raw.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    }

    reply.raw.end();
  });

  // Shared SSE streaming helper
  async function streamPromptToSSE(prompt: string, reply: any): Promise<void> {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      if (await isCliAvailable()) {
        const proc = spawnStreaming(["claude", "-p"], { stdinData: prompt });
        const timeout = setTimeout(() => proc.kill(), 60_000);

        await new Promise<void>((resolve) => {
          proc.onData((chunk) => {
            reply.raw.write(`data: ${JSON.stringify({ type: "delta", text: chunk })}\n\n`);
          });
          proc.exited.then(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } else {
        const apiKey = getApiKey();
        if (!apiKey) {
          reply.raw.write(`data: ${JSON.stringify({ type: "error", message: "No Claude CLI or API key configured" })}\n\n`);
          reply.raw.end();
          return;
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            stream: true,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  reply.raw.write(`data: ${JSON.stringify({ type: "delta", text: parsed.delta.text })}\n\n`);
                }
              } catch {}
            }
          }
        }
      }

      reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    } catch (err: any) {
      log("error", "claude", "Streaming error", { error: err.message });
      reply.raw.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    }

    reply.raw.end();
  }

  // Analyze task with rich project context
  fastify.post("/claude/analyze", async (request, reply) => {
    const { projectId, taskId } = request.body as any;
    const db = getDb();

    const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND projectId = ?").get(taskId, projectId) as Task | undefined;
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }

    const prompt = await buildAnalyzePrompt(task, projectId);
    await streamPromptToSSE(prompt, reply);
  });

  // Gather context for a task (may not exist yet)
  fastify.post("/claude/gather-context", async (request, reply) => {
    const { taskTitle, taskDescription, projectId } = request.body as any;

    if (!taskTitle || !projectId) {
      reply.code(400);
      return { error: "taskTitle and projectId are required" };
    }

    const prompt = await buildGatherContextPrompt(taskTitle, taskDescription || null, projectId);
    await streamPromptToSSE(prompt, reply);
  });

  // Bulk import - parse text into tasks
  fastify.post("/claude/bulk-import", async (request) => {
    const { text } = request.body as any;

    const prompt = `Parse the following unstructured text into a JSON array of tasks. Each task should have: title (string), description (string or null), priority ("urgent"|"high"|"medium"|"low"), status ("backlog"). Return ONLY valid JSON, no other text.

Text:
${text}`;

    let responseText = "";

    if (await isCliAvailable()) {
      const result = await spawn(["claude", "-p", prompt], { cwd: ".", timeout: 30000 });
      responseText = result.stdout;
    } else {
      const apiKey = getApiKey();
      if (!apiKey) throw new Error("No AI backend available");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await response.json() as any;
      responseText = data.content?.[0]?.text || "[]";
    }

    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  });
};

export default claudeRoutes;
