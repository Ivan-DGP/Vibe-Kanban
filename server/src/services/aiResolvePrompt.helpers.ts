import fs from "node:fs";
import path from "node:path";
import { spawn } from "../lib/spawn";
import type { Project } from "@vibe-kanban/shared";

// Simple TTL cache for expensive file system / git operations
export const contextCache = new Map<string, { value: any; expiry: number }>();
export const CACHE_TTL = 30_000; // 30 seconds
const MAX_CACHE_SIZE = 200;

function evictExpired(): void {
  const now = Date.now();
  for (const [k, v] of contextCache) {
    if (v.expiry <= now) contextCache.delete(k);
  }
}

export function cached<T>(key: string, fn: () => T): T {
  const now = Date.now();
  const entry = contextCache.get(key);
  if (entry && entry.expiry > now) return entry.value as T;
  if (contextCache.size >= MAX_CACHE_SIZE) evictExpired();
  const value = fn();
  contextCache.set(key, { value, expiry: now + CACHE_TTL });
  return value;
}

export async function cachedAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = contextCache.get(key);
  if (entry && entry.expiry > now) return entry.value as T;
  if (contextCache.size >= MAX_CACHE_SIZE) evictExpired();
  const value = await fn();
  contextCache.set(key, { value, expiry: now + CACHE_TTL });
  return value;
}

// Wrap untrusted (user/sync-sourced) text in a sentinel-delimited block so the
// agent treats it as DATA, never as instructions. Strip any sentinel the input
// tries to forge.
export function fenceUntrusted(label: string, value: string): string {
  const open = `<<<UNTRUSTED_${label}>>>`;
  const close = `<<<END_UNTRUSTED_${label}>>>`;
  const safe = value.replace(/<<<\s*(?:END_)?UNTRUSTED_[A-Z_]*>>>/g, "[redacted-sentinel]");
  return `${open}\n${safe}\n${close}`;
}

// .gitignore-aware directory tree
const ALWAYS_SKIP = new Set([
  "node_modules",
  ".git",
  ".venv",
  "__pycache__",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".cache",
  ".turbo",
  ".svelte-kit",
  "coverage",
  ".DS_Store",
  "Thumbs.db",
]);

export function parseGitignore(projectPath: string): string[] {
  try {
    const content = fs.readFileSync(path.join(projectPath, ".gitignore"), "utf-8");
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

export function shouldSkip(name: string, gitignorePatterns: string[]): boolean {
  if (ALWAYS_SKIP.has(name)) return true;
  if (name.startsWith(".")) return true;
  for (const pattern of gitignorePatterns) {
    const clean = pattern.replace(/^\//, "").replace(/\/$/, "");
    if (name === clean) return true;
    if (clean.includes("*")) {
      // Escape regex metachars in literal portions, then turn '*' into '.*'.
      const body = clean
        .split("*")
        .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      const regex = new RegExp("^" + body + "$");
      if (regex.test(name)) return true;
    }
  }
  return false;
}

export function buildTree(
  dir: string,
  gitignorePatterns: string[],
  prefix = "",
  depth = 0,
  maxDepth = 3,
): string {
  if (depth > maxDepth) return "";
  let result = "";
  try {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !shouldSkip(e.name, gitignorePatterns))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";

      result += prefix + connector + entry.name + (entry.isDirectory() ? "/" : "") + "\n";
      if (entry.isDirectory()) {
        result += buildTree(
          path.join(dir, entry.name),
          gitignorePatterns,
          prefix + childPrefix,
          depth + 1,
          maxDepth,
        );
      }
    }
  } catch {}
  return result;
}

// Read architecture rules files
export function readRulesFile(projectPath: string): string | null {
  const candidates = ["AGENTS.md", ".cursorrules", "CLAUDE.md", ".github/copilot-instructions.md"];
  for (const file of candidates) {
    try {
      const content = fs.readFileSync(path.join(projectPath, file), "utf-8");
      if (content.trim()) return `[${file}]\n${content.trim()}`;
    } catch {}
  }
  return null;
}

// Read dependency files
export function readDependencies(projectPath: string): string | null {
  const deps: string[] = [];

  // package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf-8"));
    const lines: string[] = [];
    if (pkg.dependencies) lines.push("dependencies: " + Object.keys(pkg.dependencies).join(", "));
    if (pkg.devDependencies)
      lines.push("devDependencies: " + Object.keys(pkg.devDependencies).join(", "));
    if (pkg.scripts)
      lines.push(
        "scripts: " +
          Object.entries(pkg.scripts)
            .map(([k, v]) => `${k}: ${v}`)
            .join("; "),
      );
    if (lines.length) deps.push("[package.json]\n" + lines.join("\n"));
  } catch {}

  // requirements.txt
  try {
    const content = fs.readFileSync(path.join(projectPath, "requirements.txt"), "utf-8").trim();
    if (content) deps.push("[requirements.txt]\n" + content);
  } catch {}

  // docker-compose.yml
  try {
    const content = fs.readFileSync(path.join(projectPath, "docker-compose.yml"), "utf-8").trim();
    if (content) deps.push("[docker-compose.yml]\n" + content);
  } catch {}

  // Cargo.toml
  try {
    const content = fs.readFileSync(path.join(projectPath, "Cargo.toml"), "utf-8").trim();
    if (content) deps.push("[Cargo.toml]\n" + content);
  } catch {}

  // go.mod
  try {
    const content = fs.readFileSync(path.join(projectPath, "go.mod"), "utf-8").trim();
    if (content) deps.push("[go.mod]\n" + content);
  } catch {}

  return deps.length ? deps.join("\n\n") : null;
}

