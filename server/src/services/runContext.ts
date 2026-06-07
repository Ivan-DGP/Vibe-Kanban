/**
 * Maps a headless run id to the working directory that run executes in (its git
 * worktree when isolated, else the project path). The per-run MCP endpoint
 * (/mcp/run/:runId) uses this so MCP git tools reflect the agent's actual cwd
 * instead of always pointing at the project's main working tree.
 */
const runCwd = new Map<string, string>();

export function setRunCwd(runId: string, cwd: string): void {
  runCwd.set(runId, cwd);
}

export function getRunCwd(runId: string): string | null {
  return runCwd.get(runId) ?? null;
}

export function clearRunCwd(runId: string): void {
  runCwd.delete(runId);
}
