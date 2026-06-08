import { log } from "../lib/logger";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

type Pipeline = (
  text: string | string[],
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array; dims?: number[] }>;

let pipelinePromise: Promise<Pipeline> | null = null;

/** True when embeddings are disabled via kill-switch. Honored by all embedders. */
export function isEmbeddingsDisabled(): boolean {
  return process.env.VK_DISABLE_EMBEDDINGS === "1";
}

async function getPipeline(): Promise<Pipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const tx = await import("@xenova/transformers");
    tx.env.allowLocalModels = false;
    log("info", "server", `Loading embedding model: ${EMBEDDING_MODEL}`);
    const pipe = await tx.pipeline("feature-extraction", EMBEDDING_MODEL);
    log("info", "server", `Embedding model ready: ${EMBEDDING_MODEL}`);
    return pipe as unknown as Pipeline;
  })();
  return pipelinePromise;
}

export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const out = await pipe(text, { pooling: "mean", normalize: true });
  const vec = new Float32Array(out.data);
  if (vec.length !== EMBEDDING_DIM) {
    throw new Error(`Embedding dim mismatch: got ${vec.length}, expected ${EMBEDDING_DIM}`);
  }
  return vec;
}

// Real batched embedding: single pipeline call with array input. Output data is
// flattened [batch * EMBEDDING_DIM]; slice per row and validate each dim.
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const pipe = await getPipeline();
  const out = await pipe(texts, { pooling: "mean", normalize: true });
  const data = out.data;
  if (data.length !== texts.length * EMBEDDING_DIM) {
    throw new Error(
      `Batch embedding dim mismatch: got ${data.length} floats for ${texts.length} texts, expected ${texts.length * EMBEDDING_DIM}`,
    );
  }
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(data.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM));
  }
  return results;
}

let warnedDimMismatch = false;

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    // Return 0 for safety, but warn once so silent mis-scoring is visible.
    if (!warnedDimMismatch) {
      warnedDimMismatch = true;
      log("warn", "server", `cosineSimilarity dim mismatch: ${a.length} vs ${b.length}`);
    }
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function vectorFromBlob(blob: Buffer | Uint8Array): Float32Array {
  const buf = blob instanceof Buffer ? blob : Buffer.from(blob);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export async function preloadEmbeddingModel(): Promise<void> {
  await getPipeline();
}
