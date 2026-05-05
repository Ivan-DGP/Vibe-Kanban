export type Listener<T> = (payload: T) => void;

export class EventBus<E extends Record<string, unknown>> {
  private listeners = new Map<keyof E, Listener<unknown>[]>();

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(fn as Listener<unknown>);
    this.listeners.set(event, arr);
    return () => this.off(event, fn);
  }

  off<K extends keyof E>(event: K, fn: Listener<E[K]>): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(fn as Listener<unknown>);
    if (idx >= 0) arr.splice(idx, 1);
  }

  once<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    const wrapped: Listener<E[K]> = (payload) => {
      fn(payload);
    };
    return this.on(event, wrapped);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const fn of [...arr]) {
      fn(payload);
    }
  }

  listenerCount<K extends keyof E>(event: K): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}
