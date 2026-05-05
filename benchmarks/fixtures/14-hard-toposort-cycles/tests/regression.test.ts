import { describe, test, expect } from "bun:test";
import { topoSort, type TopoNode } from "../src/topoSort";

function respectsDeps(order: string[], nodes: TopoNode[]): boolean {
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const n of nodes) {
    for (const d of n.deps) {
      const a = pos.get(d);
      const b = pos.get(n.id);
      if (a === undefined || b === undefined) return false;
      if (a > b) return false;
    }
  }
  return true;
}

describe("topoSort — DAG correctness (regression)", () => {
  test("empty graph", () => {
    expect(topoSort([])).toEqual([]);
  });

  test("single node, no deps", () => {
    expect(topoSort([{ id: "a", deps: [] }])).toEqual(["a"]);
  });

  test("linear chain respects order", () => {
    const nodes: TopoNode[] = [
      { id: "a", deps: ["b"] },
      { id: "b", deps: ["c"] },
      { id: "c", deps: ["d"] },
      { id: "d", deps: [] },
    ];
    const out = topoSort(nodes);
    expect(out.length).toBe(4);
    expect(respectsDeps(out, nodes)).toBe(true);
  });

  test("diamond DAG respects all edges", () => {
    const nodes: TopoNode[] = [
      { id: "a", deps: ["b", "c"] },
      { id: "b", deps: ["d"] },
      { id: "c", deps: ["d"] },
      { id: "d", deps: [] },
    ];
    const out = topoSort(nodes);
    expect(out.length).toBe(4);
    expect(respectsDeps(out, nodes)).toBe(true);
  });

  test("disconnected DAG components both appear and respect order", () => {
    const nodes: TopoNode[] = [
      { id: "a", deps: ["b"] },
      { id: "b", deps: [] },
      { id: "x", deps: ["y"] },
      { id: "y", deps: [] },
    ];
    const out = topoSort(nodes);
    expect(new Set(out)).toEqual(new Set(["a", "b", "x", "y"]));
    expect(respectsDeps(out, nodes)).toBe(true);
  });

  test("nodes appear exactly once", () => {
    const nodes: TopoNode[] = [
      { id: "a", deps: ["b", "c"] },
      { id: "b", deps: ["c"] },
      { id: "c", deps: [] },
    ];
    const out = topoSort(nodes);
    expect(out.length).toBe(3);
    expect(new Set(out).size).toBe(3);
  });
});
