import { describe, test, expect } from "bun:test";
import {
  scrubPath,
  redactSecrets,
  hashIdentifier,
  anonymizePayload,
  truncate,
} from "./taskAiCaptureAnonymize";

describe("scrubPath", () => {
  test("strips cwd prefix and returns relative path", () => {
    expect(scrubPath("/home/u/project/src/a.ts", "/home/u/project")).toBe("src/a.ts");
  });

  test("returns '.' when path equals the prefix", () => {
    expect(scrubPath("/home/u/project", "/home/u/project")).toBe(".");
  });

  test("matches the longest prefix when multiple are provided", () => {
    expect(
      scrubPath("/home/u/project/sub/x.ts", "/home/u", ["/home/u/project", "/home/u/project/sub"]),
    ).toBe("x.ts");
  });

  test("returns <absolute> for an unrelated absolute path", () => {
    expect(scrubPath("/var/log/system.log", "/home/u/project")).toBe("<absolute>");
  });

  test("returns Windows-style absolute as <absolute> when no match", () => {
    expect(scrubPath("C:\\Users\\u\\file.txt", "/home/u/project")).toBe("<absolute>");
  });

  test("normalizes backslashes in relative paths", () => {
    expect(scrubPath("src\\a.ts", "/home/u/project")).toBe("src/a.ts");
  });

  test("returns input as-is when empty", () => {
    expect(scrubPath("", "/home/u/project")).toBe("");
  });
});

describe("redactSecrets", () => {
  test("redacts ANTHROPIC_API_KEY=value", () => {
    const out = redactSecrets("ANTHROPIC_API_KEY=sk-abc123def456ghi789jkl0");
    expect(out).toContain("ANTHROPIC_API_KEY=<redacted>");
    expect(out).not.toContain("sk-abc123");
  });

  test("redacts DATABASE_URL=postgres://user:pass@host/db", () => {
    const out = redactSecrets("DATABASE_URL=postgres://alice:hunter2@db.example.com:5432/app");
    expect(out).toContain("DATABASE_URL=<redacted>");
  });

  test("redacts bare postgres connection string", () => {
    const out = redactSecrets("connecting to postgres://alice:hunter2@db.example.com:5432/app now");
    expect(out).toContain("<redacted>");
    expect(out).not.toContain("hunter2");
  });

  test("redacts bearer tokens", () => {
    const out = redactSecrets("Authorization: Bearer abcDEF1234567890xyz");
    expect(out).toContain("<redacted>");
    expect(out).not.toContain("abcDEF1234567890xyz");
  });

  test("redacts sk- and pk- prefixed keys", () => {
    const out = redactSecrets("the key is sk-test_AbCd1234EfGh5678 and pk_live_abcdef0123456789");
    expect(out).not.toContain("sk-test_AbCd1234EfGh5678");
    expect(out).not.toContain("pk_live_abcdef0123456789");
  });

  test("redacts email addresses", () => {
    expect(redactSecrets("contact alice@example.com for help")).toContain("<redacted-email>");
  });

  test("redacts UUIDs (e.g. session IDs)", () => {
    const out = redactSecrets("session: 550e8400-e29b-41d4-a716-446655440000");
    expect(out).toContain("<redacted-uuid>");
    expect(out).not.toContain("550e8400");
  });

  test("preserves text without secrets unchanged", () => {
    expect(redactSecrets("hello world, no secrets here")).toBe("hello world, no secrets here");
  });

  test("handles empty string", () => {
    expect(redactSecrets("")).toBe("");
  });
});

describe("hashIdentifier", () => {
  test("returns 12-char hex prefix", () => {
    const h = hashIdentifier("my-project");
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  test("is stable across calls", () => {
    expect(hashIdentifier("foo")).toBe(hashIdentifier("foo"));
  });

  test("different inputs hash differently", () => {
    expect(hashIdentifier("a")).not.toBe(hashIdentifier("b"));
  });
});

describe("anonymizePayload", () => {
  test("scrubs cwd and projectPath occurrences from all text fields", () => {
    const out = anonymizePayload({
      cwd: "/home/u/project",
      projectPath: "/home/u/project",
      projectName: "MyProject",
      taskTitle: "fix bug in /home/u/project/src/a.ts",
      taskDescription: "see /home/u/project/src/a.ts:42",
      taskPrompt: "edit /home/u/project/tests/foo.test.ts to ...",
      taskMetadata: { type: "bench-codebase" },
      outcomeSummary: "wrote /home/u/project/src/a.ts and ran tests",
    });
    expect(out.task.title).not.toContain("/home/u/project");
    expect(out.task.description).not.toContain("/home/u/project");
    expect(out.task.prompt).not.toContain("/home/u/project");
    expect(out.outcome.summary).not.toContain("/home/u/project");
    expect(out.task.title).toContain("<workdir>/src/a.ts");
  });

  test("hashes project name", () => {
    const out = anonymizePayload({
      cwd: "/x",
      projectPath: "/x",
      projectName: "MyProject",
      taskTitle: "t",
      taskDescription: null,
      taskPrompt: null,
      taskMetadata: null,
      outcomeSummary: null,
    });
    expect(out.project.nameHash).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(out)).not.toContain("MyProject");
  });

  test("preserves metadata as opaque (no scrubbing inside arbitrary metadata)", () => {
    const out = anonymizePayload({
      cwd: "/x",
      projectPath: "/x",
      projectName: "p",
      taskTitle: "t",
      taskDescription: null,
      taskPrompt: null,
      taskMetadata: { type: "qa-test", parent_task: "abc" },
      outcomeSummary: null,
    });
    expect(out.task.metadata).toEqual({ type: "qa-test", parent_task: "abc" });
  });

  test("redacts secrets in summary alongside path scrubbing", () => {
    const out = anonymizePayload({
      cwd: "/work",
      projectPath: "/work",
      projectName: "p",
      taskTitle: "t",
      taskDescription: null,
      taskPrompt: null,
      taskMetadata: null,
      outcomeSummary:
        "wrote /work/src/.env with ANTHROPIC_API_KEY=sk-real-1234567890abcdefXYZ for testing",
    });
    expect(out.outcome.summary).toContain("<workdir>/src/.env");
    expect(out.outcome.summary).toContain("<redacted>");
    expect(out.outcome.summary).not.toContain("sk-real-1234567890");
  });

  test("null fields stay null", () => {
    const out = anonymizePayload({
      cwd: "/x",
      projectPath: "/x",
      projectName: "p",
      taskTitle: "t",
      taskDescription: null,
      taskPrompt: null,
      taskMetadata: null,
      outcomeSummary: null,
    });
    expect(out.task.description).toBeNull();
    expect(out.task.prompt).toBeNull();
    expect(out.outcome.summary).toBeNull();
  });
});

describe("truncate", () => {
  test("returns string unchanged when shorter than max", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncates and appends count marker when longer", () => {
    expect(truncate("hello world", 5)).toBe("hello…[+6]");
  });

  test("preserves null", () => {
    expect(truncate(null, 5)).toBeNull();
  });
});
