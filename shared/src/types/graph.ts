// ============================================================
// Knowledge Graph
// ============================================================

export type GraphNodeType = "concept" | "system" | "person" | "decision" | "technology" | "risk";
export type GraphEdgeType =
  | "related"
  | "depends_on"
  | "implements"
  | "extends"
  | "conflicts"
  | "owned_by"
  | "wikilink";

// Graph entities are 'confirmed' (live) or 'suggested' (AI-proposed, awaiting
// human review). `origin` records provenance: 'manual', 'wikilink',
// 'brain:capture', 'brain:ingest', etc.
export type GraphStatus = "confirmed" | "suggested";

export interface GraphNode {
  id: string;
  projectId: string;
  label: string;
  type: GraphNodeType;
  description: string | null;
  x: number | null;
  y: number | null;
  metadata: Record<string, unknown>;
  status: GraphStatus;
  origin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string | null;
  type: GraphEdgeType;
  status: GraphStatus;
  origin: string | null;
  createdAt: string;
}

export interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CreateGraphNodeInput {
  label: string;
  type?: GraphNodeType;
  description?: string;
  x?: number;
  y?: number;
  metadata?: Record<string, unknown>;
  status?: GraphStatus;
  origin?: string;
}

export interface UpdateGraphNodeInput {
  label?: string;
  type?: GraphNodeType;
  description?: string | null;
  x?: number;
  y?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateGraphEdgeInput {
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  type?: GraphEdgeType;
  status?: GraphStatus;
  origin?: string;
}

// ============================================================
// Wikilinks ([[target]] references between artifacts)
// ============================================================

export interface WikilinkResolvedRef {
  rawTarget: string;
  edgeId: string;
  targetArtifactId: string;
  targetNodeId: string;
  targetFilename: string;
}

export interface WikilinkUnresolvedRef {
  rawTarget: string;
}

/** Outbound links + inbound backlinks for one artifact. */
export interface ArtifactLinksResponse {
  artifactId: string;
  nodeId: string | null;
  outbound: {
    resolved: WikilinkResolvedRef[];
    unresolved: WikilinkUnresolvedRef[];
    resolvedCount: number;
    unresolvedCount: number;
  };
  inbound: {
    backlinks: {
      edgeId: string;
      sourceArtifactId: string | null;
      sourceNodeId: string;
      sourceLabel: string;
    }[];
    backlinkCount: number;
    unresolvedCount: number;
  };
}
