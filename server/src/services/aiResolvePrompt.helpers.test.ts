import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  extractKeywords,
  scoreTaskRelevance,
  rankRelatedTasks,
  applyComplexityToConfig,
  readRulesFile,
  readDependencies,
  readKeyFileSnippets,
  PROFILE_CONFIGS,
  STOP_WORDS,
  cached,
  cachedAsync,
  contextCache,
  CACHE_TTL,
} from "./aiResolvePrompt";
import type { ProfileConfig } from "./aiResolvePrompt";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-helpers-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// extractKeywords
// ============================================================

describe("extractKeywords", () => {
  test("extracts basic words from a sentence", () => {
    const kw = extractKeywords("implement drag and drop support");
    expect(kw.has("implement")).toBe(true);
    expect(kw.has("drag")).toBe(true);
    expect(kw.has("drop")).toBe(true);
    expect(kw.has("support")).toBe(true);
  });

  test("filters out stop words", () => {
    const kw = extractKeywords("fix the bug in the database");
    // "fix", "the", "in" are stop words
    expect(kw.has("fix")).toBe(false);
    expect(kw.has("the")).toBe(false);
    expect(kw.has("in")).toBe(false);
    expect(kw.has("bug")).toBe(true);
    expect(kw.has("database")).toBe(true);
  });

  test("filters words with length <= 2", () => {
    const kw = extractKeywords("a UI or DB fix");
    expect(kw.has("a")).toBe(false);
    expect(kw.has("or")).toBe(false);
    expect(kw.has("db")).toBe(false);
    expect(kw.has("ui")).toBe(false);
  });

  test("lowercases all words", () => {
    const kw = extractKeywords("React Component Sidebar");
    expect(kw.has("react")).toBe(true);
    expect(kw.has("component")).toBe(true);
    expect(kw.has("sidebar")).toBe(true);
    expect(kw.has("React")).toBe(false);
  });

  test("handles special characters by replacing with spaces", () => {
    const kw = extractKeywords("fix(auth): login! @broken");
    expect(kw.has("auth")).toBe(true);
    expect(kw.has("login")).toBe(true);
    expect(kw.has("broken")).toBe(true);
    // Punctuation like ! : @ should be stripped
    expect(kw.has("login!")).toBe(false);
    expect(kw.has("@broken")).toBe(false);
  });

  test("handles hyphens and underscores in words", () => {
    const kw = extractKeywords("dark-mode feature_flag");
    expect(kw.has("dark-mode")).toBe(true);
    expect(kw.has("feature_flag")).toBe(true);
  });

  test("returns empty set for empty string", () => {
    const kw = extractKeywords("");
    expect(kw.size).toBe(0);
  });

  test("returns empty set for string of only stop words", () => {
    const kw = extractKeywords("the a an is it to in on of for");
    expect(kw.size).toBe(0);
  });

  test("deduplicates repeated words", () => {
    const kw = extractKeywords("task task task sidebar sidebar");
    expect(kw.size).toBe(2);
    expect(kw.has("task")).toBe(true);
    expect(kw.has("sidebar")).toBe(true);
  });
});

// ============================================================
// scoreTaskRelevance
// ============================================================

describe("scoreTaskRelevance", () => {
  test("returns overlap count for matching keywords", () => {
    const keywords = extractKeywords("terminal sidebar component");
    const score = scoreTaskRelevance(keywords, "update terminal component styles");
    // "terminal" and "component" overlap
    expect(score).toBe(2);
  });

  test("returns 0 when no keywords overlap", () => {
    const keywords = extractKeywords("database migration");
    const score = scoreTaskRelevance(keywords, "terminal sidebar component");
    expect(score).toBe(0);
  });

  test("is case-insensitive", () => {
    const keywords = extractKeywords("React Component");
    const score = scoreTaskRelevance(keywords, "react component test");
    expect(score).toBeGreaterThan(0);
  });

  test("ignores stop words in the other title", () => {
    const keywords = extractKeywords("sidebar navigation");
    // "the" and "for" are stop words, only "sidebar" overlaps
    const score = scoreTaskRelevance(keywords, "the sidebar for things");
    expect(score).toBe(1);
  });
});

