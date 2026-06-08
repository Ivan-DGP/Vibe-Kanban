import fs from "node:fs";
import path from "node:path";

export interface MultiFileResult {
  allTouched: boolean;
  missing: string[];
  trivial: string[];
}

export function stripCommentsAndWhitespace(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let inString: '"' | "'" | "`" | null = null;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (inString) {
      if (c === "\\" && i + 1 < n) {
        out += c + src[i + 1];
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c as '"' | "'" | "`";
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

async function runGit(args: string[], cwd: string): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, _stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout };
}

export async function verifyMultiFile(
  workDir: string,
  requireFiles: string[],
): Promise<MultiFileResult> {
  if (!requireFiles || requireFiles.length === 0) {
    return { allTouched: true, missing: [], trivial: [] };
  }
  const numstat = await runGit(["diff", "--numstat", "HEAD"], workDir);
  const changedSet = new Set<string>();
  for (const line of numstat.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    changedSet.add(parts.slice(2).join(" "));
  }
  const missing: string[] = [];
  const trivial: string[] = [];
  for (const rel of requireFiles) {
    if (!changedSet.has(rel)) {
      missing.push(rel);
      continue;
    }
    const before = await runGit(["show", `HEAD:${rel}`], workDir);
    let beforeContent = "";
    if (before.exitCode === 0) beforeContent = before.stdout;
    const abs = path.join(workDir, rel);
    let afterContent = "";
    try {
      afterContent = fs.readFileSync(abs, "utf-8");
    } catch {
      afterContent = "";
    }
    const beforeNorm = stripCommentsAndWhitespace(beforeContent);
    const afterNorm = stripCommentsAndWhitespace(afterContent);
    if (beforeNorm === afterNorm) trivial.push(rel);
  }
  return { allTouched: missing.length === 0 && trivial.length === 0, missing, trivial };
}
