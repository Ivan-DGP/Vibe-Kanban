// Wire types for the cross-project Specialist chat.
//
// The Specialist grounds each answer in cross-project knowledge + memory search,
// then streams the reply. Before the answer deltas, the server emits one SSE
// `sources` frame carrying the grounded citations so the UI can render them.

/** A grounded citation attached to a Specialist answer. */
export interface SpecialistSource {
  /** Entity id (artifact/task/graph-node id) or memory event id. */
  id: string;
  /** "artifact" | "task" | "graph_node" | "memory". */
  kind: string;
  /** Display label (filename / task title / node label / memory title). */
  label: string;
  /** Source project name (always cross-project here). */
  project?: string;
  /** Best-matching snippet, for memory hits. */
  snippet?: string;
}
