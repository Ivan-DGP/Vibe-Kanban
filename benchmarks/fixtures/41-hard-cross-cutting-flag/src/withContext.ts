import { sink, type LogEvent } from "./log";

export interface ContextLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function withContext(prefix: string): ContextLogger {
  const push = (level: LogEvent["level"], msg: string) =>
    sink.events.push({ level, msg: `[${prefix}] ${msg}` });
  return {
    info: (msg) => push("info", msg),
    warn: (msg) => push("warn", msg),
    error: (msg) => push("error", msg),
  };
}
