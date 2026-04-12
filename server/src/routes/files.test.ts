import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../app";
import { safePath, isBlockedPath } from "./files";

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;
let tmpDir: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Create a temp directory to serve as the project root
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-kanban-files-test-"));

  // Populate with test files and directories
  fs.writeFileSync(path.join(tmpDir, "test.txt"), "hello world");
  fs.writeFileSync(path.join(tmpDir, "readme.md"), "# Readme");
  fs.mkdirSync(path.join(tmpDir, "subdir"));
  fs.writeFileSync(path.join(tmpDir, "subdir", "nested.txt"), "nested content");
  fs.writeFileSync(path.join(tmpDir, "subdir", "data.json"), '{"key":"value"}');

  // Create a project in the DB pointing to the temp directory
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: {
      name: `Files Test Project ${Date.now()}`,
      path: tmpDir,
    },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  // Clean up project from DB
  await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  await app.close();

  // Remove temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// Pure function tests
// ===========================================================================

describe("safePath", () => {
  test("resolves a simple relative path correctly", () => {
    const result = safePath("/project", "src/index.ts");
    expect(result).toBe(path.resolve("/project", "src/index.ts"));
  });

  test("resolves nested paths correctly", () => {
    const result = safePath("/project", "src/components/Button.tsx");
    expect(result).toBe(path.resolve("/project", "src/components/Button.tsx"));
  });

  test("throws on path traversal with ../", () => {
    expect(() => safePath("/project", "../../../etc/passwd")).toThrow(
      "Path traversal detected",
    );
  });

  test("throws on path traversal with absolute path outside base", () => {
    expect(() => safePath("/project", "/etc/passwd")).toThrow(
      "Path traversal detected",
    );
  });

  test("allows a path that stays within the base", () => {
    const result = safePath("/project", "subdir/../file.txt");
    expect(result).toBe(path.resolve("/project", "file.txt"));
  });
});

describe("isBlockedPath", () => {
  test("blocks .git/hooks", () => {
    expect(isBlockedPath(".git/hooks")).toBe(true);
  });

  test("blocks .git/hooks/pre-commit", () => {
    expect(isBlockedPath(".git/hooks/pre-commit")).toBe(true);
  });

  test("blocks .env", () => {
    expect(isBlockedPath(".env")).toBe(true);
  });

  test("blocks .git/config", () => {
    expect(isBlockedPath(".git/config")).toBe(true);
  });

  test("blocks .git/objects", () => {
    expect(isBlockedPath(".git/objects")).toBe(true);
  });

  test("blocks .git/objects/pack/pack-abc.idx", () => {
    expect(isBlockedPath(".git/objects/pack/pack-abc.idx")).toBe(true);
  });

  test("allows normal paths like src/index.ts", () => {
    expect(isBlockedPath("src/index.ts")).toBe(false);
  });

  test("allows README.md", () => {
    expect(isBlockedPath("README.md")).toBe(false);
  });

  test("allows .gitignore (not in blocked list)", () => {
    expect(isBlockedPath(".gitignore")).toBe(false);
  });

  test("normalizes backslashes on Windows-style paths", () => {
    expect(isBlockedPath(".git\\hooks\\pre-commit")).toBe(true);
  });
});

// ===========================================================================
// Integration tests
// ===========================================================================

describe("Files API - List directory", () => {
  test("GET /api/projects/:id/files — lists root directory entries", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);

    // Should contain our test files (dotfiles are filtered out)
    const names = body.map((e: any) => e.name);
    expect(names).toContain("test.txt");
    expect(names).toContain("readme.md");
    expect(names).toContain("subdir");

    // Verify entry shape
    const testFile = body.find((e: any) => e.name === "test.txt");
    expect(testFile).toBeDefined();
    expect(testFile.path).toBe("test.txt");
    expect(testFile.type).toBe("file");
    expect(typeof testFile.size).toBe("number");
    expect(testFile.size).toBeGreaterThan(0);

    const subdir = body.find((e: any) => e.name === "subdir");
    expect(subdir).toBeDefined();
    expect(subdir.type).toBe("directory");
  });

  test("GET /api/projects/:id/files — directories sort before files", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files`,
    });

    const body = res.json();
    const types = body.map((e: any) => e.type);
    const firstFileIndex = types.indexOf("file");
    const lastDirIndex = types.lastIndexOf("directory");
    if (lastDirIndex !== -1 && firstFileIndex !== -1) {
      expect(lastDirIndex).toBeLessThan(firstFileIndex);
    }
  });

  test("GET /api/projects/:id/files?path=subdir — lists subdirectory", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files?path=subdir`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.map((e: any) => e.name);
    expect(names).toContain("nested.txt");
    expect(names).toContain("data.json");

    // Paths should be relative to project root
    const nested = body.find((e: any) => e.name === "nested.txt");
    expect(nested.path).toBe("subdir/nested.txt");
  });

  test("GET /api/projects/:id/files?path=nonexistent — returns 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files?path=nonexistent`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Directory not found");
  });
});

