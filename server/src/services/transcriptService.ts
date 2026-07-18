import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../lib/data-dir";
import { assertSafeSegment } from "../lib/path-safety";
import { log } from "../lib/logger";

// Persist PTY output to disk so a session's transcript survives after it exits
// (the in-memory scrollback is dropped on `sessions.delete`). One append-only
// `.log` file per terminal session id, under <dataDir>/transcripts.

export function getTranscriptDir(): string {
  const dir = path.join(getDataDir(), "transcripts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function transcriptPathFor(sessionId: string): string {
  // sessionId becomes a filename — reject `/`, `\`, `..` so it can't escape.
  assertSafeSegment(sessionId, "sessionId");
  return path.join(getTranscriptDir(), `${sessionId}.log`);
}

/** Open an append stream for a session's transcript, or null on failure. */
export function openTranscript(sessionId: string, header?: string): fs.WriteStream | null {
  try {
    const stream = fs.createWriteStream(transcriptPathFor(sessionId), { flags: "a" });
    if (header) stream.write(header);
    return stream;
  } catch (e) {
    log("warn", "terminal", `Failed to open transcript for ${sessionId}: ${e}`);
    return null;
  }
}

export function readTranscript(sessionId: string): string | null {
  try {
    const p = transcriptPathFor(sessionId);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

export function hasTranscript(sessionId: string): boolean {
  try {
    return fs.existsSync(transcriptPathFor(sessionId));
  } catch {
    return false;
  }
}
