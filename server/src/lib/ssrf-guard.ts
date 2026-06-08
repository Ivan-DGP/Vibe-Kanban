import dns from "node:dns";
import net from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

/** True for loopback, link-local (incl. cloud metadata 169.254.169.254), private, CGNAT, ULA, multicast. */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.split("%")[0]; // strip IPv6 zone id
  if (net.isIPv4(addr)) {
    const parts = addr.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 127) return true; // this-host / loopback
    if (a === 10) return true; // private
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(addr)) {
    const lower = addr.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
}

/**
 * Validate that `rawUrl` is an http(s) URL whose host does not resolve to a
 * loopback/private/metadata address. Returns the parsed URL. Throws SsrfError.
 *
 * Note: there is a residual DNS-rebinding TOCTOU window between this check and
 * the actual connect; callers that need hard guarantees should pin the resolved
 * IP. This still blocks the overwhelmingly common SSRF vectors.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("Only http(s) URLs are allowed");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new SsrfError("Target host is not allowed");
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new SsrfError("Target resolves to a private address");
    return url;
  }
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new SsrfError("Host could not be resolved");
  }
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new SsrfError("Target resolves to a private address");
  }
  return url;
}

function isLinkLocalOrMetadata(ip: string): boolean {
  const addr = ip.split("%")[0];
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split(".").map(Number);
    return a === 169 && b === 254; // includes 169.254.169.254 cloud metadata
  }
  if (net.isIPv6(addr)) {
    const lower = addr.toLowerCase();
    return lower.startsWith("fe80") || /::ffff:169\.254\./.test(lower);
  }
  return false;
}

/**
 * Lighter guard for the user-facing API-client proxy, whose legitimate job is to
 * reach arbitrary URLs the developer types — including their own localhost/LAN
 * services. So this allows private targets but still blocks cloud-metadata and
 * link-local endpoints (the crown-jewel SSRF target) and non-http(s) schemes.
 * Synchronous (no DNS) so genuine network failures surface as fetch errors, not
 * guard rejections. Cross-origin abuse is handled separately via an Origin check.
 */
export function assertProxyTarget(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("Only http(s) URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "metadata.google.internal") {
    throw new SsrfError("Target host is not allowed");
  }
  if (net.isIP(host) && isLinkLocalOrMetadata(host)) {
    throw new SsrfError("Link-local/metadata addresses are not allowed");
  }
  return url;
}

/** fetch() for the API-client proxy: validates each hop with assertProxyTarget. */
export async function proxyFetch(
  rawUrl: string,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? 5;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertProxyTarget(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop === maxRedirects) throw new SsrfError("Too many redirects");
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new SsrfError("Too many redirects");
}

/**
 * fetch() with SSRF validation on the initial URL and on every redirect hop
 * (redirects are followed manually so an open redirect cannot pivot to an
 * internal host). Use for fixed external integrations (never localhost).
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? 5;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop === maxRedirects) throw new SsrfError("Too many redirects");
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new SsrfError("Too many redirects");
}
