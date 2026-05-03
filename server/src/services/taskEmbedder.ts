import { createHash } from "node:crypto";
import { getDb } from "../db";
import { embed, vectorToBlob, EMBEDDING_MODEL, EMBEDDING_DIM } from "./embeddings";
import { chunkText } from "../lib/chunking";
import { log } from "../lib/logger";

export interface EmbedTaskInput {
  projectId: string;
  taskId: string;
  title: string;
  description?: string | null;
  prompt?: string | null;
  status?: string | null;
}

export function composeTaskText(input: EmbedTaskInput): string {
  const parts: string[] = [];
  parts.push(`# ${input.title.trim()}`);
  if (input.status) parts.push(`Status: ${input.status}`);
  if (input.description?.trim()) parts.push(input.description.trim());
  if (input.prompt?.trim()) parts.push(`Prompt:\n${input.prompt.trim()}`);
  return parts.join("\n\n");
}

function hashSource(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function embedTask(input: EmbedTaskInput): Promise<number> {
  const text = composeTaskText(input);
  const sourceHash = hashSource(text);

  const db = getDb();

  const existing = db
    .prepare("SELECT sourceHash FROM task_embeddings WHERE taskId = ? LIMIT 1")
    .get(input.taskId) as { sourceHash: string } | undefined;
  if (existing && existing.sourceHash === sourceHash) {
    return 0;
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    clearTaskEmbeddings(input.taskId);
    return 0;
  }

  const insert = db.prepare(
    `INSERT INTO task_embeddings (id, taskId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const vectors: { idx: number; chunk: string; vector: Buffer }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const v = await embed(chunks[i]);
    vectors.push({ idx: i, chunk: chunks[i], vector: vectorToBlob(v) });
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM task_embeddings WHERE taskId = ?").run(input.taskId);
    for (const v of vectors) {
      insert.run(
        crypto.randomUUID(),
        input.taskId,
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

export function clearTaskEmbeddings(taskId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM task_embeddings WHERE taskId = ?").run(taskId);
}

export function embedTaskInBackground(input: EmbedTaskInput): void {
  embedTask(input).catch((err) => {
    log("error", "server", `Failed to embed task ${input.taskId}: ${err?.message ?? err}`);
  });
}
