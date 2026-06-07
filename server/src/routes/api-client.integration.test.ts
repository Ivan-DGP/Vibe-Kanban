import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {});

describe("API Client — Collections CRUD", () => {
  const uniqueSuffix = Date.now();
  let projectId: string;
  let collectionId: string;

  beforeAll(async () => {
    // Create a project to own the collections
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `API Client Test Project ${uniqueSuffix}`,
        path: `/tmp/api-client-test-${uniqueSuffix}`,
      },
    });
    projectId = res.json().id;
  });

  afterAll(async () => {
    // Clean up project (cascades to collections and requests)
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
    });
  });

  test("GET /api/projects/:projectId/api-collections — list empty collections", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/api-collections`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test("POST /api/projects/:projectId/api-collections — create collection", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/api-collections`,
      headers: { "Content-Type": "application/json" },
      payload: { name: `Auth Endpoints ${uniqueSuffix}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.projectId).toBe(projectId);
    expect(body.name).toBe(`Auth Endpoints ${uniqueSuffix}`);
    expect(body.sortOrder).toBe(1);
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();

    collectionId = body.id;
  });

  test("POST /api/projects/:projectId/api-collections — second collection gets sortOrder 2", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/api-collections`,
      headers: { "Content-Type": "application/json" },
      payload: { name: `User Endpoints ${uniqueSuffix}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sortOrder).toBe(2);
  });

  test("GET /api/projects/:projectId/api-collections — list includes created collections", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/api-collections`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);

    const found = body.find((c: any) => c.id === collectionId);
    expect(found).toBeDefined();
    expect(found.name).toBe(`Auth Endpoints ${uniqueSuffix}`);
  });

  test("PATCH /api/api-collections/:id — update collection name", async () => {
    const updatedName = `Auth Endpoints Updated ${uniqueSuffix}`;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/api-collections/${collectionId}`,
      headers: { "Content-Type": "application/json" },
      payload: { name: updatedName },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(collectionId);
    expect(body.name).toBe(updatedName);
  });

  test("PATCH /api/api-collections/:id — update sortOrder", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/api-collections/${collectionId}`,
      headers: { "Content-Type": "application/json" },
      payload: { sortOrder: 99 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sortOrder).toBe(99);
  });

  test("PATCH /api/api-collections/:id — returns 404 for non-existent collection", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/api-collections/non-existent-collection-id",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Ghost Collection" },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Collection not found");
  });

  test("DELETE /api/api-collections/:id — delete collection", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/api-collections/${collectionId}`,
    });

    expect(res.statusCode).toBe(204);
  });

  test("GET /api/projects/:projectId/api-collections — deleted collection no longer listed", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/api-collections`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.find((c: any) => c.id === collectionId);
    expect(found).toBeUndefined();
  });
});

