import { createHash } from "node:crypto";
import { getDb } from "../db";
import { embed, vectorToBlob, EMBEDDING_MODEL, EMBEDDING_DIM } from "./embeddings";
import { chunkText } from "../lib/chunking";
import { log } from "../lib/logger";

export interface EmbedGraphNodeInput {
  projectId: string;
  nodeId: string;
  label: string;
  type?: string | null;
  description?: string | null;
}

export function composeGraphNodeText(input: EmbedGraphNodeInput): string {
  const parts: string[] = [];
  parts.push(`# ${input.label.trim()}`);
  if (input.type) parts.push(`Type: ${input.type}`);
  if (input.description?.trim()) parts.push(input.description.trim());
  return parts.join("\n\n");
}

function hashSource(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function embedGraphNode(input: EmbedGraphNodeInput): Promise<number> {
  const text = composeGraphNodeText(input);
  const sourceHash = hashSource(text);

  const db = getDb();

  const existing = db
    .prepare("SELECT sourceHash FROM graph_node_embeddings WHERE nodeId = ? LIMIT 1")
    .get(input.nodeId) as { sourceHash: string } | undefined;
  if (existing && existing.sourceHash === sourceHash) {
    return 0;
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    clearGraphNodeEmbeddings(input.nodeId);
    return 0;
  }

  const insert = db.prepare(
    `INSERT INTO graph_node_embeddings (id, nodeId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const vectors: { idx: number; chunk: string; vector: Buffer }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const v = await embed(chunks[i]);
    vectors.push({ idx: i, chunk: chunks[i], vector: vectorToBlob(v) });
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM graph_node_embeddings WHERE nodeId = ?").run(input.nodeId);
    for (const v of vectors) {
      insert.run(
        crypto.randomUUID(),
        input.nodeId,
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

export function clearGraphNodeEmbeddings(nodeId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM graph_node_embeddings WHERE nodeId = ?").run(nodeId);
}

export function embedGraphNodeInBackground(input: EmbedGraphNodeInput): void {
  embedGraphNode(input).catch((err) => {
    log("error", "server", `Failed to embed graph node ${input.nodeId}: ${err?.message ?? err}`);
  });
}
