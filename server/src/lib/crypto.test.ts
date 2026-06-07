import { describe, test, expect } from "bun:test";
import { encrypt, decrypt } from "./crypto";

describe("crypto", () => {
  describe("encrypt/decrypt round-trip", () => {
    test("encrypts and decrypts a simple string", () => {
      const plaintext = "hello world";
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    test("encrypts and decrypts an empty string", () => {
      const encrypted = encrypt("");
      expect(decrypt(encrypted)).toBe("");
    });

    test("encrypts and decrypts special characters", () => {
      const plaintext = "p@$$w0rd!#%^&*()_+{}|:<>?";
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    test("encrypts and decrypts unicode text", () => {
      const plaintext = "Hello 世界 🌍 مرحبا";
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    test("encrypts and decrypts a long string", () => {
      const plaintext = "a".repeat(10000);
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    test("encrypts and decrypts JSON data", () => {
      const data = JSON.stringify({ token: "ghp_abc123", user: "test" });
      const encrypted = encrypt(data);
      expect(decrypt(encrypted)).toBe(data);
    });
  });

  describe("encrypt output format (authenticated v2)", () => {
    test("returns version:iv:tag:ciphertext", () => {
      const encrypted = encrypt("test");
      const parts = encrypted.split(":");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v2");
    });

    test("IV is 24 hex chars (12-byte GCM nonce)", () => {
      const encrypted = encrypt("test");
      const iv = encrypted.split(":")[1];
      expect(iv).toHaveLength(24);
      expect(iv).toMatch(/^[0-9a-f]+$/);
    });

    test("auth tag is 32 hex chars (16 bytes)", () => {
      const encrypted = encrypt("test");
      const tag = encrypted.split(":")[2];
      expect(tag).toHaveLength(32);
      expect(tag).toMatch(/^[0-9a-f]+$/);
    });

    test("produces different ciphertext for same input (random IV)", () => {
      const a = encrypt("same-input");
      const b = encrypt("same-input");
      expect(a).not.toBe(b);
    });
  });

  describe("decrypt error handling", () => {
    test("throws on invalid ciphertext", () => {
      expect(() => decrypt("invalid")).toThrow();
    });

    test("rejects non-string / empty input instead of crashing on internals", () => {
      expect(() => decrypt("")).toThrow();
      expect(() => decrypt(undefined as any)).toThrow();
    });

    test("tampered ciphertext fails authentication (does not return plaintext)", () => {
      const plaintext = "test";
      const encrypted = encrypt(plaintext);
      const [v, iv, tag, cipher] = encrypted.split(":");
      // Flip the first ciphertext byte to a GUARANTEED-different value (avoid the
      // 1/256 case where forcing "ff" reproduces the original byte). GCM auth tag
      // verification must then reject it.
      const flipped = cipher.slice(0, 2) === "ff" ? "00" : "ff";
      const tampered = [v, iv, tag, flipped + cipher.slice(2)].join(":");
      let result: string | null = null;
      try {
        result = decrypt(tampered);
      } catch {
        return; // expected: authentication failure throws
      }
      expect(result).not.toBe(plaintext);
    });
  });
});