// ============================================================
// rankRelatedTasks
// ============================================================

describe("rankRelatedTasks", () => {
  const tasks = [
    { title: "Unrelated database task", status: "todo", priority: "low" },
    { title: "Terminal sidebar styles", status: "in_progress", priority: "high" },
    { title: "Terminal component refactor", status: "todo", priority: "medium" },
    { title: "Auth middleware update", status: "todo", priority: "low" },
  ];

  test("sorts tasks by relevance score descending", () => {
    const ranked = rankRelatedTasks("Fix terminal component bug", null, tasks);
    // "Terminal component refactor" and "Terminal sidebar styles" should be first
    expect(ranked[0].title).toContain("Terminal");
    expect(ranked[1].title).toContain("Terminal");
  });

  test("marks related flag correctly", () => {
    const ranked = rankRelatedTasks("Fix terminal component bug", null, tasks);
    const relatedTitles = ranked.filter((t) => t.related).map((t) => t.title);
    expect(relatedTitles).toContain("Terminal sidebar styles");
    expect(relatedTitles).toContain("Terminal component refactor");
    // Unrelated tasks should have related=false
    const unrelated = ranked.filter((t) => !t.related);
    expect(unrelated.some((t) => t.title === "Unrelated database task")).toBe(true);
    expect(unrelated.some((t) => t.title === "Auth middleware update")).toBe(true);
  });

  test("includes description in keyword extraction", () => {
    const ranked = rankRelatedTasks(
      "Improve layout",
      "The sidebar navigation needs better styling",
      [
        { title: "Sidebar component test", status: "todo", priority: "medium" },
        { title: "Database query optimization", status: "todo", priority: "low" },
      ],
    );
    expect(ranked[0].title).toBe("Sidebar component test");
    expect(ranked[0].related).toBe(true);
  });

  test("handles null description", () => {
    const ranked = rankRelatedTasks("Terminal fix", null, tasks);
    expect(ranked.length).toBe(tasks.length);
  });

  test("returns empty array for empty input", () => {
    const ranked = rankRelatedTasks("Some task", null, []);
    expect(ranked).toEqual([]);
  });

  test("preserves original task properties", () => {
    const ranked = rankRelatedTasks("Terminal fix", null, tasks);
    for (const t of ranked) {
      expect(t).toHaveProperty("title");
      expect(t).toHaveProperty("status");
      expect(t).toHaveProperty("priority");
      expect(t).toHaveProperty("related");
    }
  });
});

// ============================================================
// applyComplexityToConfig
// ============================================================

describe("applyComplexityToConfig", () => {
  const baseConfig: ProfileConfig = {
    includeTree: true,
    treeMaxDepth: 3,
    includeDeps: true,
    includeCommits: true,
    commitCount: 10,
    includeOtherTasks: true,
    includeRules: true,
  };

  test("small complexity reduces treeMaxDepth by 1", () => {
    const result = applyComplexityToConfig(baseConfig, "small");
    expect(result.treeMaxDepth).toBe(2); // 3 - 1
  });

  test("small complexity caps commitCount at 5", () => {
    const result = applyComplexityToConfig(baseConfig, "small");
    expect(result.commitCount).toBe(5);
  });

  test("small complexity disables includeOtherTasks", () => {
    const result = applyComplexityToConfig(baseConfig, "small");
    expect(result.includeOtherTasks).toBe(false);
  });

  test("small complexity enforces treeMaxDepth minimum of 1", () => {
    const shallowConfig: ProfileConfig = { ...baseConfig, treeMaxDepth: 1 };
    const result = applyComplexityToConfig(shallowConfig, "small");
    expect(result.treeMaxDepth).toBe(1); // Math.max(0, 1) = 1
  });

  test("small complexity does not increase commitCount if already below 5", () => {
    const lowCommitConfig: ProfileConfig = { ...baseConfig, commitCount: 3 };
    const result = applyComplexityToConfig(lowCommitConfig, "small");
    expect(result.commitCount).toBe(3);
  });

  test("large complexity increases treeMaxDepth by 1", () => {
    const result = applyComplexityToConfig(baseConfig, "large");
    expect(result.treeMaxDepth).toBe(4); // 3 + 1
  });

  test("large complexity enforces commitCount minimum of 15", () => {
    const result = applyComplexityToConfig(baseConfig, "large");
    expect(result.commitCount).toBe(15); // Math.max(10, 15)
  });

  test("large complexity preserves commitCount if already above 15", () => {
    const highCommitConfig: ProfileConfig = { ...baseConfig, commitCount: 20 };
    const result = applyComplexityToConfig(highCommitConfig, "large");
    expect(result.commitCount).toBe(20);
  });

  test("medium complexity returns config unchanged", () => {
    const result = applyComplexityToConfig(baseConfig, "medium");
    expect(result).toEqual(baseConfig);
  });

  test("does not mutate the original config", () => {
    const original = { ...baseConfig };
    applyComplexityToConfig(baseConfig, "small");
    expect(baseConfig).toEqual(original);
  });
});

