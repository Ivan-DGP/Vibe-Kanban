import { describe, test, expect } from "bun:test";
import { EventBus } from "../src/eventBus";

interface Events {
  ping: number;
  data: { value: string };
}

describe("EventBus once() — auto-removes after first emit (target)", () => {
  test("once handler fires exactly once across multiple emits", () => {
    const bus = new EventBus<Events>();
    let calls = 0;
    bus.once("ping", () => { calls++; });
    bus.emit("ping", 1);
    bus.emit("ping", 2);
    bus.emit("ping", 3);
    expect(calls).toBe(1);
  });

  test("once leaves no listeners after first emit", () => {
    const bus = new EventBus<Events>();
    bus.once("ping", () => {});
    expect(bus.listenerCount("ping")).toBe(1);
    bus.emit("ping", 0);
    expect(bus.listenerCount("ping")).toBe(0);
  });

  test("once + on coexist; on persists, once dies", () => {
    const bus = new EventBus<Events>();
    let onceCalls = 0;
    let onCalls = 0;
    bus.once("ping", () => { onceCalls++; });
    bus.on("ping", () => { onCalls++; });
    bus.emit("ping", 1);
    bus.emit("ping", 2);
    expect(onceCalls).toBe(1);
    expect(onCalls).toBe(2);
  });

  test("disposer returned by once() is callable before emit and is a no-op after", () => {
    const bus = new EventBus<Events>();
    const dispose = bus.once("ping", () => {});
    expect(bus.listenerCount("ping")).toBe(1);
    bus.emit("ping", 1);
    expect(bus.listenerCount("ping")).toBe(0);
    expect(() => dispose()).not.toThrow();
    expect(bus.listenerCount("ping")).toBe(0);
  });
});
