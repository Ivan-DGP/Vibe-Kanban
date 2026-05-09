import { describe, test, expect } from "bun:test";
import { topoSort, CycleError, type TopoNode } from "../src/topoSort";

describe("topoSort — cycle detection (target)", () => {
  test("self-loop throws CycleError", () => {
    expect(() => topoSort([{ id: "a", deps: ["a"] }])).toThrow(CycleError);
  });

  test("two-node cycle throws CycleError", () => {
    expect(() =>
      topoSort([
        { id: "a", deps: ["b"] },
        { id: "b", deps: ["a"] },
      ]),
    ).toThrow(CycleError);
  });

  test("three-node cycle throws CycleError", () => {
    expect(() =>
      topoSort([
        { id: "a", deps: ["b"] },
        { id: "b", deps: ["c"] },
        { id: "c", deps: ["a"] },
      ]),
    ).toThrow(CycleError);
  });

  test("CycleError exposes cycle path containing all participants", () => {
    let caught: CycleError | null = null;
    try {
      topoSort([
        { id: "x", deps: ["y"] },
        { id: "y", deps: ["z"] },
        { id: "z", deps: ["x"] },
      ]);
    } catch (e) {
      if (e instanceof CycleError) caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught!.cycle.length).toBeGreaterThanOrEqual(3);
    expect(new Set(caught!.cycle).size).toBeGreaterThanOrEqual(3);
    for (const id of ["x", "y", "z"]) expect(caught!.cycle).toContain(id);
  });

  test("cycle inside a larger graph throws (does not silently complete)", () => {
    const nodes: TopoNode[] = [
      { id: "root", deps: ["a"] },
      { id: "a", deps: ["b"] },
      { id: "b", deps: ["c"] },
      { id: "c", deps: ["a"] },
      { id: "leaf", deps: [] },
    ];
    expect(() => topoSort(nodes)).toThrow(CycleError);
  });
});
