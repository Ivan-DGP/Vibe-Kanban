export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function spawn(
  cmd: string[],
  opts: { cwd: string; env?: Record<string, string>; timeout?: number },
): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SYSTEMROOT: process.env.SYSTEMROOT, ...opts.env },
  });

  const timeoutId = opts.timeout
    ? setTimeout(() => proc.kill(), opts.timeout)
    : null;

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (timeoutId) clearTimeout(timeoutId);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}
