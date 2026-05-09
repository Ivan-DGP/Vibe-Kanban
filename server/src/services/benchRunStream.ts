export type SseStatusPayload = {
  status: "running" | "done" | "error";
  exitCode: number | null;
};

export type SseEvent = { event: "log"; data: string } | { event: "status"; data: SseStatusPayload };

export type Subscriber = (evt: SseEvent) => void;

export interface RunStreamState {
  lines: string[];
  partial: { stdout: string; stderr: string };
  subscribers: Set<Subscriber>;
  finished: boolean;
}

export const MAX_LINES = 5000;

export function createRunStream(): RunStreamState {
  return {
    lines: [],
    partial: { stdout: "", stderr: "" },
    subscribers: new Set(),
    finished: false,
  };
}

export function emitLine(state: RunStreamState, line: string): void {
  state.lines.push(line);
  if (state.lines.length > MAX_LINES) state.lines.splice(0, state.lines.length - MAX_LINES);
  for (const sub of state.subscribers) {
    try {
      sub({ event: "log", data: line });
    } catch {
      /* subscriber transport may be torn down — ignore */
    }
  }
}

export function ingestChunk(
  state: RunStreamState,
  stream: "stdout" | "stderr",
  chunk: string,
): void {
  const buf = state.partial[stream] + chunk;
  const parts = buf.split("\n");
  state.partial[stream] = parts.pop() ?? "";
  for (const line of parts) emitLine(state, line);
}

export function flushPartials(state: RunStreamState): void {
  for (const k of ["stdout", "stderr"] as const) {
    if (state.partial[k].length > 0) {
      emitLine(state, state.partial[k]);
      state.partial[k] = "";
    }
  }
}

export function emitStatus(state: RunStreamState, payload: SseStatusPayload): void {
  state.finished = true;
  for (const sub of [...state.subscribers]) {
    try {
      sub({ event: "status", data: payload });
    } catch {
      /* ignore */
    }
  }
  state.subscribers.clear();
}
