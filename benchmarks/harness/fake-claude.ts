#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

function findPrompt(args: string[]): string {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "-p" || a === "--dangerously-skip-permissions") {
      i++;
      continue;
    }
    if (
      a === "--output-format" ||
      a === "--mcp-config" ||
      a === "--model" ||
      a === "--system-prompt"
    ) {
      i += 2;
      continue;
    }
    if (a.startsWith("--")) {
      i++;
      continue;
    }
    return a;
  }
  return "";
}

interface ChainStep {
  whenType: string;
  applyFix?: Record<string, string>;
  createChildType?: string;
  createChildTitle?: string;
  createChildMetadata?: Record<string, unknown>;
}

const prompt = findPrompt(process.argv.slice(2));
const cwd = process.cwd();

const hangPath = path.join(cwd, ".bench-hangms");
if (fs.existsSync(hangPath)) {
  const hangMs = Number(fs.readFileSync(hangPath, "utf-8").trim());
  if (Number.isFinite(hangMs) && hangMs > 0) {
    await new Promise((r) => setTimeout(r, hangMs));
  }
}

// Phase I — failure injection. Honored as env so the harness can wire spec.injection
// without writing additional files (parallel-run-safe).
const injectKillAfterMs = Number(process.env.VK_INJECT_KILL_AFTER_MS ?? "");
if (Number.isFinite(injectKillAfterMs) && injectKillAfterMs > 0) {
  await new Promise((r) => setTimeout(r, injectKillAfterMs));
  // Exit non-zero with no JSON envelope. Mirrors a SIGKILL/OOM mid-run: production
  // headlessClaude finally-block should still record the row + release the slot.
  process.stderr.write(`[fake-claude] injected kill after ${injectKillAfterMs}ms\n`);
  process.exit(137);
}
if (process.env.VK_INJECT_OUTPUT_FORMAT_BROKEN === "1") {
  // Emit truncated/garbage output. parseClaudeOutput's streaming-JSON fallback
  // (server/src/services/headlessClaude.ts:67-83) should land summary=tail, sessionId=null.
  process.stdout.write('{"type":"result","subtype":"success","is_err');
  process.exit(0);
}

const taskIdMatch = prompt.match(/Task ID:\s*([a-zA-Z0-9-]+)/);
const taskId = taskIdMatch?.[1] ?? null;
const apiUrl = process.env.VK_BENCH_API_URL ?? null;

// Phase I — when MCP-500 injection is on, probe /mcp so the hook has something
// to intercept. Mirrors a real claude CLI calling tools/list at session start.
if (apiUrl && process.env.VK_INJECT_MCP_500_RATE) {
  try {
    await fetch(`${apiUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
  } catch {
    // best-effort
  }
}

let taskType: string | null = null;
let projectId: string | null = null;
if (apiUrl && taskId) {
  try {
    const res = await fetch(`${apiUrl}/api/tasks/${taskId}`);
    if (res.ok) {
      const t = (await res.json()) as any;
      taskType = (t.metadata && typeof t.metadata === "object" ? t.metadata.type : null) ?? null;
      projectId = t.projectId ?? null;
    }
  } catch {
    // best-effort
  }
}

const mockChainPath = path.join(cwd, ".bench-mockchain.json");
let chainStep: ChainStep | null = null;
if (taskType && fs.existsSync(mockChainPath)) {
  try {
    const chain = JSON.parse(fs.readFileSync(mockChainPath, "utf-8")) as ChainStep[];
    chainStep = chain.find((s) => s.whenType === taskType) ?? null;
  } catch {
    // best-effort
  }
}

const appliedFiles: string[] = [];
const fixSource = chainStep?.applyFix;
const mockFixPath = path.join(cwd, ".bench-mockfix.json");
let fixMap: Record<string, string> | null = null;
if (fixSource) fixMap = fixSource;
else if (fs.existsSync(mockFixPath)) {
  try {
    fixMap = JSON.parse(fs.readFileSync(mockFixPath, "utf-8")) as Record<string, string>;
  } catch {
    // best-effort
  }
}
if (fixMap) {
  for (const [rel, content] of Object.entries(fixMap)) {
    const target = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    appliedFiles.push(rel);
  }
}

let patchOk = false;
let patchError: string | null = null;
if (apiUrl && taskId) {
  try {
    const res = await fetch(`${apiUrl}/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "done",
        description: `[fake-claude type=${taskType ?? "?"}] applied ${appliedFiles.length} files: ${appliedFiles.join(", ")}`,
      }),
    });
    patchOk = res.ok;
    if (!res.ok) patchError = `${res.status} ${await res.text()}`;
  } catch (err) {
    patchError = String(err);
  }
}

let createdChildId: string | null = null;
let createError: string | null = null;
if (apiUrl && projectId && chainStep?.createChildType) {
  try {
    const meta: Record<string, unknown> = {
      type: chainStep.createChildType,
      parent_task: taskId,
      ...(chainStep.createChildMetadata ?? {}),
    };
    const res = await fetch(`${apiUrl}/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: chainStep.createChildTitle ?? `Child of ${taskId}`,
        description: `Auto-spawned from ${taskId}`,
        prompt: `Auto-spawned from ${taskId}`,
        status: "todo",
        priority: "high",
        metadata: meta,
      }),
    });
    if (res.ok) {
      const child = (await res.json()) as any;
      createdChildId = child.id ?? null;
    } else {
      createError = `${res.status} ${await res.text()}`;
    }
  } catch (err) {
    createError = String(err);
  }
}

const sessionId = crypto.randomUUID();
const summaryParts = [
  `[fake-claude type=${taskType ?? "?"}]`,
  `applied ${appliedFiles.length} files`,
  `patchOk=${patchOk}${patchError ? ` patchError=${patchError}` : ""}`,
];
if (chainStep?.createChildType) {
  summaryParts.push(createdChildId ? `child=${createdChildId}` : `childError=${createError}`);
}
const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 50,
  duration_api_ms: 50,
  num_turns: 1,
  result: summaryParts.join("; "),
  stop_reason: "end_turn",
  session_id: sessionId,
  total_cost_usd: 0,
  usage: {
    input_tokens: 10,
    output_tokens: 10,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  modelUsage: {
    "fake-claude": {
      inputTokens: 10,
      outputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
    },
  },
  permission_denials: [],
  terminal_reason: "completed",
};
process.stdout.write(JSON.stringify(result));
process.exit(0);
