export interface TopoNode {
  id: string;
  deps: string[];
}

export class CycleError extends Error {
  readonly cycle: string[];
  constructor(cycle: string[]) {
    super(`cycle detected: ${cycle.join(" -> ")}`);
    this.name = "CycleError";
    this.cycle = cycle;
  }
}

export function topoSort(nodes: TopoNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const result: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (node) {
      for (const dep of node.deps) visit(dep);
    }
    result.push(id);
  };
  for (const node of nodes) visit(node.id);
  return result;
}
