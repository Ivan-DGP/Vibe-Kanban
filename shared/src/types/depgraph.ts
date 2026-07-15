// Dependency graph (import/module structure) for a project, extracted natively
// on the server (no external tooling). Distinct from the knowledge GraphNode —
// these are source files + import edges, rendered read-only in the Graph tab.

export interface DepGraphNode {
  id: string; // repo-relative file path (unique)
  label: string; // file basename
  group: string; // top-level package/dir, used for colouring & clustering
  degree: number; // in + out import count (node size)
}

export interface DepGraphEdge {
  source: string; // importer node id
  target: string; // imported node id
}

export interface DepGraph {
  nodes: DepGraphNode[];
  edges: DepGraphEdge[];
  fileCount: number;
  roots: string[]; // source roots that were scanned (repo-relative)
  generatedAt: string; // ISO timestamp of extraction
}
