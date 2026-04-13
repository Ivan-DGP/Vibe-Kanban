# Mission: Project Knowledge Base

**Goal:** Add per-project knowledge layer — artifacts, roadmap, and knowledge graph — stored inside Vibe-Kanban's own data directory, not in the project's repo.
**Created:** 2026-04-12
**Status:** completed

## Context
Vibe-Kanban tracks tasks/milestones but lacks a layer for project knowledge — architecture docs, research notes, MER diagrams, UAT checklists, roadmaps, and concept maps. Each project should get its own knowledge store (files + structured data) with three new views: an artifact file manager, a visual roadmap, and a force-directed knowledge graph. This transforms Vibe-Kanban from a task tracker into a project intelligence hub.

## Phases

### Phase 1: Foundation — Schema, Data Dir, Shared Types
- **Status:** completed
- **Dependencies:** none
- **Files:**
  - `server/src/db/index.ts` (migrations 15-17)
  - `server/src/lib/data-dir.ts` (new helper)
  - `shared/src/types.ts` (new interfaces)
- **Work items:**
  - [x] Add migration 15: `project_artifacts` table
  - [x] Add migration 16: `project_graph_nodes` + `project_graph_edges` tables
  - [x] Add migration 17: `roadmap_items` table
  - [x] Add `getProjectArtifactsDir(projectId)` to data-dir.ts
  - [x] Add shared types: Artifact, GraphNode, GraphEdge, RoadmapItem + all CRUD input types
- **Notes:** All 3 migrations tested on fresh DB — 17 total migrations, all tables created correctly. Typecheck passes.

### Phase 2: Artifacts Backend API
- **Status:** pending
- **Dependencies:** Phase 1
- **Files:**
  - `server/src/routes/artifacts.ts` (new)
  - `server/src/app.ts` (register route)
- **Work items:**
  - [ ] `GET /api/projects/:projectId/artifacts` — list artifacts (paginated, filterable by type/tags)
  - [ ] `POST /api/projects/:projectId/artifacts` — create/upload artifact (multipart for files, JSON for markdown)
  - [ ] `GET /api/projects/:projectId/artifacts/:id` — get artifact metadata
  - [ ] `GET /api/projects/:projectId/artifacts/:id/content` — serve file content (raw bytes or markdown text)
  - [ ] `PATCH /api/projects/:projectId/artifacts/:id` — update metadata or content
  - [ ] `DELETE /api/projects/:projectId/artifacts/:id` — delete artifact + file from disk
- **Notes:**

### Phase 3: Artifacts Frontend — Tab System + File Manager
- **Status:** pending
- **Dependencies:** Phase 2
- **Files:**
  - `client/src/routes/ProjectDetail.tsx` (add mode: "knowledge")
  - `client/src/components/knowledge/` (new directory)
  - `client/src/components/knowledge/KnowledgePanel.tsx` (tab container with Artifacts/Roadmap/Graph sub-tabs)
  - `client/src/components/knowledge/ArtifactsTab.tsx` (file list + actions)
  - `client/src/components/knowledge/ArtifactEditor.tsx` (markdown editor/viewer)
  - `client/src/lib/api/index.ts` (add api.artifacts namespace)
  - `client/src/hooks/useArtifacts.ts` (TanStack Query hooks)
- **Work items:**
  - [ ] Add "Knowledge" mode to ProjectDetail header toggle (alongside Tasks/Editor)
  - [ ] Build KnowledgePanel with 3 sub-tabs: Artifacts, Roadmap, Graph
  - [ ] Build ArtifactsTab — grid/list view of files, type icons, upload button, create-new dropdown (markdown, image, diagram)
  - [ ] Build ArtifactEditor — CodeMirror for markdown, image preview for images, raw viewer for other types
  - [ ] Add api.artifacts namespace + useArtifacts/useCreateArtifact/useUpdateArtifact/useDeleteArtifact hooks
- **Notes:**

### Phase 4: Roadmap Backend + Frontend
- **Status:** pending
- **Dependencies:** Phase 1, Phase 3 (needs tab container)
- **Files:**
  - `server/src/db/index.ts` (migration 17: roadmap_items table)
  - `server/src/routes/roadmap.ts` (new)
  - `server/src/app.ts` (register route)
  - `shared/src/types.ts` (roadmap types)
  - `client/src/components/knowledge/RoadmapTab.tsx` (new)
  - `client/src/lib/api/index.ts` (api.roadmap namespace)
  - `client/src/hooks/useRoadmap.ts` (new)
