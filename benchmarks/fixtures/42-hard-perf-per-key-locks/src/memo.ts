type Loader<V> = () => Promise<V>;

export interface MemoOpts {
  ttlMs?: number;
}

export interface Memo<V> {
  get(key: string, loader: Loader<V>): Promise<V>;
  clear(): void;
  size(): number;
}

export function createMemo<V>(opts: MemoOpts = {}): Memo<V> {
  const cache = new Map<string, { value: V; expiresAt: number }>();
  let inFlight: Promise<V> | null = null;

  return {
    async get(key: string, loader: Loader<V>): Promise<V> {
      const now = Date.now();
      const entry = cache.get(key);
      if (entry && entry.expiresAt > now) return entry.value;

      if (inFlight) {
        await inFlight.catch(() => {
          /* swallow — we'll start our own attempt */
        });
        const refreshed = cache.get(key);
        if (refreshed && refreshed.expiresAt > Date.now()) return refreshed.value;
      }

      const p = loader();
      inFlight = p;
      try {
        const value = await p;
        cache.set(key, {
          value,
          expiresAt: opts.ttlMs ? Date.now() + opts.ttlMs : Number.POSITIVE_INFINITY,
        });
        return value;
      } finally {
        if (inFlight === p) inFlight = null;
      }
    },

    clear(): void {
      cache.clear();
    },

    size(): number {
      return cache.size;
    },
  };
}
