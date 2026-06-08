import { describe, test, expect, beforeEach } from "bun:test";
import { sink, info, warn, error } from "../src/log";
import { withContext } from "../src/withContext";

beforeEach(() => {
  sink.events.length = 0;
  delete process.env.VK_QUIET_INFO;
});

describe("logger — base behavior (regression)", () => {
  test("info() with flag off pushes the event", () => {
    info("hello");
    expect(sink.events).toEqual([{ level: "info", msg: "hello" }]);
  });

  test("warn() always pushes (no flag set)", () => {
    warn("careful");
    expect(sink.events).toEqual([{ level: "warn", msg: "careful" }]);
  });

  test("error() always pushes", () => {
    error("boom");
    expect(sink.events).toEqual([{ level: "error", msg: "boom" }]);
  });

  test("withContext prepends prefix", () => {
    const log = withContext("svc");
    log.info("hello");
    log.warn("careful");
    log.error("boom");
    expect(sink.events).toEqual([
      { level: "info", msg: "[svc] hello" },
      { level: "warn", msg: "[svc] careful" },
      { level: "error", msg: "[svc] boom" },
    ]);
  });

  test("multiple calls accumulate in order", () => {
    info("a");
    error("b");
    warn("c");
    expect(sink.events.map((e) => e.msg)).toEqual(["a", "b", "c"]);
  });
});
