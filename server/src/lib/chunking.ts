const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 500;
const MIN_CHUNK_CHARS = 40;

export interface ChunkOptions {
  maxTokens?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = (opts.maxTokens ?? DEFAULT_MAX_TOKENS) * APPROX_CHARS_PER_TOKEN;
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t.length >= MIN_CHUNK_CHARS) chunks.push(t);
    buf = "";
  };

  for (const p of paragraphs) {
    if (p.length > maxChars) {
      flush();
      for (let i = 0; i < p.length; i += maxChars) {
        const slice = p.slice(i, i + maxChars).trim();
        if (slice.length >= MIN_CHUNK_CHARS) chunks.push(slice);
      }
      continue;
    }
    if ((buf + "\n\n" + p).length > maxChars) {
      flush();
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  flush();

  if (chunks.length === 0 && trimmed.length > 0) chunks.push(trimmed.slice(0, maxChars));
  return chunks;
}

export function isEmbeddableMimeType(mimeType: string): boolean {
  if (!mimeType) return false;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json") return true;
  if (mimeType === "application/xml") return true;
  return false;
}
