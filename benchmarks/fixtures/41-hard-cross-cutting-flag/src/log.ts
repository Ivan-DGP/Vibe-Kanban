export interface LogEvent {
  level: "info" | "warn" | "error";
  msg: string;
}

export const sink: { events: LogEvent[] } = { events: [] };

export function info(msg: string): void {
  sink.events.push({ level: "info", msg });
}

export function warn(msg: string): void {
  sink.events.push({ level: "warn", msg });
}

export function error(msg: string): void {
  sink.events.push({ level: "error", msg });
}
