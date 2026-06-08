import { getDb } from "../db";
import {
  embed,
  vectorToBlob,
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  isEmbeddingsDisabled,
} from "./embeddings";
import { chunkText, isEmbeddableMimeType } from "../lib/chunking";
import { log } from "../lib/logger";

export interface EmbedArtifactInput {
  projectId: string;
  artifactId: string;
  content: string;
  mimeType: string;
}

export async function embedArtifact(input: EmbedArtifactInput): Promise<number> {
  const { projectId, artifactId, content, mimeType } = input;
  // Kill-switch: with embeddings disabled, do not load the model or write rows.
  if (isEmbeddingsDisabled()) return 0;
  if (!isEmbeddableMimeType(mimeType)) return 0;

  const chunks = chunkText(content);
  if (chunks.length === 0) {
    clearArtifactEmbeddings(artifactId);
    return 0;
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO artifact_embeddings (id, artifactId, projectId, chunkIdx, content, vector, model, dim, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const vectors: { idx: number; chunk: string; vector: Buffer }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const v = await embed(chunks[i]);
    vectors.push({ idx: i, chunk: chunks[i], vector: vectorToBlob(v) });
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM artifact_embeddings WHERE artifactId = ?").run(artifactId);
    for (const v of vectors) {
      insert.run(
        crypto.randomUUID(),
        artifactId,
        projectId,
        v.idx,
        v.chunk,
        v.vector,
        EMBEDDING_MODEL,
        EMBEDDING_DIM,
        now,
      );
    }
  });
  tx();

  return vectors.length;
}

export function clearArtifactEmbeddings(artifactId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM artifact_embeddings WHERE artifactId = ?").run(artifactId);
}

export function embedArtifactInBackground(input: EmbedArtifactInput): void {
  embedArtifact(input).catch((err) => {
    log("error", "server", `Failed to embed artifact ${input.artifactId}: ${err?.message ?? err}`);
  });
}
