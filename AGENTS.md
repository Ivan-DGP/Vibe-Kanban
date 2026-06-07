# AGENTS.md

Where things go in this repo. Read CLAUDE.md first for tech stack, response style, and architectural patterns. This file is the "where do I put X" reference.

## Repo layout

```
client/   React SPA (Vite, port 5173 in dev)
server/   Fastify API (port 3001), bun:sqlite, MCP server
shared/   TypeScript types shared by client + server
benchmarks/  Codebase benchmark harness + fixtures
.missions/   Mission skill checkpoints
.claude/  Claude Code commands, settings, sherlock state
```

## Adding things

### A new HTTP route

1. Create `server/src/routes/<name>.ts` exporting a `FastifyPluginAsync`.
2. Register in `server/src/app.ts` next to the other `app.register(import("./routes/..."))` lines, with `prefix: "/api"`.
3. Tests next to source: `<name>.test.ts` (unit) and/or `<name>.integration.test.ts` (uses `app.inject`).

### A new MCP tool

1. Add the handler function to `server/src/mcp/tools.ts`.
2. Append a `{ definition, handler }` entry to the `tools` array (see existing tools for shape).
3. `toolMap` is auto-built from `tools` — no extra wiring.
4. Tests in `server/src/mcp/tools.test.ts`.

### A new DB migration

- **Do not** create a separate migration file. Migrations are an inline array in `server/src/db/index.ts` — append a new entry with the next `version` number. The bootstrap loop runs missing versions on startup.
- Cover the migration in `server/src/db/migrations.test.ts`.

### A new spawn config (QA-test / dev-fix style)

1. Add the prompt builder to `server/src/services/spawnPrompts.ts`.
2. Register the config in `server/src/services/registerSpawnConfigs.ts` (called from `buildApp()`).
3. Tests: `taskSpawnRegistry.test.ts`, `spawnPrompts.test.ts`, `taskSpawner.test.ts`.

### A new benchmark fixture

- Drop under `benchmarks/fixtures/<id>/`. Harness is `benchmarks/harness/run.ts`, run via `bun run bench` / `bun run bench:dry` / `bun run bench:calibrate`.
- See `benchmarks/README.md` for fixture shape.

### A new smoke test

- Add to `server/scripts/smoke/`. Run all via `bun run test:smoke`.

### A new client route

- Add lazy-loaded route component under `client/src/routes/`, wire into `client/src/App.tsx`.
- Server state via TanStack Query, UI state via Zustand stores in `client/src/stores/`.

### A new shared type

- Add to `shared/src/types.ts`, export from `shared/src/index.ts`. Import as `@vibe-kanban/shared`.

## Conventions

- **Tests next to source.** `foo.ts` and `foo.test.ts` in the same dir. Integration tests use `*.integration.test.ts`. Test runner is `bun test` with `server/test-setup.ts` preload that isolates `VK_DATA_DIR` per run.
- **DB access** goes through `getDb()` from `server/src/db/index.ts`. There is one connection — do not open new ones.
- **File I/O paths** come from `server/src/lib/data-dir.ts` (`getDataDir`, `getDbPath`, `getTaskSnapshotDir`, `getProjectArtifactsDir`). Do not hardcode `data/` paths.
- **Logging** uses `log` from `server/src/lib/logger.ts`. Do not `console.log` in server code.
- **Snapshots** are written by `server/src/services/snapshot.ts` after task mutations. Call `writeTaskSnapshot(projectId)` after mutating tasks; do not write snapshot files directly.
- **MCP authorization** is enforced in `server/src/routes/mcp.ts` via `server/src/mcp/auth.ts`. New routes that should require auth must call the same `checkAuth` pattern.

## Don't

- Don't import from `server/` in `client/` or vice versa — only `shared/` is bidirectional.
- Don't introduce a second SQLite connection or a different ORM. Use `getDb()` and raw SQL.
- Don't add `console.log` in committed code (lint won't catch it; reviewers will).
- Don't widen `any` — `@typescript-eslint/no-explicit-any` is `error` for new files. Existing debt files are listed in `eslint.config.mjs` (`ANY_DEBT`) at `warn`. When you clean a file's anys, remove it from the list — the ratchet only goes one way.
- Don't commit files in the repo root that aren't part of the long-lived layout. One-off scripts go in `benchmarks/`, `server/scripts/`, or get deleted. The root is curated.

## Validation

```bash
bun run check        # typecheck client + server
bun run lint         # eslint
bun run format:check # prettier
bun run --cwd server test    # unit + integration
bun run test:e2e     # Playwright
bun run test:smoke   # smoke harness
```

Pre-commit (`.husky/pre-commit`) runs `check` + `lint` + `format:check`. CI runs all of the above plus build.
