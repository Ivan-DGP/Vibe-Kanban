import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { findFreePort, setupShim } from "./pipeline";

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
});
