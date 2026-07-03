import { describe, test, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readUsageResetFromCache } from "./usageCache";

const prevTemp = process.env.TEMP;

afterEach(() => {
  if (prevTemp === undefined) delete process.env.TEMP;
  else process.env.TEMP = prevTemp;
});

function withTempClaudeDir(write?: (dir: string) => void): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "vk-usage-cache-"));
  const claudeDir = path.join(base, "claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  if (write) write(claudeDir);
  process.env.TEMP = base;
  return base;
}

describe("readUsageResetFromCache", () => {
  test("returns null when the claude dir is missing", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "vk-usage-empty-"));
    process.env.TEMP = base; // no `claude` subdir
    expect(readUsageResetFromCache()).toBeNull();
    fs.rmSync(base, { recursive: true, force: true });
  });

  test("returns null when no statusline cache file exists", () => {
    const base = withTempClaudeDir();
    expect(readUsageResetFromCache()).toBeNull();
    fs.rmSync(base, { recursive: true, force: true });
  });

  test("returns null on malformed JSON", () => {
    const base = withTempClaudeDir((dir) => {
      fs.writeFileSync(path.join(dir, "statusline-usage-cache-abc.json"), "{ not json");
    });
    expect(readUsageResetFromCache()).toBeNull();
    fs.rmSync(base, { recursive: true, force: true });
  });

  test("parses five_hour.resets_at", () => {
    const iso = "2030-01-01T00:00:00.000Z";
    const base = withTempClaudeDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "statusline-usage-cache-xyz.json"),
        JSON.stringify({ five_hour: { resets_at: iso } }),
      );
    });
    const d = readUsageResetFromCache();
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toBe(iso);
    fs.rmSync(base, { recursive: true, force: true });
  });

  test("tolerates key drift (resetsAt / reset_at)", () => {
    const iso = "2031-06-15T12:00:00.000Z";
    const base = withTempClaudeDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "statusline-usage-cache-drift.json"),
        JSON.stringify({ resetsAt: iso }),
      );
    });
    expect(readUsageResetFromCache()!.toISOString()).toBe(iso);
    fs.rmSync(base, { recursive: true, force: true });
  });
});
