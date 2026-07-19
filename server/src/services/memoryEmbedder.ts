import { createHash } from "node:crypto";
import { getDb } from "../db";
import {
  embed,
  vectorToBlob,
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  isEmbeddingsDisabled,
} from "./embeddings";
import { chunkText } from "../lib/chunking";
import { log } from "../lib/logger";
import type { MemoryType } from "@vibe-kanban/shared";

export interface EmbedMemoryInput {
  projectId: string;
  memoryId: string;
  type: MemoryType;
  title: string;
  body?: string | null;
  files?: string[];
}

/** Compose a memory event into the text that gets embedded — mirrors
 * composeTaskText: a markdown-ish `# title` header plus type, body, and any
 * affected files so semantic search has useful signal. */
export function composeMemoryText(input: EmbedMemoryInput): string {
  const parts: string[] = [];
  parts.push(`# ${input.title.trim()}`);
  parts.push(`Type: ${input.type}`);
  if (input.body?.trim()) parts.push(input.body.trim());
  if (input.files && input.files.length > 0) parts.push(`Files: ${input.files.join(", ")}`);
  return parts.join("\n\n");
}

function hashSource(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function embedMemory(input: EmbedMemoryInput): Promise<number> {
  // Kill-switch: with embeddings disabled, never load the model or write rows.
  if (isEmbeddingsDisabled()) return 0;
  const text = composeMemoryText(input);
  const sourceHash = hashSource(text);

  const db = getDb();

  const existing = db
    .prepare("SELECT sourceHash FROM memory_embeddings WHERE memoryId = ? LIMIT 1")
    .get(input.memoryId) as { sourceHash: string } | undefined;
  if (existing && existing.sourceHash === sourceHash) {
    return 0;
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    clearMemoryEmbeddings(input.memoryId);
    return 0;
  }

  const insert = db.prepare(
    `INSERT INTO memory_embeddings (id, memoryId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const vectors: { idx: number; chunk: string; vector: Buffer }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const v = await embed(chunks[i]);
    vectors.push({ idx: i, chunk: chunks[i], vector: vectorToBlob(v) });
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM memory_embeddings WHERE memoryId = ?").run(input.memoryId);
    for (const v of vectors) {
      insert.run(
        crypto.randomUUID(),
        input.memoryId,
        input.projectId,
        v.idx,
        v.chunk,
        v.vector,
        EMBEDDING_MODEL,
        EMBEDDING_DIM,
        sourceHash,
        now,
      );
    }
  })();

  return vectors.length;
}

export function clearMemoryEmbeddings(memoryId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM memory_embeddings WHERE memoryId = ?").run(memoryId);
}

export function embedMemoryInBackground(input: EmbedMemoryInput): void {
  embedMemory(input).catch((err) => {
    log("error", "server", `Failed to embed memory ${input.memoryId}: ${err?.message ?? err}`);
  });
}
