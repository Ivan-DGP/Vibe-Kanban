import { spawnProcess } from "./runtime";

export type { SpawnResult } from "./runtime";

export async function spawn(
  cmd: string[],
  opts: { cwd: string; env?: Record<string, string>; timeout?: number },
) {
  return spawnProcess(cmd, opts);
}
