import type { LogLevel, LogCategory } from "@vibe-kanban/shared";

export interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: unknown;
}

export type LogSink = (entry: LogEntry) => void;

// Buffer entries emitted before a sink is registered (e.g. during early boot /
// db migration) so they aren't lost. Capped to avoid unbounded growth if a sink
// is never installed.
const BUFFER_CAP = 1000;
const buffer: LogEntry[] = [];
let sink: LogSink | null = null;

// Register the destination for log entries (composition root wires this to the
// DB). Flushes anything buffered before registration.
export function setLogSink(next: LogSink): void {
  sink = next;
  if (buffer.length) {
    const pending = buffer.splice(0, buffer.length);
    for (const entry of pending) dispatch(entry);
  }
}

function dispatch(entry: LogEntry): void {
  try {
    sink!(entry);
  } catch {
    console.error(`[${entry.level}][${entry.category}] ${entry.message}`, entry.details);
  }
}

export function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  details?: unknown,
): void {
  const entry: LogEntry = { level, category, message, details };
  if (!sink) {
    if (buffer.length >= BUFFER_CAP) buffer.shift();
    buffer.push(entry);
    return;
  }
  dispatch(entry);
}
