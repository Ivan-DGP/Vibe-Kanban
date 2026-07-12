import { describe, test, expect } from "bun:test";
import { isAllowedOrigin } from "./origin";

describe("isAllowedOrigin", () => {
  test("accepts the static localhost dev origins", () => {
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("http://localhost:3001")).toBe(true);
  });

  test("rejects a missing origin (non-browser client)", () => {
    expect(isAllowedOrigin(undefined)).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
  });

  test("accepts Tailscale MagicDNS (*.ts.net) origins — the deploy trust boundary", () => {
    expect(isAllowedOrigin("https://vps.tail5ad8aa.ts.net")).toBe(true);
    expect(isAllowedOrigin("https://anything.ts.net")).toBe(true);
    // Even when a reverse proxy rewrites Host to the loopback upstream.
    expect(isAllowedOrigin("https://vps.tail5ad8aa.ts.net", "127.0.0.1:8080")).toBe(true);
    // A tailnet host served on a non-default port (suffix check must ignore port).
    expect(isAllowedOrigin("https://vps.tail5ad8aa.ts.net:8443")).toBe(true);
  });

  test("accepts same-origin when Host matches (proxy that preserves Host)", () => {
    expect(isAllowedOrigin("https://vk.example.com", "vk.example.com")).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.5:8080", "192.168.1.5:8080")).toBe(true);
  });

  test("rejects a cross-site origin even if the Host header is the real host", () => {
    // A browser sets Origin itself, so evil.com cannot forge our host here.
    expect(isAllowedOrigin("https://evil.com", "vps.tail5ad8aa.ts.net")).toBe(false);
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
  });

  test("rejects lookalike hosts that merely contain ts.net", () => {
    expect(isAllowedOrigin("https://ts.net.evil.com")).toBe(false);
    expect(isAllowedOrigin("https://notts.net")).toBe(false);
  });

  test("rejects a malformed origin string", () => {
    expect(isAllowedOrigin("not a url", "vps.tail5ad8aa.ts.net")).toBe(false);
  });
});
