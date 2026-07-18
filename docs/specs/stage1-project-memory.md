# Spec: Project Memory — Event-Sourced Long-Term Context (Stage 1)

**Goal:** Give each project an append-only memory log of typed events (decisions, gotchas, failed attempts, conventions, fragile files) that is auto-captured from AI runs, injected into future run prompts, and browsable by humans — so Claude starts each session already knowing prior decisions and _does not repeat failed fixes_.

**Created:** 2026-07-15
**Status:** draft
**Lineage:** extends the completed `.missions/project-knowledge-base.md` (artifacts + graph + roadmap). This is Stage 1 of a 5-stage long-term-context plan (memory → close injection gap → persist dep graph → governance gate → cross-project store).

## Why (the gap this closes)

Vibe-kanban already has file-backed artifacts + embeddings, a suggest→confirm knowledge graph, top-K artifact injection, and per-run `deviations`/`summary` audit. But:

- Failed attempts and decisions captured in `task_ai_runs.deviations`/`summary` are **siloed per-run** — nothing reads them back into the next prompt, so agents re-derive context (~5–20k tokens/session, per PROJECTMEM) and can repeat fixes that already failed.
- Persistent free-form project memory today is only the overloaded `projects.aiInstructions` text column plus artifacts. There is **no dedicated, timeline-ordered, typed memory store** distinct from artifacts.

Reference: PROJECTMEM (arXiv:2606.12329) — append-only typed event log, deterministically projected into compact AI-readable summaries over MCP; "memory-as-governance" warns before repeating a failed fix.

## Non-goals (explicitly out of scope for Stage 1)

- No CLAUDE.md/AGENTS.md generation (research shows generated context files hurt; keep reading the human's file only).
- No cross-project / global memory (that's Stage 5).
- No dep-graph persistence or structural MCP tools (Stage 3).
- No pre-spawn governance gate (Stage 4) — Stage 1 only _stores and injects_; it does not yet _block_ actions.

## Data model

### Migration 37 — `project_memory` (append-only)

| column         | type         | notes                                                                        |
| -------------- | ------------ | ---------------------------------------------------------------------------- |
| `id`           | text PK      | uuid                                                                         |
| `projectId`    | text FK      | `ON DELETE CASCADE`                                                          |
| `type`         | text         | `decision` \| `gotcha` \| `attempt_failed` \| `convention` \| `fragile_file` |
| `title`        | text         | short, human-scannable                                                       |
| `body`         | text         | detail / rationale                                                           |
| `files`        | text (JSON)  | affected repo-relative paths, may be `[]`                                    |
| `taskId`       | text FK null | provenance `ON DELETE SET NULL`                                              |
| `runId`        | text FK null | provenance into `task_ai_runs`                                               |
| `origin`       | text         | `human` \| `ai_captured` (mirror graph-node convention from migration 33)    |
| `supersededBy` | text null    | id of a later event that replaces this one (append-only; never hard-update)  |
| `createdAt`    | text         | ISO                                                                          |

Index: `(projectId, createdAt)` for timeline; `(projectId, type)` for filtering.

### Migration 38 — `memory_embeddings`

Mirror `artifact_embeddings` / `task_embeddings` (migrations 21/22): `memoryId` FK, vector blob, model tag. Reuse the existing embed + cosine-rank path — no new retrieval machinery.

### Shared types — `shared/src/types/` (new `memory.ts` domain, per the split-types convention)

`ProjectMemoryEvent`, `MemoryType` union, `CreateMemoryInput`, `MemoryQuery`.

## Phases

### Phase 1 — Schema + shared types

- **Files:** `server/src/db/index.ts` (migrations 37, 38), `shared/src/types/memory.ts` (new), `shared/src/types.ts` (re-export).
- **Work:** add both tables + indexes; add shared interfaces; verify on fresh DB (38 total migrations) and that existing DB upgrades cleanly.
- **Acceptance:** `bun run check` passes; fresh-DB init creates both tables; existing `data/vibe-kanban.db` migrates 36→38 without loss.

### Phase 2 — Memory service + REST API

- **Files:** `server/src/services/projectMemory.ts` (new), `server/src/routes/memory.ts` (new), `server/src/app.ts` (register).
- **Work:**
  - `appendMemory(input)` — insert row, enqueue embedding (reuse knowledge backfill/embed helper used by artifacts).
  - `supersede(id, newEventId)` — set `supersededBy`, never delete.
  - `listMemory(projectId, {type?, includeSuperseded?, limit})`, `getMemory(id)`.
  - Routes: `GET /api/projects/:projectId/memory`, `POST .../memory`, `POST .../memory/:id/supersede`.
- **Acceptance:** unit tests (append/list/supersede, embedding enqueued); `app.inject` route tests for the three endpoints.

### Phase 3 — Auto-capture from AI runs

- **Files:** `server/src/services/terminalService.ts` (run-completion path ~`:658-684`), `server/src/services/taskSpawner.ts`, reuse `record_run_deviations` (`server/src/mcp/tools.ts:711`).
- **Work:** on run completion, project `deviations` → `attempt_failed`/`gotcha` events and material `summary` decisions → `decision` events, `origin: ai_captured`, with `taskId`/`runId` provenance. De-dupe against recent identical events (avoid log spam on retries).
- **Acceptance:** a completed run with deviations produces `project_memory` rows linked to that `runId`; a re-run with identical deviations does not duplicate.

### Phase 4 — Inject into resolve prompt

- **Files:** `server/src/services/knowledgeInjection.ts` (extend `buildKnowledgeContext`), `server/src/services/aiResolvePrompt.builders.ts` (new `<project_memory>` block beside `<project_knowledge>`, ~`:377-386`).
- **Work:** embed-rank memory events by the task query (exclude superseded), render top-K into `<project_memory>` under a dedicated byte budget separate from the 4KB artifact budget; add returned events to the run's grounding audit (extend `groundedArtifacts` or add `groundedMemory` on `task_ai_runs`).
- **Acceptance:** a task whose query matches a stored decision shows that decision inside `<project_memory>` in the built prompt (assert via a builder unit test); grounding audit records it.

### Phase 5 — MCP + human UI

- **Files:** `server/src/mcp/tools.ts` (add `list_memory`, `append_memory`), `client/src/components/knowledge/` (new `MemoryPanel.tsx`), `client/src/components/knowledge/KnowledgePanel.tsx` (5th "Memory" tab), `client/src/hooks/` (new `useMemory.ts`), `client/src/lib/api/index.ts`.
- **Work:** MCP tools so spawned agents can read/append memory on demand; Memory tab = chronological, filter by type, each entry links its task/run, superseded shown struck-through/collapsed. Allow human append + promote a run-captured event to `origin: human` (curation).
- **Acceptance:** agent can `append_memory` + `list_memory` over MCP; Memory tab renders timeline, filters, and provenance links; human can add and curate entries.

## Rollout / verification

- Per-phase `bun run check` + `bun run --cwd server test`.
- End-to-end (`/verify`): register the vibe-kanban repo as a project, run a task that fails once, confirm the failed attempt is captured and then surfaced in the next task's prompt.

## Open questions

1. Auto-capture threshold — capture every deviation, or only those above a materiality bar (to avoid noise)?
2. Injection budget — fixed byte cap like artifacts (4KB), or share a combined knowledge+memory budget?
3. Should `fragile_file` events be derived automatically (e.g. files with repeated `attempt_failed`) or only human-tagged? (Auto-derivation is the seed for the Stage 4 governance gate.)