// Read key file snippets for AI context
export function readKeyFileSnippets(projectPath: string): string | null {
  const MAX_FILES = 8;
  const snippets: string[] = [];

  const candidates: { rel: string; maxLines: number }[] = [
    // Config files
    { rel: "tsconfig.json", maxLines: 80 },
    { rel: "vite.config.ts", maxLines: 80 },
    { rel: "vite.config.js", maxLines: 80 },
    { rel: "next.config.ts", maxLines: 80 },
    { rel: "next.config.js", maxLines: 80 },
    { rel: "next.config.mjs", maxLines: 80 },
    { rel: "tailwind.config.ts", maxLines: 80 },
    { rel: "tailwind.config.js", maxLines: 80 },
    { rel: ".env.example", maxLines: 80 },
    // Entry points
    { rel: "src/index.ts", maxLines: 50 },
    { rel: "src/index.tsx", maxLines: 50 },
    { rel: "src/main.ts", maxLines: 50 },
    { rel: "src/main.tsx", maxLines: 50 },
    { rel: "src/app.ts", maxLines: 50 },
    { rel: "src/app.tsx", maxLines: 50 },
    { rel: "src/App.tsx", maxLines: 50 },
    { rel: "src/App.vue", maxLines: 50 },
    { rel: "src/App.svelte", maxLines: 50 },
    { rel: "server/src/index.ts", maxLines: 50 },
    { rel: "server/src/app.ts", maxLines: 50 },
    { rel: "main.go", maxLines: 50 },
    { rel: "src/main.rs", maxLines: 50 },
    { rel: "src/lib.rs", maxLines: 50 },
    // Type definitions
    { rel: "src/types.ts", maxLines: 100 },
    { rel: "src/types/index.ts", maxLines: 100 },
    { rel: "shared/src/types.ts", maxLines: 100 },
  ];

  for (const { rel, maxLines } of candidates) {
    if (snippets.length >= MAX_FILES) break;
    try {
      const fullPath = path.join(projectPath, rel);
      const content = fs.readFileSync(fullPath, "utf-8");
      const allLines = content.split("\n");
      const lines = allLines.slice(0, maxLines);
      const truncated = allLines.length > maxLines;
      snippets.push(
        `[${rel}]${truncated ? ` (first ${maxLines} lines)` : ""}\n${lines.join("\n")}`,
      );
    } catch {}
  }

  return snippets.length ? snippets.join("\n\n") : null;
}

// Get working tree diff (staged + unstaged, capped)
export async function getGitDiff(
  projectPath: string,
  maxLines: number = 200,
): Promise<string | null> {
  try {
    const result = await spawn(["git", "diff", "HEAD", "--stat", "--patch", "--no-color"], {
      cwd: projectPath,
    });
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const lines = result.stdout.split("\n");
    if (lines.length <= maxLines) return result.stdout.trim();
    // If patch is too large, fall back to stat-only
    const statResult = await spawn(["git", "diff", "HEAD", "--stat", "--no-color"], {
      cwd: projectPath,
    });
    if (statResult.exitCode !== 0 || !statResult.stdout.trim()) return null;
    return (
      statResult.stdout.trim() +
      `\n\n(Full diff truncated — ${lines.length} lines. Showing stat summary only.)`
    );
  } catch {
    return null;
  }
}

// Get git info
export async function getGitInfo(
  projectPath: string,
  commitCount: number = 10,
): Promise<{ branch: string; recentCommits: string } | null> {
  try {
    const branchResult = await spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: projectPath,
    });
    if (branchResult.exitCode !== 0) return null;

    let recentCommits = "";
    if (commitCount > 0) {
      const logResult = await spawn(
        ["git", "log", "--oneline", `-${commitCount}`, "--format=%h %s"],
        { cwd: projectPath },
      );
      recentCommits = logResult.exitCode === 0 ? logResult.stdout.trim() : "";
    }

    return {
      branch: branchResult.stdout.trim(),
      recentCommits,
    };
  } catch {
    return null;
  }
}

export function rowToProject(row: any): Project {
  return {
    ...row,
    favorite: !!row.favorite,
    techStack: JSON.parse(row.techStack || "[]"),
    externalLinks: JSON.parse(row.externalLinks || "[]"),
  };
}

// Related task scoring by keyword overlap
export const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "it",
  "to",
  "in",
  "on",
  "of",
  "for",
  "and",
  "or",
  "not",
  "with",
  "as",
  "at",
  "by",
  "from",
  "be",
  "this",
  "that",
  "add",
  "update",
  "fix",
  "make",
  "use",
  "get",
  "set",
]);

export function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

export function scoreTaskRelevance(taskKeywords: Set<string>, otherTitle: string): number {
  const otherKw = extractKeywords(otherTitle);
  let overlap = 0;
  for (const kw of taskKeywords) {
    if (otherKw.has(kw)) overlap++;
  }
  return overlap;
}

export function rankRelatedTasks(
  taskTitle: string,
  taskDescription: string | null,
  otherTasks: { title: string; status: string; priority: string }[],
): { title: string; status: string; priority: string; related: boolean }[] {
  const keywords = extractKeywords(`${taskTitle} ${taskDescription ?? ""}`);
  const scored = otherTasks.map((t) => ({
    ...t,
    score: scoreTaskRelevance(keywords, t.title),
    related: scoreTaskRelevance(keywords, t.title) > 0,
  }));
  // Sort: related tasks first (by score desc), then unrelated
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
