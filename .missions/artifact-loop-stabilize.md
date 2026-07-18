# Mission: Artifact Loop — stabilize + close gaps

**Goal:** Make VK's artifact loop production-solid (verify/commit the ~80% already written) and build the 2 genuine gaps (interview action, blindspot spawn config).
**Created:** 2026-07-08
**Status:** in_progress

## Context

The "artifact loop" operationalizes the Fable field-guide techniques inside Vibe Kanban: cheap artifacts (spec / impl-notes / prototype / quiz) authored via MCP → on-disk file under `getProjectArtifactsDir` → wikilink graph node → embeddings → auto-grounded into future AI resolve runs (`knowledgeInjection.ts`, audited via `task_ai_runs.groundedArtifacts`).

A prior/parallel actor already implemented most of it **uncommitted on `main`**, tangled with this session's interactive-terminal/tailscale work. The original field-guide analysis is ~80% stale; this mission plans against the **verified** tree. Recon confirmed: migrations are sequential 1–35 (v34 `add-claude-sessions`, v35 `add-task-ai-run-deviations`), `fresh-migrations.test` expects 35 and passes; full server suite was green (1594 pass) at last run.

**Already built (verify/harden/commit — do NOT rebuild):** `create_artifact`/`attach_artifact_to_task`/`record_run_deviations`/`list_artifacts`/`read_artifact` MCP tools (`mcp/tools.ts` + `services/artifactService.ts` + `mcp/tools.test.ts`); deviations migration + `RunDeviations` type + parse in `routes/tasks.ts`; deviations/quiz prompt injection in `services/aiResolvePrompt.builders.ts`; quiz soft-gate done→approved (`QuizDialog.tsx` + `lib/taskArtifacts.ts` + `KanbanBoard.tsx`, `metadata.quizPassed`); task↔artifact link (`tasks.metadata.artifacts:[{id,role}]`); HTML-artifact iframe preview (`ArtifactEditor.tsx`).

**Success =** loop verified working end-to-end on the running app; the loop code committed as a clean unit on a branch; interview + blindspot shipped with tests; stale model ids fixed; `/check` green.

## Working-tree file buckets (from recon)

- **Artifact loop (this mission):** `server/src/mcp/tools.ts`, `mcp/tools.test.ts`, `services/artifactService.ts` (new), `services/aiResolvePrompt.builders.ts`, `routes/tasks.ts`, `routes/artifacts.ts`, `routes/mcp.ts`, `client/.../knowledge/ArtifactEditor.tsx`, `client/.../kanban/KanbanBoard.tsx`, `client/.../tasks/QuizDialog.tsx` (new), `client/src/lib/taskArtifacts.ts` (new).
- **Terminal/tailscale (this session — already deployed):** `client/.../layout/TerminalPanel.tsx`, `terminal/IntegratedTerminal.tsx`, `terminal/TerminalTabs.tsx`, `terminal/TranscriptDialog.tsx` (new), `hooks/useTerminal.ts`, `tasks/TaskAiRuns.tsx`, `client/vite.config.ts`, `server/src/lib/origin.ts`, `lib/origin.test.ts` (new), `routes/terminal.ts`, `routes/terminalWs.ts`, `services/terminalService.ts`, `services/terminalService.test.ts`, `services/transcriptService.ts` (new).
- **Shared (touched by BOTH — need hunk-level split):** `shared/src/types.ts`, `client/src/lib/api/index.ts`, `server/src/db/index.ts`, `server/src/db/fresh-migrations.test.ts`.

## Phases

### Phase 0: Recon & inventory

- **Status:** completed
- **Dependencies:** none
- **Files:** (read-only)
- **Work items:**
  - [x] Categorize working-tree changes into artifact-loop / terminal / shared buckets
  - [x] Confirm migration numbering (1–35, no collision) and that `fresh-migrations.test` passes
  - [x] Confirm the analysis is stale (loop ~80% already implemented)
- **Notes:** Done inline during planning. Buckets recorded above. No migration collision. Server suite green at last run.

### Phase 1: Isolate onto a branch + commit cleanly

