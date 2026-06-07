// Runtime detection — checked once at import time
export const isBun = typeof globalThis.Bun !== "undefined";

// ── Process spawning (piped I/O) ──────────────────────────────

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function spawnProcess(
  cmd: string[],
  opts: {
    cwd: string;
    env?: Record<string, string>;
    timeout?: number;
    stdinData?: string;
    signal?: AbortSignal;
  },
): Promise<SpawnResult> {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SYSTEMROOT: process.env.SYSTEMROOT,
    ...opts.env,
  };

  if (isBun) {
    const proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: opts.stdinData ? "pipe" : null,
      env,
    });
    if (opts.stdinData && proc.stdin) {
      proc.stdin.write(opts.stdinData);
      proc.stdin.end();
    }
    // On timeout: SIGTERM, then escalate to SIGKILL after a grace period so a
    // child that ignores SIGTERM cannot keep `proc.exited` (and the caller)
    // pending forever.
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutId = opts.timeout
      ? setTimeout(() => {
          try {
            proc.kill();
          } catch {
            /* already gone */
          }
          killTimer = setTimeout(() => {
            try {
              proc.kill(9);
            } catch {
              /* already gone */
            }
          }, 2000);
        }, opts.timeout)
      : null;
    // Caller-driven cancellation: abort -> SIGTERM, then SIGKILL after a grace.
    const onAbort = () => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          proc.kill(9);
        } catch {
          /* already gone */
        }
      }, 2000);
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (killTimer) clearTimeout(killTimer);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }

  // Node.js path
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), {
      cwd: opts.cwd,
      env,
      stdio: [opts.stdinData ? "pipe" : "ignore", "pipe", "pipe"],
    });
    if (opts.stdinData && proc.stdin) {
      proc.stdin.write(opts.stdinData);
      proc.stdin.end();
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout!.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutId = opts.timeout
      ? setTimeout(() => {
          proc.kill(); // SIGTERM
          killTimer = setTimeout(() => proc.kill("SIGKILL"), 2000);
        }, opts.timeout)
      : null;

    const onAbort = () => {
      proc.kill();
      killTimer = setTimeout(() => proc.kill("SIGKILL"), 2000);
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killTimer) clearTimeout(killTimer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString().trim(),
        stderr: Buffer.concat(stderrChunks).toString().trim(),
        exitCode: code ?? 1,
      });
    });
    proc.on("error", () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killTimer) clearTimeout(killTimer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      resolve({ stdout: "", stderr: "spawn error", exitCode: 1 });
    });
  });
}

// ── Synchronous process spawning ──────────────────────────────

export function spawnProcessSync(
  cmd: string[],
  opts: { env?: Record<string, string> },
): { stdout: string; exitCode: number } {
  if (isBun) {
    const result = Bun.spawnSync(cmd, { env: opts.env });
    return { stdout: result.stdout.toString().trim(), exitCode: result.exitCode };
  }

  const { spawnSync } = require("node:child_process");
  const result = spawnSync(cmd[0], cmd.slice(1), {
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { stdout: (result.stdout ?? "").toString().trim(), exitCode: result.status ?? 1 };
}

// ── Streaming spawn (for SSE) ─────────────────────────────────

export interface StreamingProc {
  onData: (cb: (chunk: string) => void) => void;
  onStderr: (cb: (chunk: string) => void) => void;
  kill: () => void;
  /** Resolves with exit code AFTER stdout and stderr have been fully drained. */
  exited: Promise<number>;
}

export function spawnStreaming(
  cmd: string[],
  opts?: { env?: Record<string, string>; stdinData?: string },
): StreamingProc {
  if (isBun) {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: opts?.stdinData ? "pipe" : null,
    });
    if (opts?.stdinData && proc.stdin) {
      proc.stdin.write(opts.stdinData);
      proc.stdin.end();
    }

    // Always drain both streams; buffer chunks until a callback is registered.
    const stdoutBuf: string[] = [];
    const stderrBuf: string[] = [];
    let stdoutCb: ((chunk: string) => void) | null = null;
    let stderrCb: ((chunk: string) => void) | null = null;

    const drain = async (
      stream: ReadableStream<Uint8Array>,
      getCb: () => ((c: string) => void) | null,
      buf: string[],
    ) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const cb = getCb();
        if (cb) cb(text);
        else buf.push(text);
      }
    };

    const stdoutDone = drain(proc.stdout, () => stdoutCb, stdoutBuf);
    const stderrDone = drain(proc.stderr, () => stderrCb, stderrBuf);

    return {
      onData: (cb) => {
        stdoutCb = cb;
        while (stdoutBuf.length > 0) cb(stdoutBuf.shift()!);
      },
      onStderr: (cb) => {
        stderrCb = cb;
        while (stderrBuf.length > 0) cb(stderrBuf.shift()!);
      },
      kill: () => proc.kill(),
      exited: Promise.all([proc.exited, stdoutDone, stderrDone]).then(([code]) => code),
    };
  }

  // Node.js path
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const proc = spawn(cmd[0], cmd.slice(1), {
    stdio: [opts?.stdinData ? "pipe" : "ignore", "pipe", "pipe"],
  });
  if (opts?.stdinData && proc.stdin) {
    proc.stdin.write(opts.stdinData);
    proc.stdin.end();
  }

  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];
  let stdoutCb: ((chunk: string) => void) | null = null;
  let stderrCb: ((chunk: string) => void) | null = null;

  proc.stdout!.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (stdoutCb) stdoutCb(text);
    else stdoutBuf.push(text);
  });
  proc.stderr!.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (stderrCb) stderrCb(text);
    else stderrBuf.push(text);
  });

  let exitPromiseResolve: (code: number) => void;
  const exited = new Promise<number>((r) => {
    exitPromiseResolve = r;
  });
  // "close" fires after all stdio streams have been flushed and closed.
  proc.on("close", (code: number | null) => exitPromiseResolve(code ?? 1));
  proc.on("error", () => exitPromiseResolve(1));

  return {
    onData: (cb) => {
      stdoutCb = cb;
      while (stdoutBuf.length > 0) cb(stdoutBuf.shift()!);
    },
    onStderr: (cb) => {
      stderrCb = cb;
      while (stderrBuf.length > 0) cb(stderrBuf.shift()!);
    },
    kill: () => proc.kill(),
    exited,
  };
}

