import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { findFreePort, setupShim, substituteVars, runHttpScript } from "./pipeline";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-test-"));
});

afterEach(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("findFreePort", () => {
  test("returns a port in the unprivileged range", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port).toBeLessThanOrEqual(65535);
  });

  test("returned port is actually bindable", async () => {
    const port = await findFreePort();
    await new Promise<void>((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(port, "127.0.0.1", () => srv.close(() => resolve()));
    });
  });

  test("two consecutive calls hand out distinct ports", async () => {
    const a = await findFreePort();
    const b = await findFreePort();
    expect(a).not.toBe(b);
  });
});

describe("setupShim", () => {
  test("creates an executable claude wrapper that execs the fake-claude script", () => {
    const shimDir = path.join(tmpRoot, "shim");
    const fakeClaude = path.join(tmpRoot, "fake.ts");
    fs.writeFileSync(fakeClaude, "#!/usr/bin/env bun\nconsole.log('hi');\n");

    setupShim(shimDir, fakeClaude);

    const claudePath = path.join(shimDir, "claude");
    expect(fs.existsSync(claudePath)).toBe(true);
    const mode = fs.statSync(claudePath).mode & 0o777;
    expect(mode).toBe(0o755);
    const body = fs.readFileSync(claudePath, "utf-8");
    expect(body).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(body).toContain("exec bun");
    expect(body).toContain(JSON.stringify(fakeClaude));
  });

  test("invoking the shim runs the fake script with passed args", async () => {
    const shimDir = path.join(tmpRoot, "shim");
    const fakeClaude = path.join(tmpRoot, "fake.ts");
    fs.writeFileSync(
      fakeClaude,
      "#!/usr/bin/env bun\nprocess.stdout.write(JSON.stringify({ args: process.argv.slice(2) }));\n",
    );

    setupShim(shimDir, fakeClaude);

    const proc = Bun.spawn([path.join(shimDir, "claude"), "-p", "hello world"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(out)).toEqual({ args: ["-p", "hello world"] });
  });

  test("propagates extraEnv through the bash wrapper into the spawned process", async () => {
    const shimDir = path.join(tmpRoot, "shim");
    const fakeClaude = path.join(tmpRoot, "fake.ts");
    fs.writeFileSync(
      fakeClaude,
      "#!/usr/bin/env bun\nprocess.stdout.write(JSON.stringify({\n  rate: process.env.VK_INJECT_MCP_500_RATE ?? null,\n  api: process.env.VK_BENCH_API_URL ?? null,\n}));\n",
    );

    setupShim(shimDir, fakeClaude, "http://127.0.0.1:9999", {
      VK_INJECT_MCP_500_RATE: "0.42",
    });

    const proc = Bun.spawn([path.join(shimDir, "claude")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(out)).toEqual({
      rate: "0.42",
      api: "http://127.0.0.1:9999",
    });
  });
});

describe("substituteVars", () => {
  test("replaces a single ${var} reference inside a longer string", () => {
    const out = substituteVars("/api/tasks/${task.id}", { task: { id: "abc-123" } });
    expect(out).toBe("/api/tasks/abc-123");
  });

  test("preserves type when the whole string is one ${expr} reference", () => {
    const out = substituteVars("${task.id}", { task: { id: "uuid-1" } });
    expect(out).toBe("uuid-1");
    const num = substituteVars("${task.taskNumber}", { task: { taskNumber: 7 } });
    expect(num).toBe(7);
    const obj = substituteVars("${task}", { task: { id: "x" } });
    expect(obj).toEqual({ id: "x" });
  });

  test("traverses array indices via [n] notation", () => {
    const out = substituteVars("${list[1].id}", { list: [{ id: "a" }, { id: "b" }] });
    expect(out).toBe("b");
  });

  test("recurses into arrays and objects, leaves non-strings untouched", () => {
    const ctx = { task: { id: "tid" } };
    expect(substituteVars({ url: "/x/${task.id}", n: 5 }, ctx)).toEqual({
      url: "/x/tid",
      n: 5,
    });
    expect(substituteVars(["a", "${task.id}", 1, null], ctx)).toEqual(["a", "tid", 1, null]);
  });

  test("missing references inside a longer string become empty", () => {
    expect(substituteVars("prefix-${nope}-suffix", {})).toBe("prefix--suffix");
  });

  test("missing whole-string reference returns undefined", () => {
    expect(substituteVars("${nope}", {})).toBeUndefined();
  });
});

describe("runHttpScript", () => {
  function fakeApp(handlers: Record<string, (req: any) => { statusCode: number; body: string }>) {
    return {
      inject: async (req: any) => {
        const key = `${req.method} ${req.url}`;
        const handler = handlers[key];
        if (!handler) return { statusCode: 404, body: '{"error":"no fake handler"}' };
        return handler(req);
      },
    };
  }

  test("threads saveAs context into later URLs and payloads", async () => {
    const app = fakeApp({
      "POST /api/things": () => ({
        statusCode: 200,
        body: JSON.stringify({ id: "thing-1", title: "hello" }),
      }),
      "GET /api/things/thing-1": () => ({
        statusCode: 200,
        body: JSON.stringify({ id: "thing-1", title: "hello" }),
      }),
    });
    const results = await runHttpScript(
      app,
      [
        {
          name: "create",
          method: "POST",
          url: "/api/things",
          payload: { title: "hello" },
          expect: {
            statusCode: 200,
            jsonPath: [{ path: "id", value: "thing-1" }],
            saveAs: "thing",
          },
        },
        {
          name: "fetch",
          method: "GET",
          url: "/api/things/${thing.id}",
          expect: {
            statusCode: 200,
            jsonPath: [{ path: "id", value: "${thing.id}" }],
          },
        },
      ],
      {},
    );
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(true);
    expect(results[1].url).toBe("/api/things/thing-1");
  });

  test("stops at the first failing step and reports the mismatch", async () => {
    const app = fakeApp({
      "POST /api/x": () => ({ statusCode: 500, body: "boom" }),
      "GET /api/y": () => ({ statusCode: 200, body: "{}" }),
    });
    const results = await runHttpScript(
      app,
      [
        { name: "fail-first", method: "POST", url: "/api/x", expect: { statusCode: 200 } },
        { name: "never-runs", method: "GET", url: "/api/y" },
      ],
      {},
    );
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].error).toContain("expected statusCode 200, got 500");
  });

  test("bodyContains and jsonPath assertions both fire", async () => {
    const app = fakeApp({
      "GET /api/n": () => ({ statusCode: 200, body: JSON.stringify({ a: { b: 1 } }) }),
    });
    const ok = await runHttpScript(
      app,
      [
        {
          name: "match",
          method: "GET",
          url: "/api/n",
          expect: { bodyContains: '"b":1', jsonPath: [{ path: "a.b", value: 1 }] },
        },
      ],
      {},
    );
    expect(ok[0].passed).toBe(true);

    const bad = await runHttpScript(
      app,
      [
        {
          name: "wrong-jsonpath",
          method: "GET",
          url: "/api/n",
          expect: { jsonPath: [{ path: "a.b", value: 99 }] },
        },
      ],
      {},
    );
    expect(bad[0].passed).toBe(false);
    expect(bad[0].error).toContain("jsonPath a.b");
  });

  test("treats non-JSON body as a string for jsonPath root lookups", async () => {
    const app = fakeApp({
      "GET /api/text": () => ({ statusCode: 200, body: "" }),
    });
    const results = await runHttpScript(
      app,
      [
        {
          name: "empty",
          method: "GET",
          url: "/api/text",
          expect: { statusCode: 200, jsonPath: [{ path: "", value: "" }] },
        },
      ],
      {},
    );
    expect(results[0].passed).toBe(true);
  });

  test("substitutes ${...} inside expect.jsonPath values", async () => {
    const app = fakeApp({
      "POST /api/seed": () => ({ statusCode: 200, body: JSON.stringify({ id: "seed-1" }) }),
      "GET /api/lookup": () => ({ statusCode: 200, body: JSON.stringify({ id: "seed-1" }) }),
    });
    const results = await runHttpScript(
      app,
      [
        {
          name: "seed",
          method: "POST",
          url: "/api/seed",
          expect: { statusCode: 200, saveAs: "seed" },
        },
        {
          name: "lookup",
          method: "GET",
          url: "/api/lookup",
          expect: { jsonPath: [{ path: "id", value: "${seed.id}" }] },
        },
      ],
      {},
    );
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
