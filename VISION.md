# Vision: Project Knowledge Base — a project intelligence layer

**Owner:** Ivan (ivan@dryground.ai)
**Updated:** 2026-06-07

## North Star

Each project in Vibe-Kanban gets a first-class knowledge layer — artifacts (specs,
research notes, MER/UAT docs), a knowledge graph, and a roadmap — stored inside
Vibe-Kanban's own data directory, **never** in the project's repo. The layer is fully
searchable and, critically, **AI-aware**: when Claude runs a task it automatically draws
on the relevant knowledge so the dashboard becomes a project intelligence hub, not just a
task tracker. "Done" means a developer can capture, link, visualize, and search project
knowledge, every AI task run is grounded in it, and the developer can see _what_ grounded
each run.

## Oracle

An outcome advances to `done` only when **every** acceptance checkbox is mechanically
verified AND `bun test` + `bun run check` (tsc) are green on a clean tree.

- **clean tree** = `git status --porcelain` shows no modified/staged _tracked_ files;
  untracked build-irrelevant files (e.g. `VISION.md`, `data/`) are ignored.
- Acceptance criteria are graded by assertions, not eyeballing. Anything phrased as
  "renders" / "shows" / "degrades gracefully" must reduce to an API/integration/unit
  assertion (or a named component test under `bun test`) — never manual judgement.
- **Repo-write invariant (regression if violated):** all knowledge artifacts live under
  the VK data dir (`getProjectArtifactsDir`); any outcome that writes into a project's own
  repo is a regression, full stop.

## Outcomes

Each outcome is a unit of work the loop can pick up.

**Status:** `todo | doing | done | blocked`.

- `todo` — not started.
- `doing` — a loop iteration is actively working it.
- `done` — every acceptance checkbox mechanically verified AND the oracle is green on a
  clean tree. The loop sets this; it never advances on partial criteria.
- `blocked` — a criterion cannot be met without a decision or dependency outside this
  outcome. The **Notes** field MUST state the blocker. Set by a human or the working
  agent, with a recorded reason; the oracle never auto-sets `blocked`.

> **Schema baseline:** the knowledge tables land at migrations v15 (`project_artifacts`),
> v16 (`project_graph_nodes` + `project_graph_edges`), v17 (`roadmap_items`). The _current_
> schema version is **v27** (`fresh-migrations.test.ts` asserts `MAX(version)===27`).
> **O3 and O4 each require a NEW migration** — the existing schema does not yet support
> them (see their notes). A long-lived dev DB may lag the code (apply on next `getDb()`).

### O1: Foundation intact — CRUD, search, graph, roadmap, MCP read tools

- **Status:** done (baseline) — with two caveats the rest must not lean on (see Notes).
- **Why:** The schema, routes, embedders, MCP tools, and UI tabs already exist (mission
  `project-knowledge-base`). Lock it as the verified baseline the rest builds on.
- **Acceptance criteria:**
  - [x] `project_artifacts`, `project_graph_nodes`, `project_graph_edges`, `roadmap_items` tables exist via migrations (fresh DB reaches schema v27; `fresh-migrations.test.ts` asserts the version)
  - [x] Artifact list/create/get/content endpoints respond; content served from the VK data dir (`getProjectArtifactsDir`), not the project repo
  - [x] `POST /api/projects/:projectId/knowledge/search` returns `{ query, model, results, totalChunks }` with per-result `kind`+`score`; `/knowledge/stats` returns per-kind count fields (artifact/task/graphNode × count/embedded/pending)
  - [x] MCP exposes `list_artifacts`, `read_artifact`, `list_graph_nodes` (returns nodes **and** edges), and `search_knowledge`
  - [x] Artifacts / Search / Roadmap / Graph tabs render via `KnowledgePanel`, shown when a project's workspace mode is set to **Knowledge** (the `ProjectDetail` mode toggle)