// ============================================================
// PROFILE_CONFIGS
// ============================================================

describe("PROFILE_CONFIGS", () => {
  const expectedProfiles = ["quick-fix", "feature", "refactor", "bug-fix", "docs"] as const;

  test("contains all expected profiles", () => {
    for (const profile of expectedProfiles) {
      expect(PROFILE_CONFIGS).toHaveProperty(profile);
    }
  });

  test("each profile has the correct shape", () => {
    for (const profile of expectedProfiles) {
      const config = PROFILE_CONFIGS[profile];
      expect(typeof config.includeTree).toBe("boolean");
      expect(typeof config.treeMaxDepth).toBe("number");
      expect(typeof config.includeDeps).toBe("boolean");
      expect(typeof config.includeCommits).toBe("boolean");
      expect(typeof config.commitCount).toBe("number");
      expect(typeof config.includeOtherTasks).toBe("boolean");
      expect(typeof config.includeRules).toBe("boolean");
    }
  });

  test("quick-fix has minimal context", () => {
    const qf = PROFILE_CONFIGS["quick-fix"];
    expect(qf.includeTree).toBe(false);
    expect(qf.includeDeps).toBe(false);
    expect(qf.includeCommits).toBe(false);
    expect(qf.includeOtherTasks).toBe(false);
  });

  test("feature includes full context", () => {
    const feat = PROFILE_CONFIGS["feature"];
    expect(feat.includeTree).toBe(true);
    expect(feat.includeDeps).toBe(true);
    expect(feat.includeCommits).toBe(true);
    expect(feat.includeOtherTasks).toBe(true);
  });

  test("all profiles include rules", () => {
    for (const profile of expectedProfiles) {
      expect(PROFILE_CONFIGS[profile].includeRules).toBe(true);
    }
  });
});

// ============================================================
// STOP_WORDS
// ============================================================

describe("STOP_WORDS", () => {
  test("contains common English stop words", () => {
    expect(STOP_WORDS.has("the")).toBe(true);
    expect(STOP_WORDS.has("a")).toBe(true);
    expect(STOP_WORDS.has("an")).toBe(true);
    expect(STOP_WORDS.has("is")).toBe(true);
    expect(STOP_WORDS.has("and")).toBe(true);
    expect(STOP_WORDS.has("or")).toBe(true);
  });

  test("contains common coding action words", () => {
    expect(STOP_WORDS.has("add")).toBe(true);
    expect(STOP_WORDS.has("update")).toBe(true);
    expect(STOP_WORDS.has("fix")).toBe(true);
    expect(STOP_WORDS.has("make")).toBe(true);
    expect(STOP_WORDS.has("use")).toBe(true);
    expect(STOP_WORDS.has("get")).toBe(true);
    expect(STOP_WORDS.has("set")).toBe(true);
  });

  test("does not contain domain-specific words", () => {
    expect(STOP_WORDS.has("terminal")).toBe(false);
    expect(STOP_WORDS.has("sidebar")).toBe(false);
    expect(STOP_WORDS.has("database")).toBe(false);
    expect(STOP_WORDS.has("component")).toBe(false);
  });
});