- **Work items:**
  - [ ] Migration 17: `roadmap_items` table (id, projectId FK, milestoneId FK nullable, title, description, status, startDate, endDate, dependsOn JSON, color, sortOrder)
  - [ ] CRUD routes: GET list, POST create, PATCH update, DELETE — under `/api/projects/:projectId/roadmap`
  - [ ] Build RoadmapTab — horizontal timeline/swimlane view with items as colored bars
  - [ ] Connect to existing milestones — roadmap items can optionally link to a milestone
  - [ ] Drag to reorder/resize items, click to edit, dependency arrows between items
- **Notes:**

### Phase 5: Knowledge Graph Backend + Frontend
- **Status:** pending
- **Dependencies:** Phase 1, Phase 3 (needs tab container)
- **Files:**
  - `server/src/routes/graph.ts` (new)
  - `server/src/app.ts` (register route)
  - `client/src/components/knowledge/GraphTab.tsx` (new)
  - `client/src/lib/api/index.ts` (api.graph namespace)
  - `client/src/hooks/useGraph.ts` (new)
  - `package.json` (add react-force-graph-2d or similar)
- **Work items:**
  - [ ] CRUD routes for nodes + edges: GET graph (nodes+edges together), POST node, PATCH node, DELETE node, POST edge, DELETE edge — under `/api/projects/:projectId/graph`
  - [ ] Build GraphTab — force-directed graph using react-force-graph-2d
  - [ ] Node types with distinct colors/shapes: concept, system, person, decision, technology, risk
  - [ ] Click node to edit, right-click for context menu (add edge, delete), drag to reposition
  - [ ] Link nodes to artifacts — clicking a node can open its linked artifact
- **Notes:**

### Phase 6: AI Context Integration
- **Status:** completed
- **Dependencies:** Phase 2 (artifacts API must exist)
- **Files:**
  - `server/src/routes/claude.ts` (modify AI context gathering)
  - `server/src/routes/tasks.ts` (modify ai-preflight/ai-resolve)
  - `server/src/routes/mcp.ts` (add knowledge tools)
- **Work items:**
  - [ ] When Claude resolves a task, include relevant artifacts as context (markdown content of project docs)
  - [ ] Add MCP tools: `list_artifacts`, `read_artifact`, `list_graph_nodes` so Claude can query project knowledge
  - [ ] In ai-preflight, surface artifact count and graph summary so the user sees what context Claude will have
- **Notes:**

## Risks & Open Questions
- **File upload size limits** — need to set reasonable max (10MB?) to prevent disk bloat
- **Image storage** — store originals or also generate thumbnails?
- **Graph layout persistence** — save node positions or let force-layout recalculate each time? (Plan: save x,y positions in DB)
- **Roadmap visualization library** — build custom with CSS/SVG or use a lib? (Plan: custom CSS grid, no heavy deps)
- **Concurrent DB writes** — if another Claude session is running, migrations could conflict. Run migration only on server start.
- **Graph performance** — force-directed graph with 500+ nodes could be slow. Add viewport culling if needed.

## Completion Summary
All 6 phases implemented and tested. 784 unit/integration tests pass (0 fail), including 44 new tests covering all knowledge base features. E2E test file written for Playwright.

### What was built:
- **3 DB migrations** (v15-17): project_artifacts, project_graph_nodes/edges, roadmap_items
- **3 new API route files**: artifacts.ts, roadmap.ts, graph.ts — full CRUD
- **3 MCP tools**: list_artifacts, read_artifact, list_graph_nodes
- **Frontend**: "Knowledge" mode in ProjectDetail with 3 sub-tabs (Artifacts, Roadmap, Graph)
- **Artifacts**: File manager with type-filtered list, CodeMirror editor, markdown preview, tag system
- **Roadmap**: Horizontal timeline with month markers, status-colored bars, create/edit dialog
- **Graph**: Canvas-based force-directed graph with node dragging, edge linking, position persistence
- **0 new dependencies** — used existing CodeMirror, built graph with native Canvas API