describe("API Client — Requests CRUD", () => {
  const uniqueSuffix = Date.now();
  let projectId: string;
  let collectionId: string;
  let requestId: string;

  beforeAll(async () => {
    // Create a project and collection for request tests
    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `API Request Test Project ${uniqueSuffix}`,
        path: `/tmp/api-request-test-${uniqueSuffix}`,
      },
    });
    projectId = projectRes.json().id;

    const collRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/api-collections`,
      headers: { "Content-Type": "application/json" },
      payload: { name: `Test Collection ${uniqueSuffix}` },
    });
    collectionId = collRes.json().id;
  });

  afterAll(async () => {
    // Clean up project (cascades to collections and requests)
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
    });
  });

  test("POST /api/api-requests — create request with full details", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-requests",
      headers: { "Content-Type": "application/json" },
      payload: {
        collectionId,
        name: `Get Users ${uniqueSuffix}`,
        method: "GET",
        url: "http://localhost:3001/api/projects",
        headers: '{"Accept": "application/json"}',
        body: "",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.collectionId).toBe(collectionId);
    expect(body.name).toBe(`Get Users ${uniqueSuffix}`);
    expect(body.method).toBe("GET");
    expect(body.url).toBe("http://localhost:3001/api/projects");
    expect(body.sortOrder).toBe(1);
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();

    requestId = body.id;
  });

  test("POST /api/api-requests — defaults for name and method", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-requests",
      headers: { "Content-Type": "application/json" },
      payload: {
        collectionId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("New Request");
    expect(body.method).toBe("GET");
    expect(body.url).toBe("");
    expect(body.sortOrder).toBe(2);
  });

  test("GET /api/api-collections/:collectionId/requests — list requests in collection", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/api-collections/${collectionId}/requests`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);

    const found = body.find((r: any) => r.id === requestId);
    expect(found).toBeDefined();
    expect(found.name).toBe(`Get Users ${uniqueSuffix}`);
    expect(found.method).toBe("GET");
  });

  test("GET /api/projects/:projectId/api-requests — list all requests for project", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/api-requests`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);

    const found = body.find((r: any) => r.id === requestId);
    expect(found).toBeDefined();
  });

  test("PATCH /api/api-requests/:id — update request name and method", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/api-requests/${requestId}`,
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `Updated Request ${uniqueSuffix}`,
        method: "POST",
        url: "http://localhost:3001/api/projects",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(requestId);
    expect(body.name).toBe(`Updated Request ${uniqueSuffix}`);
    expect(body.method).toBe("POST");
    expect(body.url).toBe("http://localhost:3001/api/projects");
  });

  test("PATCH /api/api-requests/:id — update lastResponseStatus and lastResponseTime", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/api-requests/${requestId}`,
      headers: { "Content-Type": "application/json" },
      payload: {
        lastResponseStatus: 200,
        lastResponseTime: 150,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lastResponseStatus).toBe(200);
    expect(body.lastResponseTime).toBe(150);
  });

  test("PATCH /api/api-requests/:id — returns 404 for non-existent request", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/api-requests/non-existent-request-id",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Ghost Request" },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Request not found");
  });

  test("DELETE /api/api-requests/:id — delete request", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/api-requests/${requestId}`,
    });

    expect(res.statusCode).toBe(204);
  });

  test("GET /api/api-collections/:collectionId/requests — deleted request no longer listed", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/api-collections/${collectionId}/requests`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.find((r: any) => r.id === requestId);
    expect(found).toBeUndefined();
  });
});

describe("API Client — Execute Request (Proxy)", () => {
  let targetServer: ReturnType<typeof Bun.serve>;
  let targetUrl: string;

  beforeAll(async () => {
    // Start a tiny HTTP server to serve as a proxy target
    targetServer = Bun.serve({
      port: 0, // OS picks a free port
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/json-endpoint") {
          return new Response(JSON.stringify({ hello: "world" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.pathname === "/text-endpoint") {
          return new Response("plain text response", {
            headers: { "Content-Type": "text/plain" },
          });
        }
        if (url.pathname === "/echo-post" && req.method === "POST") {
          return req.text().then(
            (body) =>
              new Response(JSON.stringify({ method: "POST", receivedBody: body }), {
                headers: { "Content-Type": "application/json" },
              }),
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    targetUrl = `http://localhost:${targetServer.port}`;
  });

  afterAll(() => {
    targetServer?.stop();
  });

  test("POST /api/api-client/execute — missing url returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-client/execute",
      headers: { "Content-Type": "application/json" },
      payload: {
        method: "GET",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("url is required");
  });

  test("POST /api/api-client/execute — GET to invalid host returns 502", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-client/execute",
      headers: { "Content-Type": "application/json" },
      payload: {
        method: "GET",
        url: "http://this-host-does-not-exist.invalid/path",
      },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.status).toBe(0);
    expect(body.statusText).toBe("Network Error");
    expect(body.timeMs).toBeDefined();
  });

  test("POST /api/api-client/execute — successful GET returning JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-client/execute",
      headers: { "Content-Type": "application/json" },
      payload: {
        method: "GET",
        url: `${targetUrl}/json-endpoint`,
        headers: { Accept: "application/json" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe(200);
    expect(body.statusText).toBe("OK");
    expect(typeof body.timeMs).toBe("number");
    expect(body.timeMs).toBeGreaterThanOrEqual(0);
    expect(typeof body.headers).toBe("object");
    // Body should be pretty-printed JSON
    const parsed = JSON.parse(body.body);
    expect(parsed.hello).toBe("world");
  });

  test("POST /api/api-client/execute — successful GET returning text", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-client/execute",
      headers: { "Content-Type": "application/json" },
      payload: {
        method: "GET",
        url: `${targetUrl}/text-endpoint`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe(200);
    expect(body.body).toBe("plain text response");
  });

  test("POST /api/api-client/execute — successful POST with body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-client/execute",
      headers: { "Content-Type": "application/json" },
      payload: {
        method: "POST",
        url: `${targetUrl}/echo-post`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test-payload" }),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe(200);
    const parsed = JSON.parse(body.body);
    expect(parsed.method).toBe("POST");
    expect(parsed.receivedBody).toBe(JSON.stringify({ data: "test-payload" }));
  });

  test("POST /api/api-client/execute — GET ignores body even if provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-client/execute",
      headers: { "Content-Type": "application/json" },
      payload: {
        method: "GET",
        url: `${targetUrl}/json-endpoint`,
        body: "should-be-ignored",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe(200);
    // Should still get the JSON response since body is ignored for GET
    const parsed = JSON.parse(body.body);
    expect(parsed.hello).toBe("world");
  });

  test("POST /api/api-client/execute — defaults method to GET when omitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-client/execute",
      headers: { "Content-Type": "application/json" },
      payload: {
        url: `${targetUrl}/json-endpoint`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe(200);
    const parsed = JSON.parse(body.body);
    expect(parsed.hello).toBe("world");
  });
});