// ============================================================
// readRulesFile
// ============================================================

describe("readRulesFile", () => {
  test("reads CLAUDE.md when present", () => {
    const dir = path.join(tmpDir, "rules-claude");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Project rules\nUse TypeScript.");
    const result = readRulesFile(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("[CLAUDE.md]");
    expect(result).toContain("Use TypeScript.");
  });

  test("reads AGENTS.md with higher priority than CLAUDE.md", () => {
    const dir = path.join(tmpDir, "rules-agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "Agent rules here");
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "Claude rules here");
    const result = readRulesFile(dir);
    // AGENTS.md comes first in the candidates list, so it should be returned
    expect(result).not.toBeNull();
    expect(result).toContain("[AGENTS.md]");
    expect(result).toContain("Agent rules here");
  });

  test("reads .cursorrules as a fallback", () => {
    const dir = path.join(tmpDir, "rules-cursor");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".cursorrules"), "Cursor rules content");
    const result = readRulesFile(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("[.cursorrules]");
    expect(result).toContain("Cursor rules content");
  });

  test("returns null when no rules file exists", () => {
    const dir = path.join(tmpDir, "rules-none");
    fs.mkdirSync(dir, { recursive: true });
    const result = readRulesFile(dir);
    expect(result).toBeNull();
  });

  test("skips empty rules files", () => {
    const dir = path.join(tmpDir, "rules-empty");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "   ");
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "Actual content");
    const result = readRulesFile(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("[CLAUDE.md]");
  });

  test("returns null for non-existent directory", () => {
    const result = readRulesFile("/non/existent/path/rules-test");
    expect(result).toBeNull();
  });
});

// ============================================================
// readDependencies
// ============================================================

describe("readDependencies", () => {
  test("reads package.json and extracts dependencies", () => {
    const dir = path.join(tmpDir, "deps-pkg");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
        devDependencies: { typescript: "^5.0.0" },
        scripts: { dev: "vite", build: "tsc && vite build" },
      }),
    );
    const result = readDependencies(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("[package.json]");
    expect(result).toContain("react");
    expect(result).toContain("react-dom");
    expect(result).toContain("typescript");
    expect(result).toContain("dev: vite");
  });

  test("reads requirements.txt", () => {
    const dir = path.join(tmpDir, "deps-python");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "requirements.txt"), "flask==2.0\nrequests>=2.28\n");
    const result = readDependencies(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("[requirements.txt]");
    expect(result).toContain("flask==2.0");
    expect(result).toContain("requests>=2.28");
  });

  test("reads multiple dependency files", () => {
    const dir = path.join(tmpDir, "deps-multi");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.18.0" } }),
    );
    fs.writeFileSync(
      path.join(dir, "docker-compose.yml"),
      "version: '3'\nservices:\n  web:\n    image: node:18\n",
    );
    const result = readDependencies(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("[package.json]");
    expect(result).toContain("[docker-compose.yml]");
  });

  test("returns null when no dependency files exist", () => {
    const dir = path.join(tmpDir, "deps-empty");
    fs.mkdirSync(dir, { recursive: true });
    const result = readDependencies(dir);
    expect(result).toBeNull();
  });

  test("handles package.json with only scripts", () => {
    const dir = path.join(tmpDir, "deps-scripts-only");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test", scripts: { test: "jest" } }),
    );
    const result = readDependencies(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("scripts:");
    expect(result).toContain("test: jest");
  });

  test("returns null for non-existent directory", () => {
    const result = readDependencies("/non/existent/path/deps-test");
    expect(result).toBeNull();
  });
});

// ============================================================
// readKeyFileSnippets
// ============================================================