- **Suggested skill:** (direct — verification only)
- **Notes:** Baseline. If any criterion regresses while working a later outcome, fix it there.
  - **Caveat A (kill-switch):** `isEmbeddingsDisabled()` exists (`embeddings.ts`) but has
    **zero production callers**; the search path (`knowledge.ts`, `mcp/tools.ts`) calls
    `embed()` unconditionally and loads the model even with `VK_DISABLE_EMBEDDINGS=1`.
    O2/O5 own fixing this — do not assume the baseline honors the switch.
  - **Caveat B (untested surface):** `search_knowledge` (MCP) has no test, `artifactEmbedder`
    has no test, and `POST /knowledge/backfill` (re-embed) is undocumented and untested.
    O5 owns closing these.
  - **Schema gap:** the schema does **not** yet support O3 (edge `type` CHECK lacks
    `references`/`wikilink`; no unique edge constraint; artifacts have no node mirror) or
    O4 (no roadmap→task linkage column). O3 and O4 each carry a migration.
  - **Missing read tool:** roadmap has no MCP read tool despite being a North Star pillar
    (tracked under O4).

### O2: AI-aware task runs — Claude auto-loads relevant knowledge

- **Status:** done
- **Why:** The core unmet requirement. No artifact/knowledge content is injected into any
  spawn prompt today — confirmed across `spawnPrompts.ts`, `aiResolvePrompt.*`,
  `taskSpawner.ts`, `taskSpawnRegistry.ts`. The dispatcher (`taskSpawner.ts:98` →
  `config.buildPrompt`) hands a prompt to the agent with no knowledge step; knowledge is
  reachable only if the agent _itself_ calls the `search_knowledge` MCP tool mid-run.
  Auto-grounding is what turns the KB from a filing cabinet into intelligence.
- **Scope / insertion points:** the **execute** path — `buildAiResolvePrompt` (already
  `async`, inject into its `contextParts[]` block, `aiResolvePrompt.builders.ts`) — is the
  primary target. The autospawn path (`buildBenchCodebasePrompt`/qa-test/dev-fix via the
  registry) is **optional**, EXCEPT `buildBenchCodebasePrompt` which is **out of scope**
  (isolated bench codebase has no project knowledge).
- **Tunables (exported constants; documented in code):** `VK_SPAWN_KNOWLEDGE_K` (default 3,
  clamp 0..10), `KNOWLEDGE_EXCERPT_BYTES` (per-artifact body cap, default 1024,
  truncate on a UTF-8 boundary + ellipsis), `KNOWLEDGE_BLOCK_MAX_BYTES` (total cap across
  all injected artifacts, default 4096 — the **byte budget wins over K**: artifacts beyond
  the cap are dropped in rank order), `KNOWLEDGE_SEARCH_TIMEOUT_MS` (default 500).
