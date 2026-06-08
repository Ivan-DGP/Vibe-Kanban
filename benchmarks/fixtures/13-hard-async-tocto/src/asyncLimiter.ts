export interface LimiterConfig {
  capacity: number;
  refillPerSecond: number;
}

export interface LimiterState {
  tokens: number;
  lastRefillMs: number;
}

export interface LimiterDeps {
  now: () => number;
  persist: (next: LimiterState) => Promise<void>;
}

const CFG: LimiterConfig = { capacity: 10, refillPerSecond: 0 };
let state: LimiterState = { tokens: CFG.capacity, lastRefillMs: 0 };

export function reset(initialTokens: number, lastRefillMs: number): void {
  state = { tokens: initialTokens, lastRefillMs };
}

export function getState(): Readonly<LimiterState> {
  return state;
}

export function getConfig(): LimiterConfig {
  return CFG;
}

export async function tryConsume(deps: LimiterDeps, cost: number): Promise<boolean> {
  const now = deps.now();
  const elapsedMs = now - state.lastRefillMs;
  const refilled = Math.min(CFG.capacity, state.tokens + (elapsedMs / 1000) * CFG.refillPerSecond);
  if (refilled < cost) {
    const next: LimiterState = { tokens: refilled, lastRefillMs: now };
    await deps.persist(next);
    state = next;
    return false;
  }
  const next: LimiterState = { tokens: refilled - cost, lastRefillMs: now };
  await deps.persist(next);
  state = next;
  return true;
}
