import { describe, test, expect, afterEach } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  buildMcpConfig,
  deriveVenvPython,
  resolveQaAgentPython,
  resolveQaAgentCwd,
  writeTempMcpConfig,
  cleanupMcpConfig,
  getVibeKanbanSseUrl,
} from "./mcpConfigWriter";

const baseProject = {
  id: "p1",
  qaAgentPath: null as string | null,
  qaAgentPython: null as string | null,
};

afterEach(() => {
  delete process.env.VK_QA_AGENT_PYTHON;
  delete process.env.VK_QA_AGENT_PATH;
});

describe("getVibeKanbanSseUrl", () => {
  test("uses port from env, defaulting to 3001", () => {
    expect(getVibeKanbanSseUrl()).toMatch(/^http:\/\/localhost:\d+\/mcp$/);
  });
});

describe("deriveVenvPython", () => {
  test("returns absolute path under .venv", () => {
    const result = deriveVenvPython("/home/u/qa-agent");
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toContain(".venv");
    expect(result).toContain("python");
  });
});

describe("resolveQaAgentPython", () => {
  test("prefers explicit absolute project.qaAgentPython", () => {
    const project = {
      ...baseProject,
      qaAgentPython: "/abs/python",
    };
    expect(resolveQaAgentPython(project)).toBe("/abs/python");
  });

  test("ignores non-absolute qaAgentPython", () => {
    const project = { ...baseProject, qaAgentPython: "python" };
    expect(resolveQaAgentPython(project)).toBeNull();
  });

  test("falls back to env VK_QA_AGENT_PYTHON", () => {
    process.env.VK_QA_AGENT_PYTHON = "/env/python";
    expect(resolveQaAgentPython(baseProject)).toBe("/env/python");
  });

  test("returns null when nothing resolves", () => {
    expect(resolveQaAgentPython(baseProject)).toBeNull();
  });
});

describe("resolveQaAgentCwd", () => {
  test("returns project.qaAgentPath when absolute", () => {
    expect(resolveQaAgentCwd({ qaAgentPath: "/x/qa-agent" })).toBe("/x/qa-agent");
  });

  test("falls back to env VK_QA_AGENT_PATH", () => {
    process.env.VK_QA_AGENT_PATH = "/env/qa";
    expect(resolveQaAgentCwd({ qaAgentPath: null })).toBe("/env/qa");
  });

  test("returns null when nothing resolves", () => {
    expect(resolveQaAgentCwd({ qaAgentPath: null })).toBeNull();
  });
});

describe("buildMcpConfig", () => {
  test("vibe-kanban server uses SSE transport", () => {
    const config = buildMcpConfig({
      project: baseProject,
      servers: ["vibe-kanban"],
    });
    const vk = config.mcpServers["vibe-kanban"];
    expect(vk).toBeDefined();
    expect((vk as any).type).toBe("sse");
    expect((vk as any).url).toMatch(/\/mcp$/);
  });

  test("qa-agent server uses stdio with absolute python and module form", () => {
    process.env.VK_QA_AGENT_PYTHON = "/abs/python";
    process.env.VK_QA_AGENT_PATH = "/abs/qa-agent";
    const config = buildMcpConfig({
      project: baseProject,
      servers: ["qa-agent"],
    });
    const qa = config.mcpServers["qa-agent"];
    expect(qa).toBeDefined();
    expect((qa as any).type).toBe("stdio");
    expect((qa as any).command).toBe("/abs/python");
    expect((qa as any).args).toEqual(["-m", "qa_agent.mcp_server"]);
    expect((qa as any).cwd).toBe("/abs/qa-agent");
  });

  test("qa-agent omitted when no python resolves", () => {
    const config = buildMcpConfig({
      project: baseProject,
      servers: ["qa-agent"],
    });
    expect(config.mcpServers["qa-agent"]).toBeUndefined();
  });

  test("multiple servers can be requested at once", () => {
    process.env.VK_QA_AGENT_PYTHON = "/abs/python";
    process.env.VK_QA_AGENT_PATH = "/abs/qa-agent";
    const config = buildMcpConfig({
      project: baseProject,
      servers: ["vibe-kanban", "qa-agent"],
    });
    expect(Object.keys(config.mcpServers).sort()).toEqual(["qa-agent", "vibe-kanban"]);
  });
});

describe("writeTempMcpConfig + cleanupMcpConfig", () => {
  test("writes a JSON file in temp dir and cleanup removes it", async () => {
    const filePath = await writeTempMcpConfig({
      project: baseProject,
      servers: ["vibe-kanban"],
    });
    expect(filePath.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(parsed.mcpServers["vibe-kanban"]).toBeDefined();

    cleanupMcpConfig(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test("cleanup refuses paths outside temp dir", () => {
    const fake = "/etc/passwd";
    cleanupMcpConfig(fake);
    expect(fs.existsSync(fake)).toBe(true);
  });
});
