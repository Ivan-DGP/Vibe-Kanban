import { describe, test, expect } from "bun:test";
import { EventBus } from "../src/eventBus";

interface Events {
  ping: number;
  data: { value: string };
}

describe("EventBus on/emit/off (regression)", () => {
  test("on/emit dispatches payload", () => {
    const bus = new EventBus<Events>();
    let captured = 0;
    bus.on("ping", (n) => {
      captured = n;
    });
    bus.emit("ping", 42);
    expect(captured).toBe(42);
  });

  test("multiple listeners all fire", () => {
    const bus = new EventBus<Events>();
    let a = 0;
    let b = 0;
    bus.on("ping", () => {
      a++;
    });
    bus.on("ping", () => {
      b++;
    });
    bus.emit("ping", 1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  test("off removes a specific listener", () => {
    const bus = new EventBus<Events>();
    let calls = 0;
    const fn = () => {
      calls++;
    };
    bus.on("ping", fn);
    bus.emit("ping", 1);
    bus.off("ping", fn);
    bus.emit("ping", 2);
    expect(calls).toBe(1);
  });

  test("on returns a disposer that detaches", () => {
    const bus = new EventBus<Events>();
    let calls = 0;
    const dispose = bus.on("ping", () => {
      calls++;
    });
    bus.emit("ping", 1);
    dispose();
    bus.emit("ping", 2);
    expect(calls).toBe(1);
  });

  test("emit on event with no listeners is a no-op", () => {
    const bus = new EventBus<Events>();
    expect(() => bus.emit("ping", 1)).not.toThrow();
  });

  test("typed payloads flow through", () => {
    const bus = new EventBus<Events>();
    let captured: { value: string } | null = null;
    bus.on("data", (p) => {
      captured = p;
    });
    bus.emit("data", { value: "hello" });
    expect(captured).toEqual({ value: "hello" });
  });

  test("listenerCount tracks adds and removes", () => {
    const bus = new EventBus<Events>();
    expect(bus.listenerCount("ping")).toBe(0);
    const dispose = bus.on("ping", () => {});
    bus.on("ping", () => {});
    expect(bus.listenerCount("ping")).toBe(2);
    dispose();
    expect(bus.listenerCount("ping")).toBe(1);
  });
});
