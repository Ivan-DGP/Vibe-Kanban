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

  describe("encrypt output format", () => {
    test("returns colon-separated iv:ciphertext", () => {
      const encrypted = encrypt("test");
      const parts = encrypted.split(":");
      expect(parts).toHaveLength(2);
    });

    test("IV is 32 hex chars (16 bytes)", () => {
      const encrypted = encrypt("test");
      const iv = encrypted.split(":")[0];
      expect(iv).toHaveLength(32);
      expect(iv).toMatch(/^[0-9a-f]+$/);
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

    test("throws on tampered ciphertext", () => {
      const encrypted = encrypt("test");
      const [iv, cipher] = encrypted.split(":");
      const tampered = iv + ":" + "ff" + cipher.slice(2);
      expect(() => decrypt(tampered)).toThrow();
    });
  });
});
