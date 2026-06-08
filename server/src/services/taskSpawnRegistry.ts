import type { Task, Project } from "@vibe-kanban/shared";
import type { McpServerName } from "./mcpConfigWriter";

export interface SpawnContext {
  task: Task;
  project: Project;
}

export interface SpawnConfig {
  /**
   * Discriminator key for `task.metadata.type`. The dispatcher matches a
   * task against the registry by this value.
   */
  type: string;
  /** MCP servers to expose to the spawned Claude session. */
  mcpServers: McpServerName[];
  /** Profile label written to the `task_ai_runs.profile` column. */
  profile: string;
  /** Optional timeout override in ms. Falls back to the spawner default. */
  timeoutMs?: number;
  /** Max run attempts on failure (1 = no retry). Falls back to the spawner default. */
  maxAttempts?: number;
  /** Build the full prompt to hand to `claude -p`. */
  buildPrompt: (ctx: SpawnContext) => string;
}

const registry = new Map<string, SpawnConfig>();

export function registerSpawnConfig(config: SpawnConfig): void {
  registry.set(config.type, config);
}

export function getSpawnConfig(type: string): SpawnConfig | undefined {
  return registry.get(type);
}

export function listSpawnConfigs(): SpawnConfig[] {
  return Array.from(registry.values());
}

/** Test-only — clear the registry between runs. */
export function _resetSpawnRegistry(): void {
  registry.clear();
}
