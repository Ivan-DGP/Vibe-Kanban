import crypto from "node:crypto";
import os from "node:os";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

function deriveKey(): Buffer {
  const material = `${os.hostname()}:${os.userInfo().username}:vibe-kanban-salt`;
  return crypto.pbkdf2Sync(material, "vibe-kanban", 100000, 32, "sha256");
}

export function encrypt(text: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedText: string): string {
  const key = deriveKey();
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
