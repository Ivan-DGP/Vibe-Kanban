import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getReplayDir, isCaptureEnabled } from "./taskAiCapture";

describe("isCaptureEnabled", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.VK_BENCH_CAPTURE;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.VK_BENCH_CAPTURE;
    else process.env.VK_BENCH_CAPTURE = original;
  });

  test("off by default (env unset)", () => {
    delete process.env.VK_BENCH_CAPTURE;
    expect(isCaptureEnabled()).toBe(false);
  });

  test("off when set to anything other than '1'", () => {
    for (const v of ["0", "true", "yes", "on", ""]) {
      process.env.VK_BENCH_CAPTURE = v;
      expect(isCaptureEnabled()).toBe(false);
    }
  });

  test("on when set exactly to '1'", () => {
    process.env.VK_BENCH_CAPTURE = "1";
    expect(isCaptureEnabled()).toBe(true);
  });
});

describe("getReplayDir", () => {
  let original: string | undefined;
  let tmp = "";
  beforeEach(() => {
    original = process.env.VK_BENCH_REPLAY_DIR;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-replay-dir-"));
  });
  afterEach(() => {
    if (original === undefined) delete process.env.VK_BENCH_REPLAY_DIR;
    else process.env.VK_BENCH_REPLAY_DIR = original;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("respects VK_BENCH_REPLAY_DIR override", () => {
    const target = path.join(tmp, "custom");
    process.env.VK_BENCH_REPLAY_DIR = target;
    const dir = getReplayDir();
    expect(dir).toBe(target);
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("creates the override dir if it doesn't exist", () => {
    const target = path.join(tmp, "deep", "nested", "replays");
    process.env.VK_BENCH_REPLAY_DIR = target;
    expect(fs.existsSync(target)).toBe(false);
    getReplayDir();
    expect(fs.existsSync(target)).toBe(true);
  });

  test("default path resolves to repo benchmarks/replays", () => {
    delete process.env.VK_BENCH_REPLAY_DIR;
    const dir = getReplayDir();
    expect(dir.endsWith("benchmarks/replays")).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
  });
});
