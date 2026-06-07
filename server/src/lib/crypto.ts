import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./data-dir";

const ALGORITHM = "aes-256-gcm";
const LEGACY_ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 12; // 96-bit nonce, standard for GCM
const VERSION_PREFIX = "v2";
const KEY_FILE = ".encryption-key";

let cachedKey: Buffer | null = null;

function parseEnvKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const b = Buffer.from(trimmed, "base64");
    if (b.length === 32) return b;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Real secret key with real entropy:
 *  1. VIBE_KANBAN_ENCRYPTION_KEY env var (32 bytes, hex or base64), else
 *  2. a random 32-byte key persisted to <dataDir>/.encryption-key (mode 0600),
 *     generated on first use.
 * The previous scheme derived the key from hostname+username (no secret), so
 * anyone with the DB could reconstruct it — that is now legacy-decrypt only.
 */
function loadOrCreateKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.VIBE_KANBAN_ENCRYPTION_KEY;
  if (envKey) {
    const parsed = parseEnvKey(envKey);
    if (!parsed)
      throw new Error("VIBE_KANBAN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
    cachedKey = parsed;
    return parsed;
  }

  const keyPath = path.join(getDataDir(), KEY_FILE);
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length >= 32) {
      cachedKey = existing.subarray(0, 32);
      return cachedKey;
    }
  } catch {
    /* not created yet */
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600); // enforce perms even if umask widened them
  } catch {
    /* best effort on platforms without chmod */
  }
  cachedKey = key;
  return key;
}

/** Legacy host/user-derived key — used ONLY to read pre-existing CBC ciphertext. */
function legacyKey(): Buffer {
  const material = `${os.hostname()}:${os.userInfo().username}:vibe-kanban-salt`;
  return crypto.pbkdf2Sync(material, "vibe-kanban", 100000, 32, "sha256");
}

export function encrypt(text: string): string {
  if (typeof text !== "string") throw new TypeError("encrypt() expects a string");
  const key = loadOrCreateKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decryptGcm(payload: string): string {
  const [, ivHex, tagHex, dataHex] = payload.split(":");
  // dataHex may legitimately be "" (encrypting an empty string), so check for
  // presence (undefined) rather than truthiness.
  if (!ivHex || !tagHex || dataHex === undefined) throw new Error("Malformed ciphertext");
  const decipher = crypto.createDecipheriv(ALGORITHM, loadOrCreateKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString(
    "utf8",
  );
}

function decryptLegacyCbc(payload: string): string {
  const [ivHex, dataHex] = payload.split(":");
  if (!ivHex || !dataHex) throw new Error("Malformed ciphertext");
  const decipher = crypto.createDecipheriv(
    LEGACY_ALGORITHM,
    legacyKey(),
    Buffer.from(ivHex, "hex"),
  );
  let dec = decipher.update(dataHex, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

export function decrypt(encryptedText: string): string {
  if (typeof encryptedText !== "string" || !encryptedText)
    throw new Error("decrypt() expects a non-empty string");
  if (encryptedText.startsWith(VERSION_PREFIX + ":")) return decryptGcm(encryptedText);
  return decryptLegacyCbc(encryptedText); // backward compat with old CBC values
}

/** Non-throwing decrypt: returns null on malformed / tampered / undecryptable input. */
export function tryDecrypt(encryptedText: string): string | null {
  try {
    return decrypt(encryptedText);
  } catch {
    return null;
  }
}

/** True when `value` is not in the current authenticated (v2) format and should be re-encrypted on next write. */
export function isLegacyCiphertext(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && !value.startsWith(VERSION_PREFIX + ":");
}
