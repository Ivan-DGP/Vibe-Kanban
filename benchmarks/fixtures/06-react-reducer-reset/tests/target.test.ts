import { describe, test, expect } from "bun:test";
import { counterReducer, initialState } from "../src/counterReducer";

describe("counterReducer — RESET behavior (target)", () => {
  test("RESET returns count to 0 from positive", () => {
    let s = counterReducer(initialState, { type: "INC" });
    s = counterReducer(s, { type: "INC" });
    s = counterReducer(s, { type: "INC" });
    s = counterReducer(s, { type: "RESET" });
    expect(s.count).toBe(0);
  });

  test("RESET clears history", () => {
    let s = counterReducer(initialState, { type: "SET", value: 42 });
    s = counterReducer(s, { type: "INC" });
    s = counterReducer(s, { type: "RESET" });
    expect(s.history).toEqual([]);
  });

  test("RESET from negative goes back to 0", () => {
    let s = counterReducer(initialState, { type: "DEC" });
    s = counterReducer(s, { type: "DEC" });
    s = counterReducer(s, { type: "RESET" });
    expect(s.count).toBe(0);
  });
});