// ── File writing ──────────────────────────────────────────────

export async function writeFile(path: string, content: string): Promise<void> {
  if (isBun) {
    await Bun.write(path, content);
    return;
  }
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, content, "utf-8");
}

// ── PTY spawning ──────────────────────────────────────────────

export interface PtyHandle {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (exitCode: number) => void) => void;
}

export function spawnPty(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; cols: number; rows: number },
): PtyHandle {
  if (isBun) {
    // Bun built-in terminal PTY
    const dataCallbacks: ((data: string) => void)[] = [];
    const exitCallbacks: ((exitCode: number) => void)[] = [];

    const proc = Bun.spawn([cmd, ...args], {
      cwd: opts.cwd,
      env: opts.env,
      terminal: {
        cols: opts.cols,
        rows: opts.rows,
        data(_terminal: any, data: any) {
          const str = typeof data === "string" ? data : data.toString();
          for (const cb of dataCallbacks) cb(str);
        },
      },
    });

    proc.exited
      .then((code: number) => {
        for (const cb of exitCallbacks) cb(code ?? 0);
      })
      .catch(() => {
        for (const cb of exitCallbacks) cb(1);
      });

    return {
      write: (data) => proc.terminal?.write(data),
      resize: (cols, rows) => proc.terminal?.resize(cols, rows),
      kill: () => proc.kill?.(),
      onData: (cb) => dataCallbacks.push(cb),
      onExit: (cb) => exitCallbacks.push(cb),
    };
  }

  // Node.js path — use node-pty
  const nodePty = require("node-pty") as typeof import("node-pty");
  const pty = nodePty.spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env as Record<string, string>,
    cols: opts.cols,
    rows: opts.rows,
  });

  return {
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
    onData: (cb) => pty.onData(cb),
    onExit: (cb) => pty.onExit(({ exitCode }) => cb(exitCode)),
  };
}

// ── SQLite database ───────────────────────────────────────────

export interface DatabaseHandle {
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  };
  /** Alias for prepare() — bun:sqlite compatibility */
  query(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export function openDatabase(dbPath: string): DatabaseHandle {
  if (isBun) {
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath, { create: true });
    return {
      prepare: (sql: string) => db.prepare(sql),
      query: (sql: string) => db.query?.(sql) ?? db.prepare(sql),
      exec: (sql: string) => db.exec(sql),
      transaction: <T>(fn: () => T) => db.transaction(fn),
      close: () => db.close(),
    };
  }

  // Node.js — better-sqlite3
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(dbPath);
  return {
    prepare: (sql: string) => db.prepare(sql),
    query: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    transaction: <T>(fn: () => T) => db.transaction(fn),
    close: () => db.close(),
  };
}
