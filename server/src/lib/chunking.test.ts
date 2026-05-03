import { describe, test, expect } from "bun:test";
import { chunkText, isEmbeddableMimeType } from "./chunking";

describe("chunking", () => {
  test("returns empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  test("returns single chunk for short text", () => {
    const text = "This is a short paragraph that should fit in one chunk.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  test("splits long text on paragraph boundaries", () => {
    const para = "x".repeat(800);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkText(text, { maxTokens: 500 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeGreaterThan(0);
  });

  test("hard-splits paragraphs longer than maxChars", () => {
    const giant = "y".repeat(5000);
    const chunks = chunkText(giant, { maxTokens: 500 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500 * 4);
  });

  test("merges short paragraphs into one chunk", () => {
    const text = "Para one.\n\nPara two.\n\nPara three.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("Para one");
    expect(chunks[0]).toContain("Para three");
  });

  test("filters chunks below MIN_CHUNK_CHARS", () => {
    const chunks = chunkText("hi");
    expect(chunks.length).toBeLessThanOrEqual(1);
  });
});

describe("isEmbeddableMimeType", () => {
  test("text mime types are embeddable", () => {
    expect(isEmbeddableMimeType("text/markdown")).toBe(true);
    expect(isEmbeddableMimeType("text/plain")).toBe(true);
    expect(isEmbeddableMimeType("text/html")).toBe(true);
  });

  test("json/xml are embeddable", () => {
    expect(isEmbeddableMimeType("application/json")).toBe(true);
    expect(isEmbeddableMimeType("application/xml")).toBe(true);
  });

  test("binary mime types are not embeddable", () => {
    expect(isEmbeddableMimeType("image/png")).toBe(false);
    expect(isEmbeddableMimeType("application/pdf")).toBe(false);
    expect(isEmbeddableMimeType("application/octet-stream")).toBe(false);
  });

  test("empty/null mime type is not embeddable", () => {
    expect(isEmbeddableMimeType("")).toBe(false);
  });
});
