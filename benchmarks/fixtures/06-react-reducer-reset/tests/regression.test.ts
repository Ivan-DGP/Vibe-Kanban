import { describe, test, expect } from "bun:test";
import { counterReducer, initialState } from "../src/counterReducer";

describe("counterReducer — INC/DEC/SET (regression)", () => {
  test("INC increments by 1", () => {
    const s = counterReducer(initialState, { type: "INC" });
    expect(s.count).toBe(1);
    expect(s.history).toEqual([1]);
  });

  test("DEC decrements by 1", () => {
    const s = counterReducer({ count: 5, history: [5] }, { type: "DEC" });
    expect(s.count).toBe(4);
  });

  test("SET overrides count and appends to history", () => {
    const s = counterReducer({ count: 1, history: [1] }, { type: "SET", value: 99 });
    expect(s.count).toBe(99);
    expect(s.history).toEqual([1, 99]);
  });

  test("INC then DEC nets to 0", () => {
    let s = counterReducer(initialState, { type: "INC" });
    s = counterReducer(s, { type: "DEC" });
    expect(s.count).toBe(0);
    expect(s.history).toEqual([1, 0]);
  });
});