describe("readKeyFileSnippets", () => {
  test("reads tsconfig.json when present", () => {
    const dir = path.join(tmpDir, "snippets-ts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2022", strict: true } }, null, 2),
    );
    const result = readKeyFileSnippets(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("[tsconfig.json]");
    expect(result).toContain("ES2022");
  });

  test("reads entry point files", () => {
    const dir = path.join(tmpDir, "snippets-entry");
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "index.ts"),
      'console.log("hello");\nexport default {};',
    );
    const result = readKeyFileSnippets(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("[src/index.ts]");
    expect(result).toContain('console.log("hello")');
  });

  test("respects MAX_FILES limit of 8", () => {
    const dir = path.join(tmpDir, "snippets-max");
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    // Create many candidate files
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(dir, "vite.config.ts"), "export default {}");
    fs.writeFileSync(path.join(dir, "vite.config.js"), "module.exports = {}");
    fs.writeFileSync(path.join(dir, "tailwind.config.ts"), "export default {}");
    fs.writeFileSync(path.join(dir, "tailwind.config.js"), "module.exports = {}");
    fs.writeFileSync(path.join(dir, ".env.example"), "API_KEY=xxx");
    fs.writeFileSync(path.join(dir, "src", "index.ts"), "// entry");
    fs.writeFileSync(path.join(dir, "src", "index.tsx"), "// entry tsx");
    fs.writeFileSync(path.join(dir, "src", "main.ts"), "// should not appear");
    const result = readKeyFileSnippets(dir);
    expect(result).not.toBeNull();
    // Count the number of file sections
    const sectionCount = (result!.match(/\[/g) || []).length;
    expect(sectionCount).toBeLessThanOrEqual(8);
  });

  test("truncates files exceeding maxLines", () => {
    const dir = path.join(tmpDir, "snippets-truncate");
    fs.mkdirSync(dir, { recursive: true });
    // tsconfig.json has maxLines=80, create a file with 200 lines
    const longContent = Array.from({ length: 200 }, (_, i) => `// line ${i + 1}`).join("\n");
    fs.writeFileSync(path.join(dir, "tsconfig.json"), longContent);
    const result = readKeyFileSnippets(dir);
    expect(result).not.toBeNull();
    expect(result).toContain("(first 80 lines)");
    expect(result).toContain("// line 1");
    expect(result).toContain("// line 80");
    expect(result).not.toContain("// line 200");
  });

  test("returns null when no key files exist", () => {
    const dir = path.join(tmpDir, "snippets-empty");
    fs.mkdirSync(dir, { recursive: true });
    const result = readKeyFileSnippets(dir);
    expect(result).toBeNull();
  });

  test("returns null for non-existent directory", () => {
    const result = readKeyFileSnippets("/non/existent/path/snippets-test");
    expect(result).toBeNull();
  });
});

// ============================================================
// cached (sync TTL cache helper)
// ============================================================

describe("cached", () => {
  beforeAll(() => {
    // Clear cache before this suite
    contextCache.clear();
  });

  afterAll(() => {
    contextCache.clear();
  });

  test("returns value from fn on first call", () => {
    contextCache.clear();
    let callCount = 0;
    const result = cached("test-sync-1", () => {
      callCount++;
      return 42;
    });
    expect(result).toBe(42);
    expect(callCount).toBe(1);
  });

  test("returns cached value on subsequent call within TTL", () => {
    contextCache.clear();
    let callCount = 0;
    const fn = () => {
      callCount++;
      return "hello";
    };
    const r1 = cached("test-sync-2", fn);
    const r2 = cached("test-sync-2", fn);
    expect(r1).toBe("hello");
    expect(r2).toBe("hello");
    expect(callCount).toBe(1); // fn called only once
  });

  test("returns fresh value after TTL expires", () => {
    contextCache.clear();
    let callCount = 0;
    const key = "test-sync-3";
    cached(key, () => {
      callCount++;
      return "first";
    });
    expect(callCount).toBe(1);

    // Manually expire the cache entry
    const entry = contextCache.get(key)!;
    entry.expiry = Date.now() - 1;

    const r2 = cached(key, () => {
      callCount++;
      return "second";
    });
    expect(r2).toBe("second");
    expect(callCount).toBe(2);
  });

  test("different keys are cached independently", () => {
    contextCache.clear();
    const r1 = cached("key-a", () => "aaa");
    const r2 = cached("key-b", () => "bbb");
    expect(r1).toBe("aaa");
    expect(r2).toBe("bbb");
    // Both should be in cache
    expect(contextCache.has("key-a")).toBe(true);
    expect(contextCache.has("key-b")).toBe(true);
  });

  test("cache entry has correct expiry relative to CACHE_TTL", () => {
    contextCache.clear();
    const before = Date.now();
    cached("test-ttl", () => "val");
    const after = Date.now();
    const entry = contextCache.get("test-ttl")!;
    expect(entry.expiry).toBeGreaterThanOrEqual(before + CACHE_TTL);
    expect(entry.expiry).toBeLessThanOrEqual(after + CACHE_TTL);
  });
});

