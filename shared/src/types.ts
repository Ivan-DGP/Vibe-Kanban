// ============================================================
// @vibe-kanban/shared public type barrel
//
// This file is the package entry (see package.json `main`/`types`). All types
// live in per-domain modules under ./types/*; this barrel re-exports them so
// every name resolves exactly as before. Add new types to a domain module and
// re-export it here — do not define types in this file.
// ============================================================

export * from "./types/common";
export * from "./types/project";
export * from "./types/task";
export * from "./types/milestone";
export * from "./types/git";
export * from "./types/claude";
export * from "./types/notion";
export * from "./types/terminal";
export * from "./types/artifact";
export * from "./types/graph";
export * from "./types/memory";
export * from "./types/roadmap";
export * from "./types/api-client";
export * from "./types/bench";
export * from "./types/misc";
export * from "./types/depgraph";
export * from "./types/supervisor";
export * from "./types/specialist";
