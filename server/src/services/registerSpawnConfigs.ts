import { registerSpawnConfig, _resetSpawnRegistry } from "./taskSpawnRegistry";
import { buildQaTestPrompt, buildDevFixPrompt, buildBenchCodebasePrompt } from "./spawnPrompts";

/**
 * Register the spawn configs the system knows how to dispatch.
 *
 * Called from buildApp(). Safe to call multiple times — the registry is
 * cleared first so re-registration produces the same end state.
 */
export function registerSpawnConfigs(): void {
  _resetSpawnRegistry();

  registerSpawnConfig({
    type: "qa-test",
    mcpServers: ["vibe-kanban", "qa-agent"],
    profile: "qa-test",
    buildPrompt: buildQaTestPrompt,
  });

  registerSpawnConfig({
    type: "dev-fix",
    mcpServers: ["vibe-kanban"],
    profile: "dev-fix",
    buildPrompt: buildDevFixPrompt,
  });

  registerSpawnConfig({
    type: "bench-codebase",
    mcpServers: ["vibe-kanban"],
    profile: "bench-codebase",
    buildPrompt: buildBenchCodebasePrompt,
  });
}