- **Status:** pending
- **Dependencies:** Phase 0
- **Files:** git only (uses buckets above)
- **Work items:**
  - [ ] Create feature branch off `main` (e.g. `feat/artifact-loop`)
  - [ ] Commit the terminal/tailscale bucket as one logical commit (it's a coherent deployed unit); use `git add -p` to take only the terminal hunks from the 4 shared files
  - [ ] Commit the artifact-loop bucket as a second logical commit; `git add -p` the artifact hunks from the shared files
  - [ ] Leave any genuinely-unrelated pre-existing edits untouched (do NOT revert)
  - [ ] `/check` green on the branch after committing
  - [ ] Write/update tests for changes in this phase (none expected — commits only; confirm suite still green)
- **Notes:**

### Phase 2: Verify the loop end-to-end + harden

- **Status:** pending
- **Dependencies:** Phase 1
- **Files:** `services/artifactService.ts`, `mcp/tools.ts`, `services/knowledgeInjection.ts`, `services/aiResolvePrompt.builders.ts`, `routes/tasks.ts`, `KanbanBoard.tsx`, `QuizDialog.tsx`
- **Work items:**
  - [ ] Drive the real flow via `/run` + `/verify`: `create_artifact` (MCP) → file under `getProjectArtifactsDir` → graph node + embedding → `list_artifacts`/`search_knowledge` returns it → auto-grounded into an AI resolve run (`groundedArtifacts` populated)
  - [ ] Verify deviations path: resolve run authors impl-notes artifact, calls `record_run_deviations`, `task_ai_runs.deviations` persists, surfaces in AI Runs UI
  - [ ] Verify quiz path: quiz artifact authored + attached (role `quiz`); done→approved opens `QuizDialog`; `metadata.quizPassed` set
  - [ ] Fix any breakage found; confirm path-safety (artifacts cannot escape the artifacts dir)
  - [ ] Write/update tests for behaviors exercised (artifactService, MCP tools, taskArtifacts helpers)
- **Notes:**

### Phase 3: Interview action (gap 1)

- **Status:** pending
- **Dependencies:** Phase 2
- **Files:** `client/.../ai/AIChatPanel.tsx` (or new `InterviewPanel`), `client/.../tasks/TaskViewerDialog.tsx`, `server/src/routes/claude.ts`, `services/artifactService.ts`, `routes/tasks.ts`
- **Work items:**
  - [ ] Task-scoped "Interview me" action that streams ONE question at a time (reuse claude SSE), architecture / volatile-decisions-first ordering
  - [ ] Persist answers into `task.prompt` and/or a `role:'spec'` artifact (feeds the loop)
  - [ ] Reimplement the interview/checkpointing pattern natively (conceptually from threat-model/triage skills — those are external, do not depend on them)
  - [ ] Write tests (route handler + any new exported helpers) + verify in browser
- **Notes:**

### Phase 4: Blindspot spawn config (gap 2)

- **Status:** pending
- **Dependencies:** Phase 2
- **Files:** `server/src/services/taskSpawner.ts`, `taskSpawnRegistry.ts`, `registerSpawnConfigs.ts`, `services/aiResolvePrompt.builders.ts`
- **Work items:**
  - [ ] New spawn config dispatched on `metadata.type` (blindspot) that runs headless and produces an `unknowns-brief` artifact
  - [ ] Attach the brief (role `reference`/`unknowns`) so it auto-grounds the subsequent resolve run
  - [ ] Trigger affordance (button/menu) to launch a blindspot pass for a task
  - [ ] Write tests + verify a blindspot run produces + grounds the brief
- **Notes:**

### Phase 5: Model-id fix + docs + final check

- **Status:** pending
- **Dependencies:** Phase 3, Phase 4
- **Files:** `server/src/routes/claude.ts`, `CLAUDE.md`/`docs/`, mission file
- **Work items:**
  - [ ] Use the `claude-api` skill to get the correct current model id; replace stale `claude-sonnet-4-20250514` at `claude.ts:212,320,421` (do NOT guess)
  - [ ] Brief docs note on the artifact loop (how to author/attach artifacts, deviations, quiz gate, interview, blindspot)
  - [ ] Final `/check` (typecheck + lint + server tests) green
  - [ ] Write/update tests for the model-id change (assert non-stale id if a test asserts model)
- **Notes:**

## Risks & Open Questions

- **Shared-file tangle:** `shared/src/types.ts`, `client/src/lib/api/index.ts`, `server/src/db/index.ts`, `fresh-migrations.test.ts` mix terminal + artifact-loop changes → Phase 1 needs hunk-level `git add -p`. If splitting is too fiddly, fall back to a single "session work" commit and note it.
- **End-to-end unverified:** the loop has never been driven live; Phase 2 may surface real bugs (embeddings disabled? claude CLI auth? graph node creation on artifact write?).
- **Verification deps:** `/verify` of grounding needs the `claude` CLI logged in + embeddings enabled; if unavailable, assert the wiring via targeted unit/integration tests instead.
- **External-skill machinery** (threat-model interview, triage checkpointing) must be reimplemented in VK — cannot call those skills from product code.
- **quizPassed is a soft gate** (UI-only). Decide in Phase 2 whether that's sufficient or if server-side enforcement is wanted (likely out of scope — keep soft unless asked).

## Completion Summary

<Filled in when mission is complete>
