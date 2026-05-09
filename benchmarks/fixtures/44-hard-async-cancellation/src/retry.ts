import { sleep } from "./sleep";

export interface RetryInit {
  signal?: AbortSignal;
  retries?: number;
  backoffMs?: number;
}

export class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

export async function retryWithBackoff<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  init: RetryInit = {},
): Promise<T> {
  const retries = init.retries ?? 3;
  const backoff = init.backoffMs ?? 100;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(init.signal);
    } catch (e) {
      lastErr = e;
      if (attempt === retries) throw e;
      await sleep(backoff);
    }
  }
  throw lastErr;
}