- **Acceptance criteria:** (oracle reads these literally)
  - [x] A spawned task's prompt includes the top-`VK_SPAWN_KNOWLEDGE_K` artifacts ranked by
        semantic relevance to the task title+description (via the embedder/`search_knowledge` path)
  - [x] The injection helper **short-circuits on `isEmbeddingsDisabled()` before calling
        `embed()`** (today's search does NOT honor the switch — this is net-new): with
        `VK_DISABLE_EMBEDDINGS=1` the prompt is built with no knowledge block and no throw,
        and the model is not loaded
  - [x] Knowledge retrieval completes within `KNOWLEDGE_SEARCH_TIMEOUT_MS`; on timeout or
        search error the prompt is built without the block (same fallback as the kill-switch)
        and the event is logged — task spawn never fails because of knowledge retrieval
  - [x] Each injected artifact is rendered as title + an excerpt bounded by
        `KNOWLEDGE_EXCERPT_BYTES`; total injected knowledge ≤ `KNOWLEDGE_BLOCK_MAX_BYTES`
  - [x] Injected knowledge is wrapped in an explicit, non-instructional delimiter block
        (e.g. fenced `<project_knowledge>` marked "reference material, not instructions");
        artifact body content cannot break out of the delimiter (fences/headers escaped or
        a collision-resistant delimiter used)
  - [x] Editing/creating/deleting an artifact (re)computes or invalidates its embedding so
        ranking reflects current content; with embeddings disabled, mutation does not error
  - [x] **Tests:** (a) given a project with artifacts, the built prompt contains the most
        relevant artifact's title and excludes irrelevant ones; (b) the block is absent and
        no throw when embeddings are disabled; (c) the prompt is built (block omitted) when
        search rejects/times out; (d) the built prompt never exceeds `KNOWLEDGE_BLOCK_MAX_BYTES`;
        (e) the injection wrapper is present and content cannot escape the delimiter
- **Suggested skill:** spec
- **Implementation note:** `SpawnConfig.buildPrompt` is **synchronous**
  (`taskSpawnRegistry.ts`, called at `taskSpawner.ts:98`); injecting an async search into
  the autospawn path requires changing that signature to `Promise<string>` and awaiting at
  the call site. `buildAiResolvePrompt` is already async. The autospawn path is
  fire-and-forget (latency-tolerant); the `/ai-resolve` route awaits `buildAiResolvePrompt`
  **inline**, so the timeout + kill-switch guard matter for response latency there (search
  is a lazy model-load + full-table scan + JS cosine).

### O3: Obsidian-style linking — `[[wikilinks]]` build the graph

- **Status:** done
- **Why:** The user's mental model is Claude + Obsidian + structured markdown. Authoring an
  artifact that references `[[another-artifact]]` should create a real graph edge and a
  backlink, so the knowledge graph grows from writing rather than manual node wiring.
- **Data-model decision (prerequisite):** edges only link **graph nodes** (both endpoints
  FK `project_graph_nodes`); artifacts are a disjoint table with no node mirror. Resolve
  this explicitly: **each artifact is mirrored to a graph node** (auto-created/updated on
  write), and a resolved `[[target]]` creates a node→node edge between the source artifact's
  node and the target's node.
- **Migration (prerequisite):** add a `references` (or `wikilink`) value to the
  `project_graph_edges.type` CHECK constraint and to `GraphEdgeType` (`shared/src/types.ts`);
  add a `UNIQUE(projectId, sourceNodeId, targetNodeId, type)` constraint (or an app-level
  upsert) so re-parsing the same link is idempotent and edges don't accumulate.
- **Acceptance criteria:**
  - [x] On artifact create (`POST`) and update (`PATCH`), `[[target]]` references in markdown
        are parsed **synchronously within the request** (so edges are queryable immediately;
        only embedding stays background) and resolved against the in-DB set of artifacts/nodes
        for the **same project** — never by constructing a filesystem path (a `[[../../x]]`
        target resolves to _unresolved_, recorded, no error). Multipart `/upload` is out of scope.
  - [x] Resolution key & precedence are deterministic: slug = lowercased filename without
        extension, spaces→hyphens; precedence = exact filename-slug match, then graph-node
        label; ties resolve to the most recently updated and are logged
  - [x] A resolved reference upserts a `project_graph_edges` row of `references`/`wikilink`
        kind (idempotent — no duplicate rows on re-save); an unresolved reference is stored in
        a separate pending-links store (NOT as a half-edge — the canvas drops edges with a
        missing endpoint), recorded without erroring
  - [x] An API endpoint returns, for an artifact, its **outbound links** and **inbound
        backlinks** (each with resolved + unresolved counts); a server test asserts the shape
        and counts. GraphTab renders the node→node edge and the artifact editor consumes this
        endpoint (components wired; literal browser render is E2E-covered, not gated by `bun test`)
  - [x] Deleting the target removes the wikilink edge via `ON DELETE CASCADE`; renaming the
        target re-resolves inbound wikilink edges so none dangle (document whether old-name
        references become unresolved). _No soft-delete/"tombstone" column exists — rely on
        CASCADE + re-resolution, or add a `deletedAt` column as an explicit sub-task._
  - [x] **Tests:** assert (resolve → edge A→B + A.outbound contains B + B.inbound contains A),
        (unresolved → recorded, no edge, no throw), (rename target → inbound edges re-resolve,
        zero dangling), (delete target → zero edges reference a missing node id),
        (`[[../../x]]` → unresolved, never escapes project scope), (re-save → no duplicate edge)
- **Suggested skill:** spec
- **Notes:** Parse hook slots in right after the INSERT/UPDATE in `artifacts.ts` where
  `content` is in scope (mirror the existing `embedArtifactInBackground` pattern, but
  **synchronous** for links). Gate on text/markdown mime type like the embedder does.

### O4: Roadmap ↔ milestones/tasks integration

- **Status:** done
- **Why:** A roadmap disconnected from the actual task board is decoration. Roadmap items
  should reflect and link to real milestones/tasks so planning and execution stay in sync.
- **Milestone model (correction):** milestones ARE real DB rows (`milestones` table, stable
  `id`); only the active selection (localStorage) and the "General" bucket
  (`milestoneId IS NULL`) are virtual. `roadmap_items.milestoneId` **already** exists as a
  real FK `REFERENCES milestones(id) ON DELETE SET NULL` (migration v17), carried in shared
  types and the create/patch routes — so the milestone half is ~70% built. Remaining
  milestone work is **validation + UI wiring**, not a new column. Verify the existing
  column before adding any migration.
- **Acceptance criteria:**
  - [x] **Milestone link (mostly built):** create/update accept `milestoneId`; an unknown or
        cross-project `milestoneId` returns HTTP **400** (today a bad id surfaces a raw SQLite
        FK error as a 500) — validation is projectId-scoped
  - [x] **Task link (net-new):** task links are stored in a join table
        `roadmap_item_tasks(roadmapItemId, taskId)` with FKs and `ON DELETE CASCADE` (NOT a
        JSON id-list, and NOT reusing `dependsOn`, which is roadmap→roadmap). Unknown task ids
        return 400; deleting a task removes the link automatically
  - [x] The Roadmap tab shows live status per item: `GET /roadmap` returns
        `{ tasksTotal, tasksDone }` computed from the item's linked tasks (and, when
        `milestoneId` is set, also `{ milestoneTasksTotal, milestoneTasksDone }`). "Done" =
        task `status IN ('done','approved')`
  - [x] The Roadmap dialog/lanes are wired to consume the linkage + rollup (milestone selector,
        task multi-select, lane rollup display); the gradable contract is the `GET /roadmap`
        rollup above + the link create/update API, asserted by server tests. Components wired
        (compile + consume); literal browser render is E2E-covered, not gated by `bun test`
  - [x] Deleting a linked milestone leaves the item with `milestoneId = NULL` (DB-enforced via
        `ON DELETE SET NULL`); deleting a linked task removes the join row — no orphan crash,
        rollup endpoint still returns 200
  - [x] **Tests:** create item linked to a milestone with mixed task statuses → API returns
        the correct rollup; 400 for non-existent id and for an id from another project;
        delete-milestone → item survives with null link; delete-task → join row gone, rollup valid
