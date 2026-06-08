import { describe, test, expect } from "bun:test";
import {
  createRunStream,
  emitLine,
  emitStatus,
  flushPartials,
  ingestChunk,
  MAX_LINES,
  type SseEvent,
} from "./benchRunStream";

describe("createRunStream", () => {
  test("starts empty + not finished", () => {
    const s = createRunStream();
    expect(s.lines).toEqual([]);
    expect(s.partial).toEqual({ stdout: "", stderr: "" });
    expect(s.subscribers.size).toBe(0);
    expect(s.finished).toBe(false);
  });
});

describe("ingestChunk", () => {
  test("splits on \\n, holds back trailing partial", () => {
    const s = createRunStream();
    ingestChunk(s, "stdout", "alpha\nbeta\ngam");
    expect(s.lines).toEqual(["alpha", "beta"]);
    expect(s.partial.stdout).toBe("gam");
  });

  test("joins partial with subsequent chunk", () => {
    const s = createRunStream();
    ingestChunk(s, "stdout", "fragment-");
    expect(s.lines).toEqual([]);
    expect(s.partial.stdout).toBe("fragment-");
    ingestChunk(s, "stdout", "complete\nnext");
    expect(s.lines).toEqual(["fragment-complete"]);
    expect(s.partial.stdout).toBe("next");
  });

  test("stdout and stderr partials are tracked independently", () => {
    const s = createRunStream();
    ingestChunk(s, "stdout", "out-frag");
    ingestChunk(s, "stderr", "err-frag");
    ingestChunk(s, "stdout", "ment\n");
    ingestChunk(s, "stderr", "ment\n");
    expect(s.lines).toEqual(["out-fragment", "err-fragment"]);
    expect(s.partial).toEqual({ stdout: "", stderr: "" });
  });

  test("notifies subscribers per emitted line", () => {
    const s = createRunStream();
    const seen: SseEvent[] = [];
    s.subscribers.add((e) => seen.push(e));
    ingestChunk(s, "stdout", "one\ntwo\nthree\n");
    expect(seen).toEqual([
      { event: "log", data: "one" },
      { event: "log", data: "two" },
      { event: "log", data: "three" },
    ]);
  });

  test("subscriber that throws does not break others", () => {
    const s = createRunStream();
    const seen: string[] = [];
    s.subscribers.add(() => {
      throw new Error("boom");
    });
    s.subscribers.add((e) => {
      if (e.event === "log") seen.push(e.data);
    });
    ingestChunk(s, "stdout", "ok\n");
    expect(seen).toEqual(["ok"]);
  });
});

describe("flushPartials", () => {
  test("emits non-empty trailing partials, clears them", () => {
    const s = createRunStream();
    ingestChunk(s, "stdout", "no-newline-out");
    ingestChunk(s, "stderr", "no-newline-err");
    flushPartials(s);
    expect(s.lines).toEqual(["no-newline-out", "no-newline-err"]);
    expect(s.partial).toEqual({ stdout: "", stderr: "" });
  });

  test("idempotent on empty partials", () => {
    const s = createRunStream();
    flushPartials(s);
    flushPartials(s);
    expect(s.lines).toEqual([]);
  });
});

describe("emitLine cap", () => {
  test("caps lines at MAX_LINES (drops oldest)", () => {
    const s = createRunStream();
    for (let i = 0; i < MAX_LINES + 100; i++) emitLine(s, `line-${i}`);
    expect(s.lines.length).toBe(MAX_LINES);
    expect(s.lines[0]).toBe("line-100");
    expect(s.lines[s.lines.length - 1]).toBe(`line-${MAX_LINES + 99}`);
  });
});

describe("emitStatus", () => {
  test("marks finished, notifies subscribers, clears them", () => {
    const s = createRunStream();
    const seen: SseEvent[] = [];
    s.subscribers.add((e) => seen.push(e));
    s.subscribers.add((e) => seen.push(e));
    emitStatus(s, { status: "done", exitCode: 0 });
    expect(s.finished).toBe(true);
    expect(s.subscribers.size).toBe(0);
    expect(seen).toEqual([
      { event: "status", data: { status: "done", exitCode: 0 } },
      { event: "status", data: { status: "done", exitCode: 0 } },
    ]);
  });

  test("error status with non-zero exit code", () => {
    const s = createRunStream();
    const received: SseEvent[] = [];
    s.subscribers.add((e) => {
      received.push(e);
    });
    emitStatus(s, { status: "error", exitCode: 137 });
    expect(received).toEqual([{ event: "status", data: { status: "error", exitCode: 137 } }]);
  });
});