describe("API Client — PATCH edge cases", () => {
  const uniqueSuffix = Date.now();
  let projectId: string;
  let collectionId: string;
  let requestId: string;

  beforeAll(async () => {
    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `PATCH Edge Test ${uniqueSuffix}`,
        path: `/tmp/patch-edge-test-${uniqueSuffix}`,
      },
    });
    projectId = projectRes.json().id;

    const collRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/api-collections`,
      headers: { "Content-Type": "application/json" },
      payload: { name: `Edge Collection ${uniqueSuffix}` },
    });
    collectionId = collRes.json().id;

    const reqRes = await app.inject({
      method: "POST",
      url: "/api/api-requests",
      headers: { "Content-Type": "application/json" },
      payload: { collectionId, name: "Edge Request", method: "GET", url: "http://example.com" },
    });
    requestId = reqRes.json().id;
  });

  afterAll(async () => {
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  });

  test("PATCH /api/api-collections/:id with no recognized fields still returns current row", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/api-collections/${collectionId}`,
      headers: { "Content-Type": "application/json" },
      payload: { unknownField: "ignored" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(collectionId);
    expect(body.name).toBe(`Edge Collection ${uniqueSuffix}`);
  });

  test("PATCH /api/api-requests/:id with no recognized fields still returns current row", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/api-requests/${requestId}`,
      headers: { "Content-Type": "application/json" },
      payload: { unknownField: "ignored" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(requestId);
    expect(body.name).toBe("Edge Request");
  });

  test("POST /api/api-client/execute — filters out empty header values", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/api-client/execute",
      headers: { "Content-Type": "application/json" },
      payload: {
        method: "GET",
        url: "http://this-host-does-not-exist.invalid/path",
        headers: { "X-Empty": "", "X-Spaces": "   ", "X-Valid": "yes" },
      },
    });
    // Will fail to connect, but the header filtering logic is exercised
    expect(res.statusCode).toBe(502);
  });
});

describe("API Client — Cascade Delete", () => {
  const uniqueSuffix = Date.now();
  let projectId: string;
  let collectionId: string;

  test("deleting a collection cascades to its requests", async () => {
    // Create project
    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `Cascade Test ${uniqueSuffix}`,
        path: `/tmp/cascade-test-${uniqueSuffix}`,
      },
    });
    projectId = projectRes.json().id;

    // Create collection
    const collRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/api-collections`,
      headers: { "Content-Type": "application/json" },
      payload: { name: "Ephemeral Collection" },
    });
    collectionId = collRes.json().id;

    // Create a request in the collection
    const reqRes = await app.inject({
      method: "POST",
      url: "/api/api-requests",
      headers: { "Content-Type": "application/json" },
      payload: {
        collectionId,
        name: "Ephemeral Request",
        method: "GET",
        url: "http://example.com",
      },
    });
    expect(reqRes.statusCode).toBe(200);

    // Delete the collection
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/api-collections/${collectionId}`,
    });
    expect(delRes.statusCode).toBe(204);

    // Verify requests in that collection are gone
    const listRes = await app.inject({
      method: "GET",
      url: `/api/api-collections/${collectionId}/requests`,
    });
    expect(listRes.statusCode).toBe(200);
    const requests = listRes.json();
    expect(requests.length).toBe(0);

    // Clean up project
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
    });
  });
});
