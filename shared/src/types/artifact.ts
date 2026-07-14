// ============================================================
// Project Artifacts (Knowledge Base)
// ============================================================

import type { GraphNodeType } from "./graph";
import type { TaskStatus, TaskPriority } from "./task";

/**
 * A knowledge-base artifact that grounded an AI run — i.e. was selected by
 * the O2 knowledge-injection helper and injected into the run's prompt.
 * Surfaced so a human can audit what knowledge shaped a run (O6).
 */
export interface GroundedArtifact {
  id: string;
  title: string;
}

export type ArtifactType = "document" | "diagram" | "image" | "research" | "spec" | "other";

export interface Artifact {
  id: string;
  projectId: string;
  filename: string;
  type: ArtifactType;
  description: string | null;
  tags: string[];
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateArtifactInput {
  filename: string;
  type?: ArtifactType;
  // Nullable to match the DB column, UpdateArtifactInput, and callers that pass
  // an explicit null when no description is supplied.
  description?: string | null;
  tags?: string[];
  content?: string; // for text-based artifacts (markdown, etc.)
}

export interface UpdateArtifactInput {
  filename?: string;
  type?: ArtifactType;
  description?: string | null;
  tags?: string[];
  content?: string;
}

// ============================================================
// Knowledge Search (Vector Embeddings)
// ============================================================

export interface KnowledgeArtifactHit {
  kind: "artifact";
  id: string;
  entityId: string;
  chunkIdx: number;
  content: string;
  score: number;
  artifact: {
    id: string;
    filename: string;
    type: ArtifactType;
    description: string | null;
    tags: string[];
    mimeType: string;
    updatedAt: string;
  };
}

export interface KnowledgeTaskHit {
  kind: "task";
  id: string;
  entityId: string;
  chunkIdx: number;
  content: string;
  score: number;
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    taskNumber: number;
    milestoneId: string | null;
    updatedAt: string;
  };
}

export interface KnowledgeGraphNodeHit {
  kind: "graph_node";
  id: string;
  entityId: string;
  chunkIdx: number;
  content: string;
  score: number;
  graphNode: {
    id: string;
    label: string;
    type: GraphNodeType;
    description: string | null;
    updatedAt: string;
  };
}

export type KnowledgeSearchHit = KnowledgeArtifactHit | KnowledgeTaskHit | KnowledgeGraphNodeHit;

export interface KnowledgeSearchResponse {
  query: string;
  model: string;
  results: KnowledgeSearchHit[];
  totalChunks: number;
}

export interface KnowledgeStats {
  model: string;
  artifactCount: number;
  embeddedArtifacts: number;
  chunkCount: number;
  pending: number;
  taskCount: number;
  embeddedTasks: number;
  taskChunkCount: number;
  pendingTasks: number;
  graphNodeCount: number;
  embeddedGraphNodes: number;
  graphNodeChunkCount: number;
  pendingGraphNodes: number;
}