describe("Files API - Read file", () => {
  test("GET /api/projects/:id/files/read?path=test.txt — reads text file", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=test.txt`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("hello world");
    expect(body.encoding).toBe("utf-8");
  });

  test("GET /api/projects/:id/files/read?path=subdir/nested.txt — reads nested file", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=subdir/nested.txt`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("nested content");
    expect(body.encoding).toBe("utf-8");
  });

  test("GET /api/projects/:id/files/read — 400 without path", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read`,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("path required");
  });

  test("GET /api/projects/:id/files/read?path=missing.txt — 404 for nonexistent file", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=missing.txt`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("File not found");
  });
});

describe("Files API - Write file", () => {
  test("PUT /api/projects/:id/files/write — writes file content", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/files/write`,
      headers: { "Content-Type": "application/json" },
      payload: { path: "test.txt", content: "updated content" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Verify content persists by reading the file back
    const readRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=test.txt`,
    });
    expect(readRes.json().content).toBe("updated content");
  });

  test("PUT /api/projects/:id/files/write — blocked path (.env) returns 403", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/files/write`,
      headers: { "Content-Type": "application/json" },
      payload: { path: ".env", content: "SECRET=bad" },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("Cannot modify protected file");
  });

  test("PUT /api/projects/:id/files/write — blocked path (.git/config) returns 403", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/files/write`,
      headers: { "Content-Type": "application/json" },
      payload: { path: ".git/config", content: "bad config" },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("Cannot modify protected file");
  });
});

describe("Files API - Create file and directory", () => {
  test("POST /api/projects/:id/files/create — create a new file", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/create`,
      headers: { "Content-Type": "application/json" },
      payload: { path: "newfile.txt", type: "file" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Verify the file exists and is empty
    const readRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=newfile.txt`,
    });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json().content).toBe("");
  });

  test("POST /api/projects/:id/files/create — create a new directory", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/create`,
      headers: { "Content-Type": "application/json" },
      payload: { path: "newdir", type: "directory" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Verify the directory exists by listing it
    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files?path=newdir`,
    });
    expect(listRes.statusCode).toBe(200);
    const entries = listRes.json();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(0); // Empty directory
  });

  test("POST /api/projects/:id/files/create — create nested file with parent dirs", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/create`,
      headers: { "Content-Type": "application/json" },
      payload: { path: "deep/nested/file.txt", type: "file" },
    });

    expect(res.statusCode).toBe(200);

    const readRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=deep/nested/file.txt`,
    });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json().content).toBe("");
  });

  test("POST /api/projects/:id/files/create — blocked path returns 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/create`,
      headers: { "Content-Type": "application/json" },
      payload: { path: ".git/hooks/pre-commit", type: "file" },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("Cannot create in protected path");
  });
});

describe("Files API - Rename file", () => {
  test("POST /api/projects/:id/files/rename — rename a file", async () => {
    // First create a file to rename
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/create`,
      headers: { "Content-Type": "application/json" },
      payload: { path: "to-rename.txt", type: "file" },
    });

    // Write some content so we can verify it transfers
    await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/files/write`,
      headers: { "Content-Type": "application/json" },
      payload: { path: "to-rename.txt", content: "rename me" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/rename`,
      headers: { "Content-Type": "application/json" },
      payload: { oldPath: "to-rename.txt", newPath: "renamed.txt" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Old path should be gone
    const oldRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=to-rename.txt`,
    });
    expect(oldRes.statusCode).toBe(404);

    // New path should have the content
    const newRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=renamed.txt`,
    });
    expect(newRes.statusCode).toBe(200);
    expect(newRes.json().content).toBe("rename me");
  });

  test("POST /api/projects/:id/files/rename — blocked oldPath returns 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/rename`,
      headers: { "Content-Type": "application/json" },
      payload: { oldPath: ".env", newPath: "env-backup.txt" },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("Cannot modify protected file");
  });

  test("POST /api/projects/:id/files/rename — blocked newPath returns 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/rename`,
      headers: { "Content-Type": "application/json" },
      payload: { oldPath: "readme.md", newPath: ".git/hooks/post-commit" },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("Cannot modify protected file");
  });
});

describe("Files API - Delete file", () => {
  test("DELETE /api/projects/:id/files/delete?path=... — delete a file", async () => {
    // Create a file to delete
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/create`,
      headers: { "Content-Type": "application/json" },
      payload: { path: "to-delete.txt", type: "file" },
    });

    // Verify it exists
    const existsRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=to-delete.txt`,
    });
    expect(existsRes.statusCode).toBe(200);

    // Delete it
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/files/delete?path=to-delete.txt`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Verify it's gone
    const goneRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/read?path=to-delete.txt`,
    });
    expect(goneRes.statusCode).toBe(404);
  });

  test("DELETE /api/projects/:id/files/delete — delete a directory recursively", async () => {
    // Create a directory with files
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/files/create`,
      headers: { "Content-Type": "application/json" },
      payload: { path: "dir-to-delete/child.txt", type: "file" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/files/delete?path=dir-to-delete`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify the directory is gone
    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files?path=dir-to-delete`,
    });
    expect(listRes.statusCode).toBe(404);
  });

  test("DELETE /api/projects/:id/files/delete — blocked path returns 403", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/files/delete?path=.git/hooks`,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("Cannot delete protected file");
  });
});
