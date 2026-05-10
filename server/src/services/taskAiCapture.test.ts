import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getReplayDir, isCaptureEnabled } from "./taskAiCapture";

describe("isCaptureEnabled", () => {
  let original: string | undefined;
  let originalNodeEnv: string | undefined;
  beforeEach(() => {
    original = process.env.VK_BENCH_CAPTURE;
    originalNodeEnv = process.env.NODE_ENV;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.VK_BENCH_CAPTURE;
    else process.env.VK_BENCH_CAPTURE = original;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  test("off in production when env unset", () => {
    delete process.env.VK_BENCH_CAPTURE;
    process.env.NODE_ENV = "production";
    expect(isCaptureEnabled()).toBe(false);
  });

  test("on in dev/test when env unset (NODE_ENV != production)", () => {
    delete process.env.VK_BENCH_CAPTURE;
    for (const env of ["development", "test", undefined]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      expect(isCaptureEnabled()).toBe(true);
    }
  });

  test("explicit '0' wins over dev default", () => {
    process.env.VK_BENCH_CAPTURE = "0";
    process.env.NODE_ENV = "development";
    expect(isCaptureEnabled()).toBe(false);
  });

  test("explicit '1' wins in production", () => {
    process.env.VK_BENCH_CAPTURE = "1";
    process.env.NODE_ENV = "production";
    expect(isCaptureEnabled()).toBe(true);
  });

  test("non-canonical values fall through to NODE_ENV default", () => {
    process.env.NODE_ENV = "production";
    for (const v of ["true", "yes", "on", ""]) {
      process.env.VK_BENCH_CAPTURE = v;
      expect(isCaptureEnabled()).toBe(false);
    }
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
