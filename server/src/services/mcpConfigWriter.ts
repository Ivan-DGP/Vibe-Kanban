import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { writeFile } from "../lib/runtime";
import type { Project } from "@vibe-kanban/shared";

export type McpServerName = "vibe-kanban" | "qa-agent";

export interface McpConfigOptions {
  servers: McpServerName[];
  project: Pick<Project, "id" | "qaAgentPath" | "qaAgentPython">;
  /** When set, the vibe-kanban MCP URL points at this run's endpoint so git
   *  tools resolve to the run's worktree. */
  runId?: string;
}

interface McpStdioServer {
  type?: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

interface McpSseServer {
  type: "sse";
  url: string;
}

type McpServerEntry = McpStdioServer | McpSseServer;

interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>;
}

const SERVER_PORT = parseInt(process.env.PORT || "3001", 10);

export function getVibeKanbanSseUrl(runId?: string): string {
  const base = `http://localhost:${SERVER_PORT}/mcp`;
  return runId ? `${base}/run/${runId}` : base;
}

/**
 * Derive the python executable path inside a project's `.venv`.
 * Returns absolute path; does NOT verify file exists.
 */
export function deriveVenvPython(qaAgentPath: string): string {
  const isWindows = process.platform === "win32";
  return isWindows
    ? path.join(qaAgentPath, ".venv", "Scripts", "python.exe")
    : path.join(qaAgentPath, ".venv", "bin", "python");
}

/**
 * Resolve the qa-agent python executable for a project.
 * Priority:
 *   1. project.qaAgentPython (explicit absolute path)
 *   2. derived `<qaAgentPath>/.venv/bin/python`
 *   3. global env VK_QA_AGENT_PYTHON
 */
export function resolveQaAgentPython(
  project: Pick<Project, "qaAgentPath" | "qaAgentPython">,
): string | null {
  if (project.qaAgentPython && path.isAbsolute(project.qaAgentPython)) {
    return project.qaAgentPython;
  }
  if (project.qaAgentPath) {
    const derived = deriveVenvPython(project.qaAgentPath);
    if (fs.existsSync(derived)) return derived;
  }
  const fromEnv = process.env.VK_QA_AGENT_PYTHON;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return null;
}

export function resolveQaAgentCwd(project: Pick<Project, "qaAgentPath">): string | null {
  if (project.qaAgentPath && path.isAbsolute(project.qaAgentPath)) {
    return project.qaAgentPath;
  }
  const fromEnv = process.env.VK_QA_AGENT_PATH;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return null;
}

export function buildMcpConfig(opts: McpConfigOptions): McpConfigFile {
  const servers: Record<string, McpServerEntry> = {};

  if (opts.servers.includes("vibe-kanban")) {
    servers["vibe-kanban"] = {
      type: "sse",
      url: getVibeKanbanSseUrl(opts.runId),
    };
  }

  if (opts.servers.includes("qa-agent")) {
    const python = resolveQaAgentPython(opts.project);
    const cwd = resolveQaAgentCwd(opts.project);
    if (python && cwd) {
      servers["qa-agent"] = {
        type: "stdio",
        command: python,
        args: ["-m", "qa_agent.mcp_server"],
        cwd,
      };
    }
  }

  return { mcpServers: servers };
}

const TEMP_DIR = path.join(os.tmpdir(), "vibe-kanban-mcp");

export async function writeTempMcpConfig(opts: McpConfigOptions): Promise<string> {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  const config = buildMcpConfig(opts);
  const id = crypto.randomUUID();
  const filePath = path.join(TEMP_DIR, `${opts.project.id}-${id}.json`);
  await writeFile(filePath, JSON.stringify(config, null, 2));
  return filePath;
}

export function cleanupMcpConfig(filePath: string): void {
  try {
    if (filePath.startsWith(TEMP_DIR) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup; OS will reap temp files.
  }
}
