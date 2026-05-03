import { log } from "../lib/logger";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

type Pipeline = (text: string | string[], options?: { pooling?: string; normalize?: boolean }) => Promise<{ data: Float32Array }>;

let pipelinePromise: Promise<Pipeline> | null = null;

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
  return new Float32Array(out.data);
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const pipe = await getPipeline();
  const results: Float32Array[] = [];
  for (const t of texts) {
    const out = await pipe(t, { pooling: "mean", normalize: true });
    results.push(new Float32Array(out.data));
  }
  return results;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
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
