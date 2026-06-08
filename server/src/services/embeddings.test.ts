import { describe, test, expect } from "bun:test";
import { cosineSimilarity, vectorToBlob, vectorFromBlob, EMBEDDING_DIM } from "./embeddings";

describe("cosineSimilarity", () => {
  test("identical normalized vectors return 1", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  test("orthogonal vectors return 0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  test("opposite vectors return -1", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  test("mismatched lengths return 0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("vectorToBlob / vectorFromBlob", () => {
  test("roundtrip preserves values", () => {
    const v = new Float32Array([0.1, 0.2, -0.3, 0.4, 0.5]);
    const blob = vectorToBlob(v);
    const out = vectorFromBlob(blob);
    expect(out.length).toBe(v.length);
    for (let i = 0; i < v.length; i++) {
      expect(out[i]).toBeCloseTo(v[i], 6);
    }
  });

  test("roundtrip handles full embedding dimension", () => {
    const v = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) v[i] = i / EMBEDDING_DIM - 0.5;
    const blob = vectorToBlob(v);
    const out = vectorFromBlob(blob);
    expect(out.length).toBe(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(out[i]).toBeCloseTo(v[i], 6);
    }
  });
});
