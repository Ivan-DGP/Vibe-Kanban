import { describe, test, expect, beforeEach } from "bun:test";
import {
  registerSpawnConfig,
  getSpawnConfig,
  listSpawnConfigs,
  _resetSpawnRegistry,
} from "./taskSpawnRegistry";

const config = {
  type: "qa-test",
  mcpServers: ["vibe-kanban", "qa-agent"] as const,
  profile: "qa",
  buildPrompt: () => "prompt",
};

beforeEach(() => {
  _resetSpawnRegistry();
});

describe("taskSpawnRegistry", () => {
  test("register + get round-trips", () => {
    registerSpawnConfig({ ...config, mcpServers: ["vibe-kanban", "qa-agent"] });
    expect(getSpawnConfig("qa-test")?.profile).toBe("qa");
  });

  test("list returns all registered configs", () => {
    registerSpawnConfig({ ...config, mcpServers: ["vibe-kanban", "qa-agent"] });
    registerSpawnConfig({
      ...config,
      type: "dev-fix",
      mcpServers: ["vibe-kanban"],
      profile: "dev",
    });
    const names = listSpawnConfigs().map((c) => c.type).sort();
    expect(names).toEqual(["dev-fix", "qa-test"]);
  });

  test("re-registering same type overwrites previous", () => {
    registerSpawnConfig({ ...config, mcpServers: ["vibe-kanban", "qa-agent"] });
    registerSpawnConfig({
      ...config,
      mcpServers: ["vibe-kanban"],
      profile: "qa-v2",
    });
    expect(getSpawnConfig("qa-test")?.profile).toBe("qa-v2");
    expect(listSpawnConfigs().length).toBe(1);
  });

  test("getSpawnConfig returns undefined for unknown type", () => {
    expect(getSpawnConfig("nope")).toBeUndefined();
  });
});
