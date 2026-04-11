import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import type { Task, Project, PromptProfile } from "@vibe-kanban/shared";

// Simple TTL cache for expensive file system / git operations
const contextCache = new Map<string, { value: any; expiry: number }>();
const CACHE_TTL = 30_000; // 30 seconds

function cached<T>(key: string, fn: () => T): T {
  const now = Date.now();
  const entry = contextCache.get(key);
  if (entry && entry.expiry > now) return entry.value as T;
  const value = fn();
  contextCache.set(key, { value, expiry: now + CACHE_TTL });
  return value;
}

async function cachedAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = contextCache.get(key);
  if (entry && entry.expiry > now) return entry.value as T;
  const value = await fn();
  contextCache.set(key, { value, expiry: now + CACHE_TTL });
  return value;
}

// .gitignore-aware directory tree
const ALWAYS_SKIP = new Set([
  "node_modules", ".git", ".venv", "__pycache__", ".next", ".nuxt",
  "dist", "build", ".cache", ".turbo", ".svelte-kit", "coverage",
  ".DS_Store", "Thumbs.db",
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
      const regex = new RegExp("^" + clean.replace(/\*/g, ".*") + "$");
      if (regex.test(name)) return true;
    }
  }
  return false;
}

export function buildTree(dir: string, gitignorePatterns: string[], prefix = "", depth = 0, maxDepth = 3): string {
  if (depth > maxDepth) return "";
  let result = "";
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
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
function readRulesFile(projectPath: string): string | null {
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
function readDependencies(projectPath: string): string | null {
  const deps: string[] = [];

  // package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf-8"));
    const lines: string[] = [];
    if (pkg.dependencies) lines.push("dependencies: " + Object.keys(pkg.dependencies).join(", "));
    if (pkg.devDependencies) lines.push("devDependencies: " + Object.keys(pkg.devDependencies).join(", "));
    if (pkg.scripts) lines.push("scripts: " + Object.entries(pkg.scripts).map(([k, v]) => `${k}: ${v}`).join("; "));
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
function readKeyFileSnippets(projectPath: string): string | null {
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
async function getGitDiff(projectPath: string, maxLines: number = 200): Promise<string | null> {
  try {
    const result = await spawn(["git", "diff", "HEAD", "--stat", "--patch", "--no-color"], { cwd: projectPath });
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const lines = result.stdout.split("\n");
    if (lines.length <= maxLines) return result.stdout.trim();
    // If patch is too large, fall back to stat-only
    const statResult = await spawn(["git", "diff", "HEAD", "--stat", "--no-color"], { cwd: projectPath });
    if (statResult.exitCode !== 0 || !statResult.stdout.trim()) return null;
    return statResult.stdout.trim() + `\n\n(Full diff truncated — ${lines.length} lines. Showing stat summary only.)`;
  } catch {
    return null;
  }
}

// Get git info
async function getGitInfo(projectPath: string, commitCount: number = 10): Promise<{ branch: string; recentCommits: string } | null> {
  try {
    const branchResult = await spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectPath });
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
const STOP_WORDS = new Set(["the", "a", "an", "is", "it", "to", "in", "on", "of", "for", "and", "or", "not", "with", "as", "at", "by", "from", "be", "this", "that", "add", "update", "fix", "make", "use", "get", "set"]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function scoreTaskRelevance(
  taskKeywords: Set<string>,
  otherTitle: string,
): number {
  const otherKw = extractKeywords(otherTitle);
  let overlap = 0;
  for (const kw of taskKeywords) {
    if (otherKw.has(kw)) overlap++;
  }
  return overlap;
}

function rankRelatedTasks(
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

// ============================================================
// Prompt Profile System
// ============================================================

type ResolvedProfile = Exclude<PromptProfile, "auto">;

interface ProfileConfig {
  includeTree: boolean;
  treeMaxDepth: number;
  includeDeps: boolean;
  includeCommits: boolean;
  commitCount: number;
  includeOtherTasks: boolean;
  includeRules: boolean;
}

const PROFILE_CONFIGS: Record<ResolvedProfile, ProfileConfig> = {
  "quick-fix": {
    includeTree: false,
    treeMaxDepth: 0,
    includeDeps: false,
    includeCommits: false,
    commitCount: 0,
    includeOtherTasks: false,
    includeRules: true,
  },
  "feature": {
    includeTree: true,
    treeMaxDepth: 3,
    includeDeps: true,
    includeCommits: true,
    commitCount: 10,
    includeOtherTasks: true,
    includeRules: true,
  },
  "refactor": {
    includeTree: true,
    treeMaxDepth: 4,
    includeDeps: true,
    includeCommits: true,
    commitCount: 10,
    includeOtherTasks: false,
    includeRules: true,
  },
  "bug-fix": {
    includeTree: true,
    treeMaxDepth: 3,
    includeDeps: true,
    includeCommits: true,
    commitCount: 20,
    includeOtherTasks: false,
    includeRules: true,
  },
  "docs": {
    includeTree: true,
    treeMaxDepth: 2,
    includeDeps: false,
    includeCommits: false,
    commitCount: 0,
    includeOtherTasks: false,
    includeRules: true,
  },
};

/**
 * Auto-detect the best prompt profile from task content.
 * Exported so it can be used by the API to show the resolved profile to users.
 */
export function classifyTaskProfile(task: Pick<Task, "title" | "description" | "prompt">): ResolvedProfile {
  const text = `${task.title} ${task.description ?? ""} ${task.prompt ?? ""}`.toLowerCase();

  // Documentation signals
  if (/\b(docs?|documentation|readme|jsdoc|typedoc|changelog|guide|api docs)\b/.test(text)
    && !/\b(fix|bug|implement|add feature|create|build)\b/.test(text)) {
    return "docs";
  }

  // Quick-fix signals: typos, config tweaks, one-liners
  if (/\b(typo|rename|config|env var|constant|version bump|one-liner|tweak|toggle|flag|wording|spelling)\b/.test(text)) {
    return "quick-fix";
  }

  // Bug-fix signals
  if (/\b(bug|fix|crash|error|broken|regression|issue|failing|undefined is not|null pointer|exception|wrong|incorrect|doesn'?t work)\b/.test(text)) {
    return "bug-fix";
  }

  // Refactor signals (with negative guard for features)
  if (/\b(refactor|restructure|reorganize|clean ?up|extract|decouple|simplify|migrate|move files?|split|consolidate|tech debt)\b/.test(text)
    && !/\b(add|new|create|implement)\b/.test(text)) {
    return "refactor";
  }

  // Default: feature (safest — provides full context)
  return "feature";
}

/**
 * Estimate task complexity from content length and structure.
 * Returns a multiplier that adjusts context depth:
 *   "small" = less context (0.5x), "medium" = standard (1x), "large" = more context (1.5x)
 */
export function estimateComplexity(task: Pick<Task, "title" | "description" | "prompt">): "small" | "medium" | "large" {
  const titleLen = task.title?.length ?? 0;
  const descLen = task.description?.length ?? 0;
  const promptLen = task.prompt?.length ?? 0;
  const totalLen = titleLen + descLen + promptLen;

  // Heuristics: short title, no desc/prompt = small
  if (totalLen < 100 && !task.prompt) return "small";
  // Long descriptions or detailed prompts = large
  if (totalLen > 500 || promptLen > 200) return "large";
  return "medium";
}

function applyComplexityToConfig(config: ProfileConfig, complexity: "small" | "medium" | "large"): ProfileConfig {
  if (complexity === "small") {
    return {
      ...config,
      treeMaxDepth: Math.max(config.treeMaxDepth - 1, 1),
      commitCount: Math.min(config.commitCount, 5),
      includeOtherTasks: false,
    };
  }
  if (complexity === "large") {
    return {
      ...config,
      treeMaxDepth: config.treeMaxDepth + 1,
      commitCount: Math.max(config.commitCount, 15),
    };
  }
  return config;
}

function buildProfileInstructions(
  profile: ResolvedProfile,
  project: Project,
  task: Task,
  gitInstruction: string,
): string {
  const explore = `Explore the codebase at ${project.path} to understand the current state`;

  switch (profile) {
    case "quick-fix":
      return `## Instructions
1. Read the task description and technical details above carefully
2. Make the MINIMAL change required to accomplish this task
3. Do NOT refactor surrounding code or make unrelated improvements
4. ${gitInstruction}

IMPORTANT: This is a quick-fix task. Keep changes to as few files and lines as possible.`;

    case "feature":
      return `## Instructions
1. Read the task description and technical details above carefully
2. ${explore}
3. Plan the implementation before writing code
4. Implement the required changes
5. Add or update tests if a test framework is available
6. ${gitInstruction}`;

    case "refactor":
      return `## Instructions
1. Read the task description and technical details above carefully
2. ${explore}
3. CRITICAL: This is a refactor. There must be NO behavior changes. Inputs and outputs must remain identical.
4. Run existing tests before making changes to establish a baseline
5. Implement the restructuring
6. Run tests again to confirm no regressions
7. If tests fail, revert and try a different approach
8. ${gitInstruction}

IMPORTANT: After completing changes, do a self-review: compare your diff against the original behavior. Any functional change is a bug.`;

    case "bug-fix":
      return `## Instructions
1. Read the task description and technical details above carefully
2. ${explore}
3. FIRST: Reproduce the bug. Identify the exact failure condition.
4. Identify the root cause (not just symptoms)
5. Implement the fix
6. Verify the fix resolves the issue
7. Check for similar bugs in related code paths
8. ${gitInstruction}

IMPORTANT: Include details of what caused the bug and how it was fixed in your commit message / task summary.`;

    case "docs":
      return `## Instructions
1. Read the task description above carefully
2. Review existing documentation style and conventions in the project
3. Write or update documentation as specified
4. Do NOT make code changes unless the task explicitly requires them
5. Follow the existing documentation format (markdown style, heading levels, etc.)
6. ${gitInstruction}

IMPORTANT: Focus only on documentation. Do not refactor or fix code.`;
  }
}

// ============================================================
// Prompt Builders
// ============================================================

export async function buildAnalyzePrompt(
  task: Task,
  projectId: string,
): Promise<string> {
  const db = getDb();

  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!projectRow) throw new Error("Project not found");
  const project = rowToProject(projectRow);

  const rawOtherTasks = db
    .prepare("SELECT title, status, priority FROM tasks WHERE projectId = ? AND id != ? AND status NOT IN ('done', 'approved') LIMIT 20")
    .all(projectId, task.id) as { title: string; status: string; priority: string }[];
  const otherTasks = rankRelatedTasks(task.title, task.description, rawOtherTasks);

  const gitignorePatterns = cached(`gitignore:${project.path}`, () => parseGitignore(project.path));
  const depth = project.treeDepth ?? 3;
  const tree = cached(`tree:${project.path}:${depth}`, () => buildTree(project.path, gitignorePatterns, "", 0, depth));
  const rules = cached(`rules:${project.path}`, () => readRulesFile(project.path));
  const deps = cached(`deps:${project.path}`, () => readDependencies(project.path));
  const gitInfo = await cachedAsync(`gitinfo:${project.path}`, () => getGitInfo(project.path));
  const gitDiff = await cachedAsync(`gitdiff:${project.path}`, () => getGitDiff(project.path));
  const keyFiles = cached(`keyfiles:${project.path}`, () => readKeyFileSnippets(project.path));
  const projectInstructions = project.aiInstructions?.trim() || null;
  const milestoneInstructions = task.milestoneId
    ? (db.prepare("SELECT aiInstructions FROM milestones WHERE id = ?").get(task.milestoneId) as any)?.aiInstructions?.trim() || null
    : null;

  const parts: string[] = [];

  parts.push(`You are analyzing a development task to provide structured context for a developer. Do NOT implement anything — only analyze and explain.

# Task: ${task.title}

Project: ${project.name}
Path: ${project.path}
Tech Stack: ${project.techStack.join(", ") || "unknown"}${gitInfo ? `\nBranch: ${gitInfo.branch}` : ""}
Priority: ${task.priority.toUpperCase()}
Status: ${task.status}`);

  if (task.description) {
    parts.push(`## Description\n${task.description}`);
  }

  if (task.prompt) {
    parts.push(`## Technical Details\n${task.prompt}`);
  }

  parts.push(`<project_context>`);

  if (rules) {
    parts.push(`  <architecture_rules>\n${rules}\n  </architecture_rules>`);
  }

  if (projectInstructions) {
    parts.push(`  <project_ai_instructions>\n${projectInstructions}\n  </project_ai_instructions>`);
  }

  if (milestoneInstructions) {
    parts.push(`  <milestone_ai_instructions>\n${milestoneInstructions}\n  </milestone_ai_instructions>`);
  }

  parts.push(`  <project_tree>\n${tree || "  (unable to read directory)"}\n  </project_tree>`);

  if (deps) {
    parts.push(`  <dependencies>\n${deps}\n  </dependencies>`);
  }

  if (keyFiles) {
    parts.push(`  <key_file_snippets>\n${keyFiles}\n  </key_file_snippets>`);
  }

  if (otherTasks.length > 0) {
    const related = otherTasks.filter((t) => t.related);
    const other = otherTasks.filter((t) => !t.related);
    let taskLines = "";
    if (related.length > 0) {
      taskLines += related.map((t) => `    - [${t.status}][${t.priority}] ${t.title} (related)`).join("\n");
    }
    if (other.length > 0) {
      if (taskLines) taskLines += "\n";
      taskLines += other.map((t) => `    - [${t.status}][${t.priority}] ${t.title}`).join("\n");
    }
    parts.push(`  <other_active_tasks>\n${taskLines}\n  </other_active_tasks>`);
  }

  if (gitInfo?.recentCommits) {
    parts.push(`  <recent_commits>\n${gitInfo.recentCommits}\n  </recent_commits>`);
  }

  if (gitDiff) {
    parts.push(`  <working_tree_diff>\n${gitDiff}\n  </working_tree_diff>`);
  }

  parts.push(`</project_context>`);

  parts.push(`## Instructions

Analyze this task and provide structured developer context using EXACTLY these markdown sections:

## Relevant Files
List the key files that need to be read or modified for this task. Include paths relative to the project root and a one-line description of each file's relevance.

## Current Code State
Describe what currently exists in the codebase that relates to this task. Reference specific files and patterns based on the project tree.

## Suggested Approach
Provide a concrete step-by-step implementation plan. Reference actual file paths, component names, and function names from the project tree.

## Dependencies
List external packages, internal modules, or other tasks that this task depends on or that depend on it.

## Potential Risks
Identify pitfalls, edge cases, breaking changes, or technical challenges the developer should watch out for.`);

  return parts.join("\n\n");
}

export async function buildAiResolvePrompt(
  task: Task,
  projectId: string,
  port: number,
): Promise<string> {
  const db = getDb();

  // Get project
  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!projectRow) throw new Error("Project not found");
  const project = rowToProject(projectRow);

  // Resolve effective profile
  const effectiveProfile: ResolvedProfile =
    task.promptProfile === "auto"
      ? classifyTaskProfile(task)
      : (task.promptProfile as ResolvedProfile);

  // Apply complexity scoring to adjust context depth
  const complexity = estimateComplexity(task);
  const config = applyComplexityToConfig(PROFILE_CONFIGS[effectiveProfile], complexity);

  // Build context pieces conditionally based on profile + complexity
  const gitignorePatterns = cached(`gitignore:${project.path}`, () => parseGitignore(project.path));
  const treeDepth = project.treeDepth ?? config.treeMaxDepth;
  const tree = config.includeTree
    ? cached(`tree:${project.path}:${treeDepth}`, () => buildTree(project.path, gitignorePatterns, "", 0, treeDepth))
    : null;
  const rules = config.includeRules ? cached(`rules:${project.path}`, () => readRulesFile(project.path)) : null;
  const deps = config.includeDeps ? cached(`deps:${project.path}`, () => readDependencies(project.path)) : null;
  const keyFiles = config.includeTree ? cached(`keyfiles:${project.path}`, () => readKeyFileSnippets(project.path)) : null;
  const gitInfo = await cachedAsync(`gitinfo:${project.path}:${config.commitCount}`, () => getGitInfo(project.path, config.commitCount));
  const gitDiff = config.includeCommits ? await cachedAsync(`gitdiff:${project.path}`, () => getGitDiff(project.path)) : null;

  const otherTasks = config.includeOtherTasks
    ? rankRelatedTasks(
        task.title, task.description,
        db.prepare("SELECT title, status, priority FROM tasks WHERE projectId = ? AND id != ? AND status NOT IN ('done', 'approved') LIMIT 20")
          .all(projectId, task.id) as { title: string; status: string; priority: string }[],
      )
    : [];

  // Load AI instructions from project and milestone
  const projectInstructions = project.aiInstructions?.trim() || null;
  const milestoneInstructions = task.milestoneId
    ? (db.prepare("SELECT aiInstructions FROM milestones WHERE id = ?").get(task.milestoneId) as any)?.aiInstructions?.trim() || null
    : null;

  // Load project AI run stats for agent memory
  const aiRunStats = db.prepare(
    "SELECT COUNT(*) as total, SUM(success) as successes FROM task_ai_runs WHERE projectId = ?",
  ).get(projectId) as { total: number; successes: number } | null;

  // Git commit instruction
  let gitInstruction: string;
  if (project.aiCommitMode === "none") {
    gitInstruction = "Do NOT create any git commits. Leave all changes unstaged for manual review.";
  } else if (project.aiCommitMode === "stage") {
    gitInstruction = "Stage your changes with `git add` but do NOT commit. Leave staging for the developer to review and commit.";
  } else {
    gitInstruction = "After completing your changes, create a git commit with a clear, concise commit message describing what was done.";
  }

  // Build prompt
  const parts: string[] = [];

  parts.push(`# Task: ${task.title}

## Context
Project: ${project.name}
Path: ${project.path}
Tech Stack: ${project.techStack.join(", ") || "unknown"}${gitInfo ? `\nBranch: ${gitInfo.branch}` : ""}
Task ID: ${task.id}
Project ID: ${projectId}
Priority: ${task.priority.toUpperCase()}
Profile: ${effectiveProfile}${task.promptProfile === "auto" ? " (auto-detected)" : ""}${task.branch ? `\nTarget Branch: ${task.branch}` : ""}`);

  if (task.description) {
    parts.push(`## What to do\n${task.description}`);
  }

  if (task.prompt) {
    parts.push(`## Technical details\n${task.prompt}`);
  }

  // XML context block (conditionally populated based on profile)
  const contextParts: string[] = [];

  if (rules) {
    contextParts.push(`  <architecture_rules>\n${rules}\n  </architecture_rules>`);
  }

  if (projectInstructions) {
    contextParts.push(`  <project_ai_instructions>\n${projectInstructions}\n  </project_ai_instructions>`);
  }

  if (milestoneInstructions) {
    contextParts.push(`  <milestone_ai_instructions>\n${milestoneInstructions}\n  </milestone_ai_instructions>`);
  }

  if (tree) {
    contextParts.push(`  <project_tree>\n${tree}\n  </project_tree>`);
  }

  if (deps) {
    contextParts.push(`  <dependencies>\n${deps}\n  </dependencies>`);
  }

  if (keyFiles) {
    contextParts.push(`  <key_file_snippets>\n${keyFiles}\n  </key_file_snippets>`);
  }

  if (otherTasks.length > 0) {
    const related = otherTasks.filter((t) => t.related);
    const other = otherTasks.filter((t) => !t.related);
    let taskLines = "";
    if (related.length > 0) {
      taskLines += related.map((t) => `    - [${t.status}][${t.priority}] ${t.title} (related)`).join("\n");
    }
    if (other.length > 0) {
      if (taskLines) taskLines += "\n";
      taskLines += other.map((t) => `    - [${t.status}][${t.priority}] ${t.title}`).join("\n");
    }
    contextParts.push(`  <other_active_tasks>\n${taskLines}\n  </other_active_tasks>`);
  }

  if (gitInfo?.recentCommits) {
    contextParts.push(`  <recent_commits>\n${gitInfo.recentCommits}\n  </recent_commits>`);
  }

  if (gitDiff) {
    contextParts.push(`  <working_tree_diff>\n${gitDiff}\n  </working_tree_diff>`);
  }

  if (aiRunStats && aiRunStats.total > 0) {
    const rate = Math.round(((aiRunStats.successes ?? 0) / aiRunStats.total) * 100);
    contextParts.push(`  <ai_run_history>\nPrevious AI runs on this project: ${aiRunStats.total} total, ${rate}% success rate.\n  </ai_run_history>`);
  }

  if (contextParts.length > 0) {
    parts.push(`<project_context>\n${contextParts.join("\n\n")}\n</project_context>`);
  }

  // Profile-specific instructions
  parts.push(buildProfileInstructions(effectiveProfile, project, task, gitInstruction));

  // Task update instructions (shared across all profiles)
  parts.push(`## IMPORTANT: When you start working
If the task title or description is vague, first improve it. Update the task via the API:
curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id} -H "Content-Type: application/json" -d "{\\"title\\": \\"improved title\\", \\"description\\": \\"clearer description\\"}"

## CRITICAL — YOU MUST DO THIS WHEN FINISHED:
After completing ALL changes, you MUST update the task status to "done" and add a summary of what was done:
curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id} -H "Content-Type: application/json" -d "{\\"status\\": \\"done\\", \\"description\\": \\"${task.description ? task.description.replace(/"/g, '\\\\"').replace(/\n/g, "\\\\n").slice(0, 200) + "\\\\n\\\\n## What was done\\\\n" : "## What was done\\\\n"}<summary of changes>\\", \\"prompt\\": \\"<technical details of what was changed>\\"}"

This is not optional. The task MUST be marked as done when you finish.`);

  return parts.join("\n\n");
}

export async function buildGatherContextPrompt(
  taskTitle: string,
  taskDescription: string | null,
  projectId: string,
): Promise<string> {
  const db = getDb();

  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!projectRow) throw new Error("Project not found");
  const project = rowToProject(projectRow);

  const gitignorePatterns = cached(`gitignore:${project.path}`, () => parseGitignore(project.path));
  const depth = project.treeDepth ?? 3;
  const tree = cached(`tree:${project.path}:${depth}`, () => buildTree(project.path, gitignorePatterns, "", 0, depth));
  const rules = cached(`rules:${project.path}`, () => readRulesFile(project.path));
  const deps = cached(`deps:${project.path}`, () => readDependencies(project.path));
  const keyFiles = cached(`keyfiles:${project.path}`, () => readKeyFileSnippets(project.path));
  const gitInfo = await cachedAsync(`gitinfo:${project.path}`, () => getGitInfo(project.path));
  const gitDiff = await cachedAsync(`gitdiff:${project.path}`, () => getGitDiff(project.path));

  const parts: string[] = [];

  parts.push(`You are generating a technical implementation prompt for a development task. Use the project context below to reference actual files, paths, and patterns.

# Task: ${taskTitle}

Project: ${project.name}
Path: ${project.path}
Tech Stack: ${project.techStack.join(", ") || "unknown"}${gitInfo ? `\nBranch: ${gitInfo.branch}` : ""}`);

  if (taskDescription) {
    parts.push(`## Description\n${taskDescription}`);
  }

  parts.push(`<project_context>`);

  if (rules) {
    parts.push(`  <architecture_rules>\n${rules}\n  </architecture_rules>`);
  }

  parts.push(`  <project_tree>\n${tree || "  (unable to read directory)"}\n  </project_tree>`);

  if (deps) {
    parts.push(`  <dependencies>\n${deps}\n  </dependencies>`);
  }

  if (keyFiles) {
    parts.push(`  <key_file_snippets>\n${keyFiles}\n  </key_file_snippets>`);
  }

  if (gitInfo?.recentCommits) {
    parts.push(`  <recent_commits>\n${gitInfo.recentCommits}\n  </recent_commits>`);
  }

  if (gitDiff) {
    parts.push(`  <working_tree_diff>\n${gitDiff}\n  </working_tree_diff>`);
  }

  parts.push(`</project_context>`);

  parts.push(`## Instructions

Generate a technical implementation prompt for this task. Based on the project context above:

1. Identify the specific files that need to be created or modified (use actual paths from the project tree)
2. Describe the implementation approach step by step
3. Note edge cases and potential pitfalls
4. Reference relevant dependencies, patterns, and conventions from the project

Output ONLY the prompt text. Do not include markdown headers or explanations about what you're doing.`);

  return parts.join("\n\n");
}

export async function buildDecomposePrompt(
  task: Task,
  projectId: string,
): Promise<string> {
  const db = getDb();

  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!projectRow) throw new Error("Project not found");
  const project = rowToProject(projectRow);

  const complexity = estimateComplexity(task);
  const profile = classifyTaskProfile(task);

  const gitignorePatterns = cached(`gitignore:${project.path}`, () => parseGitignore(project.path));
  const depth = project.treeDepth ?? 3;
  const tree = cached(`tree:${project.path}:${depth}`, () => buildTree(project.path, gitignorePatterns, "", 0, depth));
  const rules = cached(`rules:${project.path}`, () => readRulesFile(project.path));

  const parts: string[] = [];

  parts.push(`You are decomposing a development task into smaller, actionable subtasks.

# Parent Task: ${task.title}

Project: ${project.name}
Path: ${project.path}
Tech Stack: ${project.techStack.join(", ") || "unknown"}
Detected Profile: ${profile}
Estimated Complexity: ${complexity}
Priority: ${task.priority}`);

  if (task.description) {
    parts.push(`## Description\n${task.description}`);
  }

  if (task.prompt) {
    parts.push(`## Technical Details\n${task.prompt}`);
  }

  if (rules) {
    parts.push(`## Architecture Rules\n${rules}`);
  }

  if (tree) {
    parts.push(`## Project Tree\n${tree}`);
  }

  parts.push(`## Instructions

Break this task into 3-7 smaller subtasks that can each be completed independently. Each subtask should be:
- Small enough for a single focused work session
- Clear and actionable with a specific outcome
- Ordered logically (earlier subtasks first)

Return ONLY a JSON array. No markdown, no explanation, no code fences. Each object must have:
- "title": string (concise, starts with a verb)
- "description": string (1-3 sentences explaining what to do)
- "prompt": string (technical implementation details referencing actual file paths from the project tree)
- "priority": "${task.priority}" (inherit from parent)
- "promptProfile": one of "quick-fix", "feature", "refactor", "bug-fix", "docs"

Example format:
[{"title":"Add parentTaskId column to tasks schema","description":"...","prompt":"...","priority":"medium","promptProfile":"feature"}]`);

  return parts.join("\n\n");
}

export async function buildAiTestPrompt(
  task: Task,
  projectId: string,
  port: number,
): Promise<string> {
  const db = getDb();

  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!projectRow) throw new Error("Project not found");
  const project = rowToProject(projectRow);

  const gitignorePatterns = cached(`gitignore:${project.path}`, () => parseGitignore(project.path));
  const depth = project.treeDepth ?? 3;
  const tree = cached(`tree:${project.path}:${depth}`, () => buildTree(project.path, gitignorePatterns, "", 0, depth));
  const rules = cached(`rules:${project.path}`, () => readRulesFile(project.path));
  const deps = cached(`deps:${project.path}`, () => readDependencies(project.path));
  const gitInfo = await cachedAsync(`gitinfo:${project.path}`, () => getGitInfo(project.path));
  const gitDiff = await cachedAsync(`gitdiff:${project.path}`, () => getGitDiff(project.path, 500));

  // Get the AI resolve run that just completed
  const lastRun = db.prepare(
    "SELECT * FROM task_ai_runs WHERE taskId = ? ORDER BY createdAt DESC LIMIT 1",
  ).get(task.id) as any;

  const parts: string[] = [];

  parts.push(`You are a specialized testing agent. An AI coding agent just finished implementing a task. Your job is to verify the implementation works correctly.

# Task: ${task.title}

Project: ${project.name}
Path: ${project.path}
Tech Stack: ${project.techStack.join(", ") || "unknown"}${gitInfo ? `\nBranch: ${gitInfo.branch}` : ""}
Task ID: ${task.id}
Project ID: ${projectId}`);

  if (task.description) {
    parts.push(`## What was requested\n${task.description}`);
  }

  if (task.prompt) {
    parts.push(`## Technical details\n${task.prompt}`);
  }

  if (lastRun?.summary) {
    parts.push(`## What the AI agent reported\n${lastRun.summary}`);
  }

  if (gitDiff) {
    parts.push(`## Changes made (git diff)\n${gitDiff}`);
  }

  const contextParts: string[] = [];

  if (rules) {
    contextParts.push(`  <architecture_rules>\n${rules}\n  </architecture_rules>`);
  }

  if (tree) {
    contextParts.push(`  <project_tree>\n${tree}\n  </project_tree>`);
  }

  if (deps) {
    contextParts.push(`  <dependencies>\n${deps}\n  </dependencies>`);
  }

  if (gitInfo?.recentCommits) {
    contextParts.push(`  <recent_commits>\n${gitInfo.recentCommits}\n  </recent_commits>`);
  }

  if (contextParts.length > 0) {
    parts.push(`<project_context>\n${contextParts.join("\n\n")}\n</project_context>`);
  }

  parts.push(`## Instructions

You are testing the implementation of the task above. Follow these steps:

1. **Read the changes**: Review the git diff to understand what was modified
2. **Run existing tests**: If the project has a test runner (check package.json scripts for "test"), run it. Report results.
3. **Verify the implementation**: Check that the changes actually accomplish what the task description asks for. Read the modified files.
4. **Test edge cases**: Think about what could go wrong. Test boundary conditions.
5. **Report findings**: Summarize what works and what doesn't.

### If tests PASS:
Update the task status to "done" and add a test summary:
curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id} -H "Content-Type: application/json" -d "{\\"status\\": \\"done\\", \\"description\\": \\"${task.description ? task.description.replace(/"/g, '\\\\"').replace(/\n/g, "\\\\n").slice(0, 200) + "\\\\n\\\\n## AI Test Results\\\\n" : "## AI Test Results\\\\n"}<test summary>\\"}"

### If tests FAIL:
Do NOT mark the task as done. Instead update the description with what failed:
curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id} -H "Content-Type: application/json" -d "{\\"description\\": \\"${task.description ? task.description.replace(/"/g, '\\\\"').replace(/\n/g, "\\\\n").slice(0, 200) + "\\\\n\\\\n## AI Test Results (FAILED)\\\\n" : "## AI Test Results (FAILED)\\\\n"}<what failed and why>\\"}"

IMPORTANT: Be thorough but fair. Only fail the task if there are real issues, not style preferences.`);

  return parts.join("\n\n");
}
