import type { FastifyPluginAsync } from "fastify";
import os from "node:os";
import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import { log } from "../lib/logger";
import { buildAnalyzePrompt } from "../services/aiResolvePrompt";

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
        // Use Claude CLI — limit to 1 turn to prevent tool-use loops
        const proc = Bun.spawn(["claude", "-p", "--max-turns", "1", fullPrompt], {
          stdout: "pipe",
          stderr: "pipe",
        });

        // Kill process after 60s to prevent hangs
        const timeout = setTimeout(() => proc.kill(), 60_000);

        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            reply.raw.write(`data: ${JSON.stringify({ type: "delta", text: chunk })}\n\n`);
          }
        } finally {
          clearTimeout(timeout);
        }
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

  // Bulk import - parse text into tasks
  fastify.post("/claude/bulk-import", async (request) => {
    const { projectId, text } = request.body as any;

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