// ============================================================
// cachedAsync (async TTL cache helper)
// ============================================================

describe("cached - evictExpired triggered at MAX_CACHE_SIZE", () => {
  afterAll(() => {
    contextCache.clear();
  });

  test("evicts expired entries when cache reaches MAX_CACHE_SIZE (200)", () => {
    contextCache.clear();
    const now = Date.now();

    // Fill cache with 200 already-expired entries
    for (let i = 0; i < 200; i++) {
      contextCache.set(`evict-test-${i}`, { value: i, expiry: now - 1000 });
    }
    expect(contextCache.size).toBe(200);

    // Adding one more entry should trigger evictExpired inside cached()
    const result = cached("evict-trigger-key", () => "evicted-and-set");
    expect(result).toBe("evicted-and-set");

    // After eviction of expired entries, the 200 expired entries should be gone
    // and only the new entry should remain
    expect(contextCache.has("evict-trigger-key")).toBe(true);
    // All expired entries should have been removed
    for (let i = 0; i < 200; i++) {
      expect(contextCache.has(`evict-test-${i}`)).toBe(false);
    }
  });
});

describe("cachedAsync", () => {
  beforeAll(() => {
    contextCache.clear();
  });

  afterAll(() => {
    contextCache.clear();
  });

  test("returns value from async fn on first call", async () => {
    contextCache.clear();
    let callCount = 0;
    const result = await cachedAsync("test-async-1", async () => {
      callCount++;
      return 99;
    });
    expect(result).toBe(99);
    expect(callCount).toBe(1);
  });

  test("returns cached value on subsequent call within TTL", async () => {
    contextCache.clear();
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return "async-hello";
    };
    const r1 = await cachedAsync("test-async-2", fn);
    const r2 = await cachedAsync("test-async-2", fn);
    expect(r1).toBe("async-hello");
    expect(r2).toBe("async-hello");
    expect(callCount).toBe(1);
  });

  test("returns fresh value after TTL expires", async () => {
    contextCache.clear();
    let callCount = 0;
    const key = "test-async-3";
    await cachedAsync(key, async () => {
      callCount++;
      return "first-async";
    });
    expect(callCount).toBe(1);

    // Manually expire
    const entry = contextCache.get(key)!;
    entry.expiry = Date.now() - 1;

    const r2 = await cachedAsync(key, async () => {
      callCount++;
      return "second-async";
    });
    expect(r2).toBe("second-async");
    expect(callCount).toBe(2);
  });

  test("different keys are cached independently", async () => {
    contextCache.clear();
    const r1 = await cachedAsync("async-a", async () => "aaa");
    const r2 = await cachedAsync("async-b", async () => "bbb");
    expect(r1).toBe("aaa");
    expect(r2).toBe("bbb");
    expect(contextCache.has("async-a")).toBe(true);
    expect(contextCache.has("async-b")).toBe(true);
  });

  test("cache entry has correct expiry relative to CACHE_TTL", async () => {
    contextCache.clear();
    const before = Date.now();
    await cachedAsync("test-async-ttl", async () => "val");
    const after = Date.now();
    const entry = contextCache.get("test-async-ttl")!;
    expect(entry.expiry).toBeGreaterThanOrEqual(before + CACHE_TTL);
    expect(entry.expiry).toBeLessThanOrEqual(after + CACHE_TTL);
  });
});