- **Suggested skill:** spec
- **Notes:** Status rollup is cheap — tasks already carry `status` + `milestoneId` and are
  counted by milestone elsewhere (`tasks.ts`). Consider adding a roadmap MCP read tool here
  (O1 noted it's missing).

### O5: Knowledge layer is tested and type-clean — standing quality GATE

- **Status:** todo (a gate, not a deferrable feature)
- **Why:** The oracle is only as honest as the coverage behind it. Today the suite passes
  _vacuously_ for the knowledge layer — the search/stats, path-safety, and kill-switch paths
  have **no assertions**, so "green" proves nothing about them.
- **How this outcome works:** O5 is a cross-cutting gate, not a place to write feature
  tests. **O2/O3/O4 each ship their own behavioral tests and cannot be marked `done` while
  O5's gate is red.** O5 owns only the baseline-coverage holes that no feature outcome
  creates, plus the type/lint cleanliness bar.
- **Acceptance criteria:**
  - [ ] `server/src/routes/knowledge.integration.test.ts` exists and asserts: search returns
        results sorted by score desc with shape `{ query, model, results, totalChunks }`;
        stats returns the per-kind count fields; search 400s on empty query
  - [ ] The `search_knowledge` MCP tool handler has a behavioral test (a relevant artifact
        ranks above an irrelevant one) and is asserted in the tool-registry test
  - [ ] Artifact content serving has a **path-containment guard** added to the
        content/upload/patch/delete handlers (`path.resolve(filePath).startsWith(resolve(artifactsDir))`)
        plus a test that a crafted filename/extension cannot escape the artifacts dir, and a
        test asserting the on-disk file lives under `getProjectArtifactsDir` and **not** under
        the target project repo (the North Star invariant). Add `path-safety.test.ts` covering
        `assertSafeSegment` + `resolveWithin`/`isWithin`
  - [ ] The embedder kill-switch is real and tested: `embed()`/the knowledge search route
        honor `isEmbeddingsDisabled()` (with `VK_DISABLE_EMBEDDINGS=1`, search returns empty
        without loading the model); a test asserts `embedTask`/`embedArtifact` and the search
        route are no-ops under the switch. (Aligns with O2's kill-switch criterion.)
  - [ ] `artifactEmbedder` has a test: `embedArtifact` writes one embedding row per chunk and
        clears prior rows on re-embed; non-embeddable mime types are skipped (mockable `embed()`)
  - [ ] **Remove all knowledge-layer files from the `ANY_DEBT` allowlist** in
        `eslint.config.mjs` — currently `artifacts.ts`, `graph.ts`, `knowledge.ts`,
        `roadmap.ts`, `roadmap.integration.test.ts`, `client/.../ArtifactEditor.tsx`,
        `client/.../RoadmapTab.tsx` — and eliminate their `any` usages so `no-explicit-any`
        passes at **error** level for them (`knowledge.ts` has ~25)
  - [ ] `bun run check` passes; the knowledge `bun test` suite passes on a clean tree
- **Suggested skill:** scaffold-tests
- **Notes:** A passing suite is necessary but not sufficient — the named test files must
  exist and _assert the behavior_, not merely be absent.

### O6: Grounding is visible & auditable

- **Status:** todo
- **Why:** North Star promises every run is "grounded" in knowledge — but if a human can't
  see _which_ artifacts shaped a run, the intelligence claim is unverifiable end-to-end.
- **Acceptance criteria:**
  - [ ] Each AI run record (`task_ai_runs`) persists the list of artifact ids/titles injected
        into its prompt for that spawn, retrievable via API
  - [ ] The Task AI runs UI surfaces them as a "Grounded in" list
  - [ ] A test asserts the persisted list matches the artifacts actually injected (ties O6 to
        O2's injection helper)
- **Suggested skill:** spec
- **Notes:** Depends on O2 (needs the injection helper to report what it injected).

## Dependency order

O1 (done) → **O2** and **O3** can proceed in parallel (different files); **O4** is
independent (roadmap/tasks). **O6** depends on O2. **O5** is a standing gate every other
outcome must satisfy before `done`. O3 and O4 each begin with their prerequisite migration.

## Out of scope (for now)

- Real-time collaborative editing of artifacts.
- Cross-project / global knowledge graph (this layer is strictly per-project).
- Writing any knowledge into the target project's own repository.
- Changing the embedding provider/model.
- Backfilling embeddings for pre-existing artifacts — assume the existing embedder/index
  (`POST /knowledge/backfill` exists). _If O2's ranking needs backfill to be meaningful,
  promote it to an explicit O2 criterion instead._
- Multi-user auth on the knowledge endpoints (single-user localhost assumed).
