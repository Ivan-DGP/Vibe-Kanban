export interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface TokenBucketConfig {
  capacity: number;
  refillPerSecond: number;
}

export function createBucket(cfg: TokenBucketConfig, nowMs: number): TokenBucketState {
  return { tokens: cfg.capacity, lastRefillMs: nowMs };
}

export function tryConsume(
  state: TokenBucketState,
  cfg: TokenBucketConfig,
  nowMs: number,
  cost: number,
): { allowed: boolean; state: TokenBucketState } {
  const elapsedMs = nowMs - state.lastRefillMs;
  const refillAmount = (elapsedMs / 1000) * cfg.refillPerSecond;
  const tokens = state.tokens + refillAmount;
  if (tokens < cost) {
    return { allowed: false, state: { tokens, lastRefillMs: nowMs } };
  }
  return { allowed: true, state: { tokens: tokens - cost, lastRefillMs: nowMs } };
}
