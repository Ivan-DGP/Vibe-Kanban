import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import type { Task, Project } from "@vibe-kanban/shared";

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

// Get git info
async function getGitInfo(projectPath: string): Promise<{ branch: string; recentCommits: string } | null> {
  try {
    const branchResult = await spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectPath });
    if (branchResult.exitCode !== 0) return null;

    const logResult = await spawn(
      ["git", "log", "--oneline", "-10", "--format=%h %s"],
      { cwd: projectPath },
    );

    return {
      branch: branchResult.stdout.trim(),
      recentCommits: logResult.exitCode === 0 ? logResult.stdout.trim() : "",
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

export async function buildAnalyzePrompt(
  task: Task,
  projectId: string,
): Promise<string> {
  const db = getDb();

  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!projectRow) throw new Error("Project not found");
  const project = rowToProject(projectRow);

  const otherTasks = db
    .prepare("SELECT title, status, priority FROM tasks WHERE projectId = ? AND id != ? AND status != 'done' LIMIT 20")
    .all(projectId, task.id) as any[];

  const gitignorePatterns = parseGitignore(project.path);
  const tree = buildTree(project.path, gitignorePatterns);
  const rules = readRulesFile(project.path);
  const deps = readDependencies(project.path);
  const gitInfo = await getGitInfo(project.path);

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

  parts.push(`  <project_tree>\n${tree || "  (unable to read directory)"}\n  </project_tree>`);

  if (deps) {
    parts.push(`  <dependencies>\n${deps}\n  </dependencies>`);
  }

  if (otherTasks.length > 0) {
    parts.push(`  <other_active_tasks>\n${otherTasks.map((t) => `    - [${t.status}][${t.priority}] ${t.title}`).join("\n")}\n  </other_active_tasks>`);
  }

  if (gitInfo?.recentCommits) {
    parts.push(`  <recent_commits>\n${gitInfo.recentCommits}\n  </recent_commits>`);
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

  // Get other active tasks for context
  const otherTasks = db
    .prepare("SELECT title, status, priority FROM tasks WHERE projectId = ? AND id != ? AND status != 'done' LIMIT 20")
    .all(projectId, task.id) as any[];

  // Build context pieces
  const gitignorePatterns = parseGitignore(project.path);
  const tree = buildTree(project.path, gitignorePatterns);
  const rules = readRulesFile(project.path);
  const deps = readDependencies(project.path);
  const gitInfo = await getGitInfo(project.path);

  // Git commit instruction
  let gitInstruction: string;
  if (project.aiCommitMode === "none") {
    gitInstruction = "Do NOT create any git commits. Leave all changes unstaged for manual review.";
  } else if (project.aiCommitMode === "stage") {
    gitInstruction = "Stage your changes with `git add` but do NOT commit. Leave staging for the developer to review and commit.";
  } else {
    gitInstruction = "After completing your changes, create a git commit with a clear, concise commit message describing what was done.";
  }

  // Build XML-structured prompt
  const parts: string[] = [];

  parts.push(`# Task: ${task.title}

## Context
Project: ${project.name}
Path: ${project.path}
Tech Stack: ${project.techStack.join(", ") || "unknown"}${gitInfo ? `\nBranch: ${gitInfo.branch}` : ""}
Task ID: ${task.id}
Project ID: ${projectId}
Priority: ${task.priority.toUpperCase()}`);

  if (task.description) {
    parts.push(`## What to do
${task.description}`);
  }

  if (task.prompt) {
    parts.push(`## Technical details
${task.prompt}`);
  }

  // XML context block
  parts.push(`<project_context>`);

  if (rules) {
    parts.push(`  <architecture_rules>
${rules}
  </architecture_rules>`);
  }

  parts.push(`  <project_tree>
${tree || "  (unable to read directory)"}
  </project_tree>`);

  if (deps) {
    parts.push(`  <dependencies>
${deps}
  </dependencies>`);
  }

  if (otherTasks.length > 0) {
    parts.push(`  <other_active_tasks>
${otherTasks.map((t) => `    - [${t.status}][${t.priority}] ${t.title}`).join("\n")}
  </other_active_tasks>`);
  }

  if (gitInfo?.recentCommits) {
    parts.push(`  <recent_commits>
${gitInfo.recentCommits}
  </recent_commits>`);
  }

  parts.push(`</project_context>`);

  // Instructions
  parts.push(`## Instructions
1. Read the task description and technical details above carefully
2. Explore the codebase at ${project.path} to understand the current state
3. Implement the required changes
4. Test your implementation if possible
5. ${gitInstruction}

## IMPORTANT: When you start working
If the task title or description is vague, first improve it. Update the task via the API:
curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id} -H "Content-Type: application/json" -d "{\\"title\\": \\"improved title\\", \\"description\\": \\"clearer description\\"}"

## CRITICAL — YOU MUST DO THIS WHEN FINISHED:
After completing ALL changes, you MUST update the task status to "done" and add a summary of what was done:
curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id} -H "Content-Type: application/json" -d "{\\"status\\": \\"done\\", \\"description\\": \\"${task.description ? task.description.replace(/"/g, '\\\\"').replace(/\n/g, "\\\\n").slice(0, 200) + "\\\\n\\\\n## What was done\\\\n" : "## What was done\\\\n"}<summary of changes>\\", \\"prompt\\": \\"<technical details of what was changed>\\"}"

This is not optional. The task MUST be marked as done when you finish.`);

  return parts.join("\n\n");
}
