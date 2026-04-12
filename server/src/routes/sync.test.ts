import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { APPS_SCRIPT_REGEX } from "./sync";
import { buildApp } from "../app";

// ─── Unit tests: APPS_SCRIPT_REGEX ────────────────────────────────────────────

describe("APPS_SCRIPT_REGEX", () => {
  test("matches a valid Google Apps Script URL", () => {
    expect(
      APPS_SCRIPT_REGEX.test(
        "https://script.google.com/macros/s/AKfycbxExample123/exec",
      ),
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
    expect(
      APPS_SCRIPT_REGEX.test(
        "https://script.google.com/macros/s/AKfycbxExample/dev",
      ),
    ).toBe(true);
  });

  test("rejects http:// (non-TLS)", () => {
    expect(
      APPS_SCRIPT_REGEX.test(
        "http://script.google.com/macros/s/AKfycbxExample/exec",
      ),
    ).toBe(false);
  });

  test("rejects a completely unrelated URL", () => {
    expect(APPS_SCRIPT_REGEX.test("https://example.com/some/path")).toBe(false);
  });

  test("rejects an empty string", () => {
    expect(APPS_SCRIPT_REGEX.test("")).toBe(false);
  });

  test("rejects a URL without the /macros/s/ path segment", () => {
    expect(
      APPS_SCRIPT_REGEX.test("https://script.google.com/other/path"),
    ).toBe(false);
  });

  test("rejects a URL that ends at /macros/s/ (nothing after)", () => {
    expect(
      APPS_SCRIPT_REGEX.test("https://script.google.com/macros/s/"),
    ).toBe(false);
  });

  test("rejects null-ish inputs coerced to string", () => {
    expect(APPS_SCRIPT_REGEX.test("undefined")).toBe(false);
    expect(APPS_SCRIPT_REGEX.test("null")).toBe(false);
  });

  test("rejects a URL with extra prefix domain", () => {
    expect(
      APPS_SCRIPT_REGEX.test(
        "https://evil.script.google.com/macros/s/deploy/exec",
      ),
    ).toBe(false);
  });
});

// ─── Integration tests via app.inject() ───────────────────────────────────────

describe("sync routes integration", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    
  });

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
