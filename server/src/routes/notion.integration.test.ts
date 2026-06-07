import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
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

  test("POST /api/notion/search with filter — returns 502 with invalid key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notion/search",
      headers: { "Content-Type": "application/json" },
      payload: { query: "test", filter: "database" },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  test("POST /api/notion/search without query — returns 502 with invalid key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notion/search",
      headers: { "Content-Type": "application/json" },
      payload: {},
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

describe("Notion API — malformed settings value (getNotionToken edge cases)", () => {
  test("getNotionToken returns null for non-JSON value in DB", async () => {
    const db = getDb();
    // Insert a raw non-JSON string — triggers the catch branch in getNotionToken
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "notionApiKey",
      "not-valid-json{{{",
    );

    // Status endpoint should treat it as no token
    const res = await app.inject({
      method: "GET",
      url: "/api/notion/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.user).toBeNull();

    // Search should return 400 (no token)
    const searchRes = await app.inject({
      method: "POST",
      url: "/api/notion/search",
      headers: { "Content-Type": "application/json" },
      payload: { query: "test" },
    });
    expect(searchRes.statusCode).toBe(400);

    db.prepare("DELETE FROM settings WHERE key = ?").run("notionApiKey");
  });

  test("getNotionToken returns null for empty-string token", async () => {
    const db = getDb();
    // JSON.parse('""') returns "" which is falsy → null
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "notionApiKey",
      JSON.stringify(""),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/notion/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.user).toBeNull();

    // All endpoints should return 400 since token is null
    const dbRes = await app.inject({
      method: "GET",
      url: "/api/notion/databases",
    });
    expect(dbRes.statusCode).toBe(400);

    const pagesRes = await app.inject({
      method: "GET",
      url: "/api/notion/databases/some-id/pages",
    });
    expect(pagesRes.statusCode).toBe(400);

    const pageRes = await app.inject({
      method: "GET",
      url: "/api/notion/pages/some-id",
    });
    expect(pageRes.statusCode).toBe(400);

    db.prepare("DELETE FROM settings WHERE key = ?").run("notionApiKey");
  });

  test("getNotionToken returns null for JSON null value", async () => {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "notionApiKey",
      JSON.stringify(null),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/notion/status",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connected).toBe(false);

    db.prepare("DELETE FROM settings WHERE key = ?").run("notionApiKey");
  });
});

describe("Notion API — success paths (mocked fetch)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    // Set a valid-looking API key so routes proceed past the token check
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "notionApiKey",
      JSON.stringify("ntn_mocked_success_key"),
    );
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = ?").run("notionApiKey");
  });

  afterEach(() => {
    // Restore real fetch between tests so one mock doesn't bleed into next
    globalThis.fetch = originalFetch;
  });

  test("GET /api/notion/status — returns connected: true when fetch succeeds", async () => {
    globalThis.fetch = (async (_url: any, _init: any) =>
      new Response(JSON.stringify({ name: "Test Bot", object: "user" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const res = await app.inject({
      method: "GET",
      url: "/api/notion/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(true);
    expect(body.user).toBe("Test Bot");
  });

  test("POST /api/notion/search — returns results on success", async () => {
    globalThis.fetch = (async (_url: any, _init: any) =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "page-1",
              object: "page",
              url: "https://notion.so/page-1",
              last_edited_time: "2024-01-01T00:00:00.000Z",
              title: [{ plain_text: "My Page" }],
              icon: null,
            },
            {
              id: "db-1",
              object: "database",
              url: "https://notion.so/db-1",
              last_edited_time: "2024-01-02T00:00:00.000Z",
              title: [{ plain_text: "My Database" }],
              icon: { type: "emoji", emoji: "📋" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/api/notion/search",
      headers: { "Content-Type": "application/json" },
      payload: { query: "My" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].id).toBe("page-1");
    expect(body.results[0].type).toBe("page");
    expect(body.results[0].title).toBe("My Page");
    expect(body.results[1].id).toBe("db-1");
    expect(body.results[1].type).toBe("database");
    expect(body.results[1].icon).toBe("📋");
  });

  test("POST /api/notion/search with filter — returns filtered results", async () => {
    globalThis.fetch = (async (_url: any, _init: any) =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "db-2",
              object: "database",
              url: "https://notion.so/db-2",
              last_edited_time: "2024-01-03T00:00:00.000Z",
              title: [{ plain_text: "Tasks DB" }],
              icon: null,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/api/notion/search",
      headers: { "Content-Type": "application/json" },
      payload: { filter: "database" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].type).toBe("database");
  });

  test("GET /api/notion/databases — returns databases on success", async () => {
    globalThis.fetch = (async (_url: any, _init: any) =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "db-abc",
              object: "database",
              url: "https://notion.so/db-abc",
              last_edited_time: "2024-02-01T00:00:00.000Z",
              title: [{ plain_text: "Project Tasks" }],
              icon: { type: "emoji", emoji: "🗂️" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const res = await app.inject({
      method: "GET",
      url: "/api/notion/databases",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.databases)).toBe(true);
    expect(body.databases).toHaveLength(1);
    expect(body.databases[0].id).toBe("db-abc");
    expect(body.databases[0].title).toBe("Project Tasks");
    expect(body.databases[0].icon).toBe("🗂️");
    expect(body.databases[0].url).toBe("https://notion.so/db-abc");
    expect(body.databases[0].lastEditedTime).toBe("2024-02-01T00:00:00.000Z");
  });

  test("GET /api/notion/databases — returns empty array when no databases", async () => {
    globalThis.fetch = (async (_url: any, _init: any) =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const res = await app.inject({
      method: "GET",
      url: "/api/notion/databases",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().databases).toEqual([]);
  });

  test("GET /api/notion/databases/:id/pages — returns pages on success", async () => {
    globalThis.fetch = (async (_url: any, _init: any) =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "page-xyz",
              object: "page",
              url: "https://notion.so/page-xyz",
              last_edited_time: "2024-03-01T00:00:00.000Z",
              icon: null,
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: "Task One" }],
                },
                Status: {
                  type: "select",
                  select: { name: "In Progress" },
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const res = await app.inject({
      method: "GET",
      url: "/api/notion/databases/db-test-id/pages",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.pages)).toBe(true);
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].id).toBe("page-xyz");
    expect(body.pages[0].title).toBe("Task One");
    expect(body.pages[0].properties).toBeDefined();
    expect(body.pages[0].properties.Name).toBe("Task One");
    expect(body.pages[0].properties.Status).toBe("In Progress");
  });

  test("GET /api/notion/pages/:id — returns page content as markdown on success", async () => {
    globalThis.fetch = (async (url: any, _init: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/blocks/")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Hello world", annotations: {} }] },
              },
              {
                type: "heading_1",
                heading_1: { rich_text: [{ plain_text: "Title", annotations: {} }] },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // page metadata
      return new Response(
        JSON.stringify({
          id: "page-content-1",
          object: "page",
          url: "https://notion.so/page-content-1",
          last_edited_time: "2024-04-01T00:00:00.000Z",
          icon: null,
          title: [{ plain_text: "My Article" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const res = await app.inject({
      method: "GET",
      url: "/api/notion/pages/page-content-1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("page-content-1");
    expect(body.url).toBe("https://notion.so/page-content-1");
    expect(typeof body.markdown).toBe("string");
    expect(body.markdown).toContain("Hello world");
    expect(body.markdown).toContain("# Title");
  });

  test("notionFetch success path — res.json() is called (line 99 covered)", async () => {
    // Directly verify the notionFetch success branch by calling a route that exercises it
    globalThis.fetch = (async (_url: any, _init: any) =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    // Any successful Notion API call covers the res.json() return in notionFetch
    const res = await app.inject({
      method: "POST",
      url: "/api/notion/search",
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([]);
  });
});
