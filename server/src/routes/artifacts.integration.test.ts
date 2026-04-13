import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Create a test project
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: { name: `Artifact Test ${Date.now()}`, path: `/tmp/artifact-test-${Date.now()}` },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  if (projectId) {
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  }
});

describe("Artifacts API", () => {
  let artifactId: string;

  test("POST /api/projects/:id/artifacts — create artifact", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts`,
      headers: { "Content-Type": "application/json" },
      payload: {
        filename: "architecture.md",
        type: "document",
        description: "System architecture overview",
        tags: ["architecture", "overview"],
        content: "# Architecture\n\nThis is the architecture doc.",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.filename).toBe("architecture.md");
    expect(body.type).toBe("document");
    expect(body.description).toBe("System architecture overview");
    expect(body.tags).toEqual(["architecture", "overview"]);
    expect(body.mimeType).toBe("text/markdown");
    expect(body.sizeBytes).toBeGreaterThan(0);
    artifactId = body.id;
  });

  test("POST — requires filename", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts`,
      headers: { "Content-Type": "application/json" },
      payload: { type: "document" },
    });
    expect(res.statusCode).toBe(400);
  });

  test("GET /api/projects/:id/artifacts — list artifacts", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toBeInstanceOf(Array);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items[0].id).toBe(artifactId);
  });

  test("GET — filter by type", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts?type=document`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(1);
  });

  test("GET — filter by search", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts?search=architecture`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(1);
  });

  test("GET — empty search returns no results", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts?search=xyznonexistent`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBe(0);
  });

  test("GET /api/projects/:id/artifacts/:id — get single artifact", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/${artifactId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(artifactId);
    expect(body.filename).toBe("architecture.md");
  });

  test("GET — 404 for non-existent artifact", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/nonexistent`,
    });
    expect(res.statusCode).toBe(404);
  });

  test("GET /api/projects/:id/artifacts/:id/content — read content", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/${artifactId}/content`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain("# Architecture");
    expect(body.encoding).toBe("utf-8");
  });

  test("PATCH /api/projects/:id/artifacts/:id — update metadata", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/artifacts/${artifactId}`,
      headers: { "Content-Type": "application/json" },
      payload: {
        description: "Updated architecture doc",
        tags: ["architecture", "v2"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.description).toBe("Updated architecture doc");
    expect(body.tags).toEqual(["architecture", "v2"]);
  });

  test("PATCH — update content", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/artifacts/${artifactId}`,
      headers: { "Content-Type": "application/json" },
      payload: { content: "# Architecture v2\n\nUpdated content." },
    });

    expect(res.statusCode).toBe(200);

    // Verify content changed
    const contentRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/${artifactId}/content`,
    });
    expect(contentRes.json().content).toContain("Architecture v2");
  });

  test("PATCH — 404 for non-existent artifact", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/artifacts/nonexistent`,
      headers: { "Content-Type": "application/json" },
      payload: { description: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  test("DELETE /api/projects/:id/artifacts/:id — delete artifact", async () => {
    // Create a throwaway artifact
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts`,
      headers: { "Content-Type": "application/json" },
      payload: { filename: "to-delete.md", content: "delete me" },
    });
    const delId = createRes.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/artifacts/${delId}`,
    });
    expect(res.statusCode).toBe(204);

    // Verify gone
    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/${delId}`,
    });
    expect(getRes.statusCode).toBe(404);
  });

  test("DELETE — 404 for non-existent artifact", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/artifacts/nonexistent`,
    });
    expect(res.statusCode).toBe(404);
  });

  test("creates artifact with correct mime type for json", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts`,
      headers: { "Content-Type": "application/json" },
      payload: { filename: "config.json", type: "other", content: '{"key": "value"}' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mimeType).toBe("application/json");
  });

  test("content endpoint returns base64 for image mime type", async () => {
    // Create an artifact with image mime type by using .png extension
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts`,
      headers: { "Content-Type": "application/json" },
      payload: { filename: "diagram.png", type: "image", content: "fake-image-data" },
    });
    const imgId = createRes.json().id;
    expect(createRes.json().mimeType).toBe("image/png");

    const contentRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/${imgId}/content`,
    });
    expect(contentRes.statusCode).toBe(200);
    expect(contentRes.json().encoding).toBe("base64");
  });

  test("content endpoint 404 when file missing from disk", async () => {
    // Insert a DB row without writing the actual file
    const fakeId = crypto.randomUUID();
    const { getDb } = await import("../db");
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO project_artifacts (id, projectId, filename, type, tags, sizeBytes, mimeType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(fakeId, projectId, "ghost.md", "document", "[]", 0, "text/markdown", now, now);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/${fakeId}/content`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("not found on disk");

    // Clean up
    db.prepare("DELETE FROM project_artifacts WHERE id = ?").run(fakeId);
  });

  test("PATCH — update filename also updates mimeType", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/artifacts/${artifactId}`,
      headers: { "Content-Type": "application/json" },
      payload: { filename: "renamed.json" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().filename).toBe("renamed.json");
    expect(res.json().mimeType).toBe("application/json");

    // Restore original name
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/artifacts/${artifactId}`,
      headers: { "Content-Type": "application/json" },
      payload: { filename: "architecture.md" },
    });
  });

  test("POST — rejects content larger than 10MB", async () => {
    const hugeContent = "x".repeat(11 * 1024 * 1024);
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts`,
      headers: { "Content-Type": "application/json" },
      payload: { filename: "huge.md", content: hugeContent },
    });
    expect(res.statusCode).toBe(413);
  });

  test("PATCH — rejects content larger than 10MB", async () => {
    const hugeContent = "x".repeat(11 * 1024 * 1024);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/artifacts/${artifactId}`,
      headers: { "Content-Type": "application/json" },
      payload: { content: hugeContent },
    });
    expect(res.statusCode).toBe(413);
  });

  test("POST /upload — upload a text file via multipart", async () => {
    const boundary = "----TestBoundary" + Date.now();
    const filename = "upload-test.txt";
    const fileContent = "Hello from uploaded file!";
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: text/plain`,
      ``,
      fileContent,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts/upload`,
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const artifact = res.json();
    expect(artifact.filename).toBe("upload-test.txt");
    expect(artifact.mimeType).toBe("text/plain");
    expect(artifact.type).toBe("document");
    expect(artifact.sizeBytes).toBe(fileContent.length);

    // Verify content was written
    const contentRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/${artifact.id}/content`,
    });
    expect(contentRes.json().content).toBe(fileContent);
    expect(contentRes.json().encoding).toBe("utf-8");
  });

  test("POST /upload — upload a binary file (PNG)", async () => {
    const boundary = "----TestBoundary" + Date.now();
    // Minimal PNG: 1x1 transparent pixel
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==",
      "base64"
    );

    const bodyParts = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`),
      pngBytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts/upload`,
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      payload: bodyParts,
    });

    expect(res.statusCode).toBe(200);
    const artifact = res.json();
    expect(artifact.filename).toBe("pixel.png");
    expect(artifact.mimeType).toBe("image/png");
    expect(artifact.type).toBe("image");
    expect(artifact.sizeBytes).toBe(pngBytes.length);

    // Verify content is returned as base64
    const contentRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/${artifact.id}/content`,
    });
    expect(contentRes.json().encoding).toBe("base64");
  });

  test("POST /upload — upload a PDF", async () => {
    const boundary = "----TestBoundary" + Date.now();
    const pdfContent = "%PDF-1.4 fake pdf content";

    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="spec.pdf"`,
      `Content-Type: application/pdf`,
      ``,
      pdfContent,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts/upload`,
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const artifact = res.json();
    expect(artifact.filename).toBe("spec.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.type).toBe("document");
  });

  test("POST /upload — 400 when no file provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts/upload`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });
    // No multipart data → should fail
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  test("POST /upload — infers type from mime", async () => {
    const boundary = "----TestBoundary" + Date.now();
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="data.json"`,
      `Content-Type: application/json`,
      ``,
      `{"key":"value"}`,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/artifacts/upload`,
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe("spec");
  });

  test("cascade deletes artifacts when project is deleted", async () => {
    // Create a temp project with an artifact
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Cascade Test ${Date.now()}`, path: `/tmp/cascade-test-${Date.now()}` },
    });
    const tempProjectId = projRes.json().id;

    await app.inject({
      method: "POST",
      url: `/api/projects/${tempProjectId}/artifacts`,
      headers: { "Content-Type": "application/json" },
      payload: { filename: "test.md", content: "cascade test" },
    });

    // Delete project
    await app.inject({ method: "DELETE", url: `/api/projects/${tempProjectId}` });

    // Artifacts should be gone (DB cascade)
    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${tempProjectId}/artifacts`,
    });
    expect(listRes.json().items.length).toBe(0);
  });
});
