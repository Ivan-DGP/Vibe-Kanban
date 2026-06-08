import { describe, test, expect, beforeEach } from "bun:test";
import { sink, info, warn, error } from "../src/log";
import { withContext } from "../src/withContext";

beforeEach(() => {
  sink.events.length = 0;
  delete process.env.VK_QUIET_INFO;
});

describe("VK_QUIET_INFO gate must apply at every entry point (target)", () => {
  test("info() with flag on suppresses the event", () => {
    process.env.VK_QUIET_INFO = "1";
    info("hello");
    expect(sink.events).toEqual([]);
  });

  test("warn() with flag on still pushes (flag is info-only)", () => {
    process.env.VK_QUIET_INFO = "1";
    warn("careful");
    expect(sink.events).toEqual([{ level: "warn", msg: "careful" }]);
  });

  test("error() with flag on still pushes", () => {
    process.env.VK_QUIET_INFO = "1";
    error("boom");
    expect(sink.events).toEqual([{ level: "error", msg: "boom" }]);
  });

  test("withContext().info() with flag on is also suppressed", () => {
    process.env.VK_QUIET_INFO = "1";
    const log = withContext("svc");
    log.info("hello");
    expect(sink.events).toEqual([]);
  });

  test("withContext().warn() and .error() with flag on still push", () => {
    process.env.VK_QUIET_INFO = "1";
    const log = withContext("svc");
    log.warn("careful");
    log.error("boom");
    expect(sink.events).toEqual([
      { level: "warn", msg: "[svc] careful" },
      { level: "error", msg: "[svc] boom" },
    ]);
  });

  test("flag toggle on/off is observed at call time", () => {
    info("a");
    process.env.VK_QUIET_INFO = "1";
    info("b");
    delete process.env.VK_QUIET_INFO;
    info("c");
    expect(sink.events.map((e) => e.msg)).toEqual(["a", "c"]);
  });
});
