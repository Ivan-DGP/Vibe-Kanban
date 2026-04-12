import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import { getDb } from "../db";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Ensure no Notion API key is configured so we test the "not configured" paths
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE key = ?").run("notionApiKey");
});

afterAll(async () => {
  // nothing to clean up
});

describe("Notion API — no API key configured", () => {
  test("GET /api/notion/status — returns connected: false without API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.user).toBeNull();
  });

  test("POST /api/notion/search — returns 400 without API key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notion/search",
      headers: { "Content-Type": "application/json" },
      payload: { query: "test" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Notion API key not configured");
  });

  test("GET /api/notion/databases — returns 400 without API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/databases",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Notion API key not configured");
  });

  test("GET /api/notion/databases/:id/pages — returns 400 without API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/databases/some-db-id/pages",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Notion API key not configured");
  });

  test("GET /api/notion/pages/:id — returns 400 without API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/pages/some-page-id",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Notion API key not configured");
  });
});

describe("Notion API — invalid API key", () => {
  beforeAll(() => {
    // Set an invalid API key to trigger the Notion API error paths
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "notionApiKey",
      JSON.stringify("ntn_invalid_test_key_12345"),
    );
  });

  afterAll(() => {
    // Clean up the invalid key
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = ?").run("notionApiKey");
  });

  test("GET /api/notion/status — returns connected: false with invalid key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    // error message should be present since the API call will fail
    expect(body.error).toBeDefined();
  });

  test("POST /api/notion/search — returns 502 with invalid key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notion/search",
      headers: { "Content-Type": "application/json" },
      payload: { query: "test" },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  test("GET /api/notion/databases — returns 502 with invalid key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/databases",
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  test("GET /api/notion/databases/:id/pages — returns 502 with invalid key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/databases/fake-db-id/pages",
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  test("GET /api/notion/pages/:id — returns 502 with invalid key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/pages/fake-page-id",
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBeDefined();
  });
});
