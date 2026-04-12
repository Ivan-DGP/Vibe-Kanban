import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "./app";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  
});

// ── Security headers ────────────────────────────────────────

describe("security headers", () => {
  test("responses include X-Content-Type-Options: nosniff", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("responses include X-Frame-Options: DENY", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  test("responses include Referrer-Policy", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("responses include X-XSS-Protection", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.headers["x-xss-protection"]).toBe("1; mode=block");
  });

  test("responses include Content-Security-Policy", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
  });

  test("security headers are present on 404 responses too", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nonexistent-route-xyz" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });
});

// ── Error handler ───────────────────────────────────────────

describe("error handler", () => {
  test("non-existent route returns 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nonexistent-route-xyz" });
    expect(res.statusCode).toBe(404);
  });

  test("500 error returns 'Internal Server Error' message", async () => {
    // POST to projects with empty body triggers a SQLite constraint error (500)
    // which exercises the error handler's 500 path
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("Internal Server Error");
  });

  test("error response body includes 'error' field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {},
    });
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
  });
});

// ── CORS ─────────────────────────────────────────────────────

describe("CORS", () => {
  test("allows requests from localhost:5173", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/projects",
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  test("allows requests from localhost:3001", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/projects",
      headers: { origin: "http://localhost:3001" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
  });
});

// ── Basic route availability ─────────────────────────────────

describe("route registration", () => {
  test("GET /api/projects is registered and returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
  });

  test("GET /api/settings is registered and returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
  });
});
