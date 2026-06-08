import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { APPS_SCRIPT_REGEX } from "./sync";
import { buildApp } from "../app";

// ─── Unit tests: APPS_SCRIPT_REGEX ────────────────────────────────────────────

describe("APPS_SCRIPT_REGEX", () => {
  test("matches a valid Google Apps Script URL", () => {
    expect(
      APPS_SCRIPT_REGEX.test("https://script.google.com/macros/s/AKfycbxExample123/exec"),
    ).toBe(true);
  });

  test("matches a URL with long deployment ID", () => {
    expect(
      APPS_SCRIPT_REGEX.test(
        "https://script.google.com/macros/s/AKfycbxVeryLongDeploymentId_1234567890abcdef/exec",
      ),
    ).toBe(true);
  });

  test("matches a URL with /dev suffix", () => {
    expect(APPS_SCRIPT_REGEX.test("https://script.google.com/macros/s/AKfycbxExample/dev")).toBe(
      true,
    );
  });

  test("rejects http:// (non-TLS)", () => {
    expect(APPS_SCRIPT_REGEX.test("http://script.google.com/macros/s/AKfycbxExample/exec")).toBe(
      false,
    );
  });

  test("rejects a completely unrelated URL", () => {
    expect(APPS_SCRIPT_REGEX.test("https://example.com/some/path")).toBe(false);
  });

  test("rejects an empty string", () => {
    expect(APPS_SCRIPT_REGEX.test("")).toBe(false);
  });

  test("rejects a URL without the /macros/s/ path segment", () => {
    expect(APPS_SCRIPT_REGEX.test("https://script.google.com/other/path")).toBe(false);
  });

  test("rejects a URL that ends at /macros/s/ (nothing after)", () => {
    expect(APPS_SCRIPT_REGEX.test("https://script.google.com/macros/s/")).toBe(false);
  });

  test("rejects null-ish inputs coerced to string", () => {
    expect(APPS_SCRIPT_REGEX.test("undefined")).toBe(false);
    expect(APPS_SCRIPT_REGEX.test("null")).toBe(false);
  });

  test("rejects a URL with extra prefix domain", () => {
    expect(APPS_SCRIPT_REGEX.test("https://evil.script.google.com/macros/s/deploy/exec")).toBe(
      false,
    );
  });
});

// ─── Integration tests via app.inject() ───────────────────────────────────────

describe("sync routes integration", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {});

  // --- /sync/push ---

  describe("POST /api/sync/push", () => {
    test("returns 400 for missing URL", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/push",
        headers: { "Content-Type": "application/json" },
        payload: { tasks: [] },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Invalid Google Apps Script URL");
    });

    test("returns 400 for invalid URL (random string)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/push",
        headers: { "Content-Type": "application/json" },
        payload: { url: "https://example.com/not-google", tasks: [] },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Invalid Google Apps Script URL");
    });

    test("returns 400 for empty URL string", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/push",
        headers: { "Content-Type": "application/json" },
        payload: { url: "", tasks: [] },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Invalid Google Apps Script URL");
    });

    test("returns 400 for http:// URL (non-TLS)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/push",
        headers: { "Content-Type": "application/json" },
        payload: {
          url: "http://script.google.com/macros/s/AKfycbx123/exec",
          tasks: [],
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Invalid Google Apps Script URL");
    });
  });

  // --- /sync/pull ---

  describe("POST /api/sync/pull", () => {
    test("returns 400 for missing URL", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/pull",
        headers: { "Content-Type": "application/json" },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Invalid Google Apps Script URL");
    });

    test("returns 400 for invalid URL", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/pull",
        headers: { "Content-Type": "application/json" },
        payload: { url: "https://evil.com/steal-data" },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Invalid Google Apps Script URL");
    });

    test("returns 400 for undefined URL value", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/pull",
        headers: { "Content-Type": "application/json" },
        payload: { url: undefined },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Invalid Google Apps Script URL");
    });
  });
});

// ─── Fetch mock tests ─────────────────────────────────────────────────────────

describe("sync routes — fetch paths", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const VALID_URL = "https://script.google.com/macros/s/AKfycbxTest123/exec";
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe("POST /api/sync/push — success path", () => {
    test("calls fetch with push action and returns response JSON", async () => {
      const mockResponse = { ok: true, synced: 5 };
      globalThis.fetch = (async (url: any, init: any) => {
        expect(String(url)).toBe(VALID_URL);
        expect(init.method).toBe("POST");
        const body = JSON.parse(init.body);
        expect(body.action).toBe("push");
        expect(Array.isArray(body.tasks)).toBe(true);
        return new Response(JSON.stringify(mockResponse), {
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: "POST",
        url: "/api/sync/push",
        headers: { "Content-Type": "application/json" },
        payload: { url: VALID_URL, tasks: [{ id: "1", title: "Task A" }] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.synced).toBe(5);
    });

    test("forwards tasks array to the Apps Script endpoint", async () => {
      let capturedBody: any;
      globalThis.fetch = (async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ received: capturedBody.tasks.length }), {
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const tasks = [
        { id: "a", title: "Alpha" },
        { id: "b", title: "Beta" },
      ];
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/push",
        headers: { "Content-Type": "application/json" },
        payload: { url: VALID_URL, tasks },
      });

      expect(res.statusCode).toBe(200);
      expect(capturedBody.action).toBe("push");
      expect(capturedBody.tasks).toHaveLength(2);
      const body = res.json();
      expect(body.received).toBe(2);
    });

    test("propagates fetch errors as 500", async () => {
      globalThis.fetch = (async () => {
        throw new Error("Network failure");
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: "POST",
        url: "/api/sync/push",
        headers: { "Content-Type": "application/json" },
        payload: { url: VALID_URL, tasks: [] },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  describe("POST /api/sync/pull — success path", () => {
    test("calls fetch with pull action and returns response JSON", async () => {
      const mockTasks = [{ id: "x", title: "From Sheet" }];
      globalThis.fetch = (async (url: any, init: any) => {
        expect(String(url)).toBe(VALID_URL);
        expect(init.method).toBe("POST");
        const body = JSON.parse(init.body);
        expect(body.action).toBe("pull");
        return new Response(JSON.stringify({ tasks: mockTasks }), {
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: "POST",
        url: "/api/sync/pull",
        headers: { "Content-Type": "application/json" },
        payload: { url: VALID_URL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].id).toBe("x");
    });

    test("pull sends no tasks in body", async () => {
      let capturedBody: any;
      globalThis.fetch = (async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ tasks: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      await app.inject({
        method: "POST",
        url: "/api/sync/pull",
        headers: { "Content-Type": "application/json" },
        payload: { url: VALID_URL },
      });

      expect(capturedBody.action).toBe("pull");
      expect(capturedBody.tasks).toBeUndefined();
    });

    test("propagates fetch errors as 500", async () => {
      globalThis.fetch = (async () => {
        throw new Error("Timeout");
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: "POST",
        url: "/api/sync/pull",
        headers: { "Content-Type": "application/json" },
        payload: { url: VALID_URL },
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
