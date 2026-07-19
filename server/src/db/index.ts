import { openDatabase, type DatabaseHandle } from "../lib/runtime";
import { getDbPath } from "../lib/data-dir";
import { SCHEMA_SQL } from "./schema";

let _db: DatabaseHandle | null = null;

/**
 * Open the database, apply pragmas, and run the migration ladder. Idempotent —
 * returns the existing handle if already initialized. Call once at startup
 * (see app.ts) so migrations run at a known point rather than as a hidden side
 * effect of whichever getDb() happens to fire first inside a request.
 */
export function initDb(): DatabaseHandle {
  if (_db) return _db;

  const dbPath = getDbPath();
  _db = openDatabase(dbPath);

  // Set pragmas
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA busy_timeout = 5000");

  // Run initial schema + pending migrations
  runMigrations(_db);

  return _db;
}

/**
 * Return the shared connection. Lazily initializes when startup didn't call
 * initDb() first (tests, one-off scripts), so existing callers are unaffected.
 */
export function getDb(): DatabaseHandle {
  return _db ?? initDb();
}

function runMigrations(db: DatabaseHandle): void {
  // Check if _migrations table exists
  const migrationTableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
    .get();

  if (!migrationTableExists) {
    // First run - create all tables from base schema
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(1, "initial-schema");
    // Fall through to run remaining migrations (2+)
  }

  // Check current version
  const current = db.prepare("SELECT MAX(version) as v FROM _migrations").get() as {
    v: number;
  } | null;
  const currentVersion = current?.v ?? 0;

  // Run any pending migrations
  const migrations: { version: number; name: string; up: () => void; noTransaction?: boolean }[] = [
    {
      version: 1,
      name: "initial-schema",
      up: () => db.exec(SCHEMA_SQL),
    },
    {
      version: 2,
      name: "add-task-number",
      up: () => {
        // Add column if it doesn't exist
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "taskNumber")) {
          db.exec("ALTER TABLE tasks ADD COLUMN taskNumber INTEGER NOT NULL DEFAULT 0");
        }
        // Backfill: assign numbers per project ordered by createdAt
        const projects = db.prepare("SELECT DISTINCT projectId FROM tasks").all() as {
          projectId: string;
        }[];
        for (const { projectId } of projects) {
          const tasks = db
            .prepare("SELECT id FROM tasks WHERE projectId = ? ORDER BY createdAt ASC")
            .all(projectId) as { id: string }[];
          for (let i = 0; i < tasks.length; i++) {
            db.prepare("UPDATE tasks SET taskNumber = ? WHERE id = ?").run(i + 1, tasks[i].id);
          }
        }
      },
    },
    {
      version: 3,
      name: "add-notion-database-id",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "notionDatabaseId")) {
          db.exec("ALTER TABLE projects ADD COLUMN notionDatabaseId TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 4,
      name: "add-todos-table",
      up: () => {
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'")
          .get();
        if (!tableExists) {
          db.exec(`
            CREATE TABLE todos (
              id           TEXT PRIMARY KEY,
              title        TEXT NOT NULL,
              completed    INTEGER NOT NULL DEFAULT 0,
              linkedTaskId TEXT DEFAULT NULL
                REFERENCES tasks(id) ON DELETE SET NULL,
              sortOrder    REAL NOT NULL DEFAULT 0,
              createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_todos_completed ON todos (completed);
            CREATE INDEX idx_todos_sortOrder ON todos (sortOrder);
          `);
        }
      },
    },
    {
      version: 5,
      name: "add-task-branch",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "branch")) {
          db.exec("ALTER TABLE tasks ADD COLUMN branch TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 6,
      name: "add-api-client-tables",
      up: () => {
        const collectionExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_collections'")
          .get();
        if (!collectionExists) {
          db.exec(`
            CREATE TABLE api_collections (
              id           TEXT PRIMARY KEY,
              projectId    TEXT NOT NULL
                REFERENCES projects(id) ON DELETE CASCADE,
              name         TEXT NOT NULL,
              sortOrder    REAL NOT NULL DEFAULT 0,
              createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_api_collections_projectId ON api_collections (projectId);
            CREATE INDEX idx_api_collections_sortOrder ON api_collections (projectId, sortOrder);

            CREATE TABLE api_requests (
              id                  TEXT PRIMARY KEY,
              collectionId        TEXT NOT NULL
                REFERENCES api_collections(id) ON DELETE CASCADE,
              name                TEXT NOT NULL,
              method              TEXT NOT NULL DEFAULT 'GET'
                CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')),
              url                 TEXT NOT NULL DEFAULT '',
              headers             TEXT NOT NULL DEFAULT '{}',
              body                TEXT NOT NULL DEFAULT '',
              sortOrder           REAL NOT NULL DEFAULT 0,
              lastResponseStatus  INTEGER DEFAULT NULL,
              lastResponseTime    INTEGER DEFAULT NULL,
              createdAt           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updatedAt           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_api_requests_collectionId ON api_requests (collectionId);
            CREATE INDEX idx_api_requests_sortOrder ON api_requests (collectionId, sortOrder);
          `);
        }
      },
    },
    {
      version: 7,
      name: "add-approved-status",
      noTransaction: true, // PRAGMA foreign_keys cannot be changed inside a transaction
      up: () => {
        // Add approvedAt column if missing
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "approvedAt")) {
          db.exec("ALTER TABLE tasks ADD COLUMN approvedAt TEXT DEFAULT NULL");
        }
        // Disable FK checks for table rebuild (todos references tasks)
        db.exec("PRAGMA foreign_keys = OFF");
        // Rebuild table to update CHECK constraint to include 'approved'
        db.exec(`
          CREATE TABLE tasks_new (
            id           TEXT PRIMARY KEY,
            projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            milestoneId  TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL,
            title        TEXT NOT NULL,
            description  TEXT DEFAULT NULL,
            prompt       TEXT DEFAULT NULL,
            branch       TEXT DEFAULT NULL,
            status       TEXT NOT NULL DEFAULT 'backlog'
              CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'approved')),
            priority     TEXT NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
            taskNumber   INTEGER NOT NULL DEFAULT 0,
            sortOrder    REAL NOT NULL DEFAULT 0,
            inboxAt      TEXT DEFAULT NULL,
            inProgressAt TEXT DEFAULT NULL,
            doneAt       TEXT DEFAULT NULL,
            approvedAt   TEXT DEFAULT NULL,
            createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          INSERT INTO tasks_new SELECT id, projectId, milestoneId, title, description, prompt, branch, status, priority, taskNumber, sortOrder, inboxAt, inProgressAt, doneAt, approvedAt, createdAt, updatedAt FROM tasks;
          DROP TABLE tasks;
          ALTER TABLE tasks_new RENAME TO tasks;
          CREATE INDEX idx_tasks_projectId_status ON tasks (projectId, status);
          CREATE INDEX idx_tasks_projectId_status_sortOrder ON tasks (projectId, status, sortOrder);
          CREATE INDEX idx_tasks_projectId_milestoneId ON tasks (projectId, milestoneId);
          CREATE INDEX idx_tasks_doneAt ON tasks (doneAt);
          CREATE INDEX idx_tasks_projectId_priority ON tasks (projectId, priority);
        `);
        db.exec("PRAGMA foreign_keys = ON");
      },
    },
    {
      version: 8,
      name: "rebuild-tasks-check-constraint",
      noTransaction: true,
      up: () => {
        // Check if rebuild is needed (constraint might already include 'approved')
        const tableSql =
          (
            db
              .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'")
              .get() as any
          )?.sql || "";
        if (tableSql.includes("'approved'")) return; // already rebuilt

        db.exec("PRAGMA foreign_keys = OFF");
        // Ensure approvedAt column exists before rebuild
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        const hasApprovedAt = cols.some((c) => c.name === "approvedAt");
        db.exec(`
          CREATE TABLE tasks_rebuild (
            id           TEXT PRIMARY KEY,
            projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            milestoneId  TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL,
            title        TEXT NOT NULL,
            description  TEXT DEFAULT NULL,
            prompt       TEXT DEFAULT NULL,
            branch       TEXT DEFAULT NULL,
            status       TEXT NOT NULL DEFAULT 'backlog'
              CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'approved')),
            priority     TEXT NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
            taskNumber   INTEGER NOT NULL DEFAULT 0,
            sortOrder    REAL NOT NULL DEFAULT 0,
            inboxAt      TEXT DEFAULT NULL,
            inProgressAt TEXT DEFAULT NULL,
            doneAt       TEXT DEFAULT NULL,
            approvedAt   TEXT DEFAULT NULL,
            createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          INSERT INTO tasks_rebuild SELECT id, projectId, milestoneId, title, description, prompt, branch, status, priority, taskNumber, sortOrder, inboxAt, inProgressAt, doneAt, ${hasApprovedAt ? "approvedAt" : "NULL"}, createdAt, updatedAt FROM tasks;
          DROP TABLE tasks;
          ALTER TABLE tasks_rebuild RENAME TO tasks;
          CREATE INDEX idx_tasks_projectId_status ON tasks (projectId, status);
          CREATE INDEX idx_tasks_projectId_status_sortOrder ON tasks (projectId, status, sortOrder);
          CREATE INDEX idx_tasks_projectId_milestoneId ON tasks (projectId, milestoneId);
          CREATE INDEX idx_tasks_doneAt ON tasks (doneAt);
          CREATE INDEX idx_tasks_projectId_priority ON tasks (projectId, priority);
        `);
        db.exec("PRAGMA foreign_keys = ON");
      },
    },
    {
      version: 9,
      name: "add-prompt-profile",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "promptProfile")) {
          db.exec(
            "ALTER TABLE tasks ADD COLUMN promptProfile TEXT NOT NULL DEFAULT 'auto' CHECK (promptProfile IN ('auto', 'quick-fix', 'feature', 'refactor', 'bug-fix', 'docs'))",
          );
        }
      },
    },
    {
      version: 10,
      name: "add-project-tree-depth",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "treeDepth")) {
          db.exec("ALTER TABLE projects ADD COLUMN treeDepth INTEGER NOT NULL DEFAULT 3");
        }
      },
    },
    {
      version: 11,
      name: "add-ai-instructions",
      up: () => {
        const projCols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
        if (!projCols.some((c) => c.name === "aiInstructions")) {
          db.exec("ALTER TABLE projects ADD COLUMN aiInstructions TEXT DEFAULT NULL");
        }
        const msCols = db.prepare("PRAGMA table_info(milestones)").all() as { name: string }[];
        if (!msCols.some((c) => c.name === "aiInstructions")) {
          db.exec("ALTER TABLE milestones ADD COLUMN aiInstructions TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 12,
      name: "add-task-ai-runs",
      up: () => {
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_ai_runs'")
          .get();
        if (!tableExists) {
          db.exec(`
            CREATE TABLE task_ai_runs (
              id           TEXT PRIMARY KEY,
              taskId       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
              projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              sessionId    TEXT DEFAULT NULL,
              profile      TEXT NOT NULL DEFAULT 'feature',
              complexity   TEXT NOT NULL DEFAULT 'medium',
              exitCode     INTEGER DEFAULT NULL,
              success      INTEGER NOT NULL DEFAULT 0,
              filesChanged INTEGER DEFAULT NULL,
              durationMs   INTEGER DEFAULT NULL,
              summary      TEXT DEFAULT NULL,
              createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_task_ai_runs_projectId ON task_ai_runs (projectId);
            CREATE INDEX idx_task_ai_runs_taskId ON task_ai_runs (taskId);
            CREATE INDEX idx_task_ai_runs_createdAt ON task_ai_runs (createdAt DESC);
          `);
        }
      },
    },
    {
      version: 13,
      name: "add-archived-status",
      noTransaction: true,
      up: () => {
        // Add archivedAt column if missing
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "archivedAt")) {
          db.exec("ALTER TABLE tasks ADD COLUMN archivedAt TEXT DEFAULT NULL");
        }
        // Rebuild table to update CHECK constraint to include 'archived'
        const tableSql =
          (
            db
              .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'")
              .get() as any
          )?.sql || "";
        if (tableSql.includes("'archived'")) return;

        db.exec("PRAGMA foreign_keys = OFF");
        db.exec(`
          CREATE TABLE tasks_v13 (
            id           TEXT PRIMARY KEY,
            projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            milestoneId  TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL,
            title        TEXT NOT NULL,
            description  TEXT DEFAULT NULL,
            prompt       TEXT DEFAULT NULL,
            branch       TEXT DEFAULT NULL,
            promptProfile TEXT NOT NULL DEFAULT 'auto'
              CHECK (promptProfile IN ('auto', 'quick-fix', 'feature', 'refactor', 'bug-fix', 'docs')),
            status       TEXT NOT NULL DEFAULT 'backlog'
              CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'approved', 'archived')),
            priority     TEXT NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
            taskNumber   INTEGER NOT NULL DEFAULT 0,
            sortOrder    REAL NOT NULL DEFAULT 0,
            inboxAt      TEXT DEFAULT NULL,
            inProgressAt TEXT DEFAULT NULL,
            doneAt       TEXT DEFAULT NULL,
            approvedAt   TEXT DEFAULT NULL,
            archivedAt   TEXT DEFAULT NULL,
            createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          INSERT INTO tasks_v13 SELECT id, projectId, milestoneId, title, description, prompt, branch, promptProfile, status, priority, taskNumber, sortOrder, inboxAt, inProgressAt, doneAt, approvedAt, archivedAt, createdAt, updatedAt FROM tasks;
          DROP TABLE tasks;
          ALTER TABLE tasks_v13 RENAME TO tasks;
          CREATE INDEX idx_tasks_projectId_status ON tasks (projectId, status);
          CREATE INDEX idx_tasks_projectId_status_sortOrder ON tasks (projectId, status, sortOrder);
          CREATE INDEX idx_tasks_projectId_milestoneId ON tasks (projectId, milestoneId);
          CREATE INDEX idx_tasks_doneAt ON tasks (doneAt);
          CREATE INDEX idx_tasks_projectId_priority ON tasks (projectId, priority);
        `);
        db.exec("PRAGMA foreign_keys = ON");
      },
    },
    {
      version: 14,
      name: "add-parent-task-id",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "parentTaskId")) {
          db.exec(
            "ALTER TABLE tasks ADD COLUMN parentTaskId TEXT DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL",
          );
          db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_parentTaskId ON tasks (parentTaskId)");
        }
      },
    },
    {
      version: 15,
      name: "add-project-artifacts",
      up: () => {
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_artifacts'")
          .get();
        if (!tableExists) {
          db.exec(`
            CREATE TABLE project_artifacts (
              id           TEXT PRIMARY KEY,
              projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              filename     TEXT NOT NULL,
              type         TEXT NOT NULL DEFAULT 'document'
                CHECK (type IN ('document', 'diagram', 'image', 'research', 'spec', 'other')),
              description  TEXT DEFAULT NULL,
              tags         TEXT NOT NULL DEFAULT '[]',
              sizeBytes    INTEGER NOT NULL DEFAULT 0,
              mimeType     TEXT NOT NULL DEFAULT 'text/markdown',
              createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_artifacts_projectId ON project_artifacts (projectId);
            CREATE INDEX idx_artifacts_projectId_type ON project_artifacts (projectId, type);
          `);
        }
      },
    },
    {
      version: 16,
      name: "add-knowledge-graph",
      up: () => {
        const nodesExist = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='project_graph_nodes'",
          )
          .get();
        if (!nodesExist) {
          db.exec(`
            CREATE TABLE project_graph_nodes (
              id           TEXT PRIMARY KEY,
              projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              label        TEXT NOT NULL,
              type         TEXT NOT NULL DEFAULT 'concept'
                CHECK (type IN ('concept', 'system', 'person', 'decision', 'technology', 'risk')),
              description  TEXT DEFAULT NULL,
              x            REAL DEFAULT NULL,
              y            REAL DEFAULT NULL,
              metadata     TEXT NOT NULL DEFAULT '{}',
              createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_graph_nodes_projectId ON project_graph_nodes (projectId);

            CREATE TABLE project_graph_edges (
              id           TEXT PRIMARY KEY,
              projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              sourceNodeId TEXT NOT NULL REFERENCES project_graph_nodes(id) ON DELETE CASCADE,
              targetNodeId TEXT NOT NULL REFERENCES project_graph_nodes(id) ON DELETE CASCADE,
              label        TEXT DEFAULT NULL,
              type         TEXT NOT NULL DEFAULT 'related'
                CHECK (type IN ('related', 'depends_on', 'implements', 'extends', 'conflicts', 'owned_by')),
              createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_graph_edges_projectId ON project_graph_edges (projectId);
            CREATE INDEX idx_graph_edges_source ON project_graph_edges (sourceNodeId);
            CREATE INDEX idx_graph_edges_target ON project_graph_edges (targetNodeId);
          `);
        }
      },
    },
    {
      version: 17,
      name: "add-roadmap-items",
      up: () => {
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roadmap_items'")
          .get();
        if (!tableExists) {
          db.exec(`
            CREATE TABLE roadmap_items (
              id           TEXT PRIMARY KEY,
              projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              milestoneId  TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL,
              title        TEXT NOT NULL,
              description  TEXT DEFAULT NULL,
              status       TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned', 'in_progress', 'completed', 'blocked')),
              startDate    TEXT DEFAULT NULL,
              endDate      TEXT DEFAULT NULL,
              dependsOn    TEXT NOT NULL DEFAULT '[]',
              color        TEXT DEFAULT NULL,
              sortOrder    REAL NOT NULL DEFAULT 0,
              createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_roadmap_projectId ON roadmap_items (projectId);
            CREATE INDEX idx_roadmap_projectId_status ON roadmap_items (projectId, status);
            CREATE INDEX idx_roadmap_milestoneId ON roadmap_items (milestoneId);
          `);
        }
      },
    },
    {
      version: 18,
      name: "add-task-notion-page-id",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "notionPageId")) {
          db.exec("ALTER TABLE tasks ADD COLUMN notionPageId TEXT DEFAULT NULL");
        }
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_tasks_notionPageId ON tasks (projectId, notionPageId)",
        );
      },
    },
    {
      version: 19,
      name: "add-github-account-identity",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(github_accounts)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "username")) {
          db.exec("ALTER TABLE github_accounts ADD COLUMN username TEXT DEFAULT NULL");
        }
        if (!cols.some((c) => c.name === "email")) {
          db.exec("ALTER TABLE github_accounts ADD COLUMN email TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 20,
      name: "add-orchestration-fields",
      up: () => {
        const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!taskCols.some((c) => c.name === "metadata")) {
          db.exec("ALTER TABLE tasks ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
        }

        const projCols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
        if (!projCols.some((c) => c.name === "autoSpawnEnabled")) {
          db.exec("ALTER TABLE projects ADD COLUMN autoSpawnEnabled INTEGER NOT NULL DEFAULT 0");
        }
        if (!projCols.some((c) => c.name === "qaAgentPath")) {
          db.exec("ALTER TABLE projects ADD COLUMN qaAgentPath TEXT DEFAULT NULL");
        }
        if (!projCols.some((c) => c.name === "qaAgentPython")) {
          db.exec("ALTER TABLE projects ADD COLUMN qaAgentPython TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 21,
      name: "add-artifact-embeddings",
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS artifact_embeddings (
            id          TEXT PRIMARY KEY,
            artifactId  TEXT NOT NULL
              REFERENCES project_artifacts(id) ON DELETE CASCADE,
            projectId   TEXT NOT NULL
              REFERENCES projects(id) ON DELETE CASCADE,
            chunkIdx    INTEGER NOT NULL,
            content     TEXT NOT NULL,
            vector      BLOB NOT NULL,
            model       TEXT NOT NULL,
            dim         INTEGER NOT NULL,
            createdAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          CREATE INDEX IF NOT EXISTS idx_artifact_embeddings_artifactId ON artifact_embeddings (artifactId);
          CREATE INDEX IF NOT EXISTS idx_artifact_embeddings_projectId ON artifact_embeddings (projectId);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_embeddings_artifact_chunk ON artifact_embeddings (artifactId, chunkIdx);
        `);
      },
    },
    {
      version: 22,
      name: "add-task-embeddings",
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS task_embeddings (
            id          TEXT PRIMARY KEY,
            taskId      TEXT NOT NULL
              REFERENCES tasks(id) ON DELETE CASCADE,
            projectId   TEXT NOT NULL
              REFERENCES projects(id) ON DELETE CASCADE,
            chunkIdx    INTEGER NOT NULL,
            content     TEXT NOT NULL,
            vector      BLOB NOT NULL,
            model       TEXT NOT NULL,
            dim         INTEGER NOT NULL,
            sourceHash  TEXT NOT NULL,
            createdAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          CREATE INDEX IF NOT EXISTS idx_task_embeddings_taskId ON task_embeddings (taskId);
          CREATE INDEX IF NOT EXISTS idx_task_embeddings_projectId ON task_embeddings (projectId);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_task_embeddings_task_chunk ON task_embeddings (taskId, chunkIdx);
        `);
      },
    },
    {
      version: 23,
      name: "add-graph-node-embeddings",
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS graph_node_embeddings (
            id          TEXT PRIMARY KEY,
            nodeId      TEXT NOT NULL
              REFERENCES project_graph_nodes(id) ON DELETE CASCADE,
            projectId   TEXT NOT NULL
              REFERENCES projects(id) ON DELETE CASCADE,
            chunkIdx    INTEGER NOT NULL,
            content     TEXT NOT NULL,
            vector      BLOB NOT NULL,
            model       TEXT NOT NULL,
            dim         INTEGER NOT NULL,
            sourceHash  TEXT NOT NULL,
            createdAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          CREATE INDEX IF NOT EXISTS idx_graph_node_embeddings_nodeId ON graph_node_embeddings (nodeId);
          CREATE INDEX IF NOT EXISTS idx_graph_node_embeddings_projectId ON graph_node_embeddings (projectId);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_node_embeddings_node_chunk ON graph_node_embeddings (nodeId, chunkIdx);
        `);
      },
    },
    {
      version: 24,
      name: "add-bench-runs",
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS bench_runs (
            id            TEXT PRIMARY KEY,
            started_at    TEXT NOT NULL,
            finished_at   TEXT DEFAULT NULL,
            fixtures_csv  TEXT NOT NULL,
            mode          TEXT NOT NULL,
            mock          INTEGER NOT NULL DEFAULT 0,
            parallel      INTEGER NOT NULL DEFAULT 1,
            result_file   TEXT DEFAULT NULL,
            status        TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running', 'succeeded', 'failed'))
          );
          CREATE INDEX IF NOT EXISTS idx_bench_runs_started_at ON bench_runs (started_at DESC);
          CREATE INDEX IF NOT EXISTS idx_bench_runs_status ON bench_runs (status);
        `);
      },
    },
    {
      version: 25,
      name: "add-task-ai-findings",
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS task_ai_findings (
            id          TEXT PRIMARY KEY,
            runId       TEXT NOT NULL,
            taskId      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            projectId   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            kind        TEXT NOT NULL
              CHECK (kind IN ('EXFIL', 'PROMPT-INJECTED', 'TAMPERED', 'SPRAWL', 'PREFLIGHT-RED')),
            detail      TEXT DEFAULT NULL,
            createdAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          CREATE INDEX IF NOT EXISTS idx_task_ai_findings_runId ON task_ai_findings (runId);
          CREATE INDEX IF NOT EXISTS idx_task_ai_findings_taskId ON task_ai_findings (taskId);
          CREATE INDEX IF NOT EXISTS idx_task_ai_findings_projectId ON task_ai_findings (projectId);
          CREATE INDEX IF NOT EXISTS idx_task_ai_findings_kind ON task_ai_findings (kind);
        `);
      },
    },
    {
      version: 26,
      name: "add-task-ai-run-lifecycle",
      up: () => {
        // Durable run lifecycle: a row is now inserted as 'running' up front and
        // finalized on completion, so in-flight/interrupted runs are visible and
        // recoverable (previously the row was written only after the run ended).
        const cols = db.prepare("PRAGMA table_info(task_ai_runs)").all() as { name: string }[];
        const has = (n: string) => cols.some((c) => c.name === n);
        if (!has("status")) {
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'succeeded'");
          // Backfill historical rows from their success flag.
          db.exec(
            "UPDATE task_ai_runs SET status = CASE WHEN success = 1 THEN 'succeeded' ELSE 'failed' END",
          );
        }
        if (!has("startedAt"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN startedAt TEXT DEFAULT NULL");
        if (!has("finishedAt"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN finishedAt TEXT DEFAULT NULL");
        db.exec("CREATE INDEX IF NOT EXISTS idx_task_ai_runs_status ON task_ai_runs (status)");
      },
    },
    {
      version: 27,
      name: "add-task-ai-run-cost",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(task_ai_runs)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "totalCostUsd")) {
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN totalCostUsd REAL DEFAULT NULL");
        }
      },
    },
    {
      version: 28,
      name: "add-wikilink-edge-type-and-unique",
      noTransaction: true, // FK toggle for the edges table rebuild (CHECK can't be ALTERed)
      up: () => {
        // Rebuild project_graph_edges to (a) add 'wikilink' to the type CHECK and
        // (b) add UNIQUE(projectId, sourceNodeId, targetNodeId, type) so re-parsing
        // the same link is idempotent. Skip if already rebuilt.
        const tableSql =
          (
            db
              .prepare(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='project_graph_edges'",
              )
              .get() as any
          )?.sql || "";
        if (tableSql.includes("'wikilink'")) return; // already rebuilt

        db.exec("PRAGMA foreign_keys = OFF");
        db.exec(`
          CREATE TABLE project_graph_edges_v28 (
            id           TEXT PRIMARY KEY,
            projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            sourceNodeId TEXT NOT NULL REFERENCES project_graph_nodes(id) ON DELETE CASCADE,
            targetNodeId TEXT NOT NULL REFERENCES project_graph_nodes(id) ON DELETE CASCADE,
            label        TEXT DEFAULT NULL,
            type         TEXT NOT NULL DEFAULT 'related'
              CHECK (type IN ('related', 'depends_on', 'implements', 'extends', 'conflicts', 'owned_by', 'wikilink')),
            createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            UNIQUE (projectId, sourceNodeId, targetNodeId, type)
          );
          INSERT OR IGNORE INTO project_graph_edges_v28 (id, projectId, sourceNodeId, targetNodeId, label, type, createdAt)
            SELECT id, projectId, sourceNodeId, targetNodeId, label, type, createdAt FROM project_graph_edges;
          DROP TABLE project_graph_edges;
          ALTER TABLE project_graph_edges_v28 RENAME TO project_graph_edges;
          CREATE INDEX idx_graph_edges_projectId ON project_graph_edges (projectId);
          CREATE INDEX idx_graph_edges_source ON project_graph_edges (sourceNodeId);
          CREATE INDEX idx_graph_edges_target ON project_graph_edges (targetNodeId);
        `);
        db.exec("PRAGMA foreign_keys = ON");
      },
    },
    {
      version: 29,
      name: "add-artifact-pending-links",
      up: () => {
        // Unresolved [[targets]] are recorded here (NOT as half-edges, which the
        // canvas would drop). Re-resolved on later artifact create/rename.
        db.exec(`
          CREATE TABLE IF NOT EXISTS artifact_pending_links (
            id                TEXT PRIMARY KEY,
            projectId         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            sourceArtifactId  TEXT NOT NULL REFERENCES project_artifacts(id) ON DELETE CASCADE,
            rawTarget         TEXT NOT NULL,
            createdAt         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            UNIQUE (projectId, sourceArtifactId, rawTarget)
          );
          CREATE INDEX IF NOT EXISTS idx_pending_links_projectId ON artifact_pending_links (projectId);
          CREATE INDEX IF NOT EXISTS idx_pending_links_source ON artifact_pending_links (sourceArtifactId);
          CREATE INDEX IF NOT EXISTS idx_pending_links_rawTarget ON artifact_pending_links (projectId, rawTarget);
        `);
      },
    },
    {
      version: 30,
      name: "add-roadmap-item-tasks",
      up: () => {
        // Join table linking roadmap items to tasks. CASCADE from both sides so
        // deleting a roadmap item or a task removes the link with no orphans.
        db.exec(`
          CREATE TABLE IF NOT EXISTS roadmap_item_tasks (
            roadmapItemId TEXT NOT NULL
              REFERENCES roadmap_items(id) ON DELETE CASCADE,
            taskId        TEXT NOT NULL
              REFERENCES tasks(id) ON DELETE CASCADE,
            PRIMARY KEY (roadmapItemId, taskId)
          );
          CREATE INDEX IF NOT EXISTS idx_roadmap_item_tasks_roadmapItemId ON roadmap_item_tasks (roadmapItemId);
          CREATE INDEX IF NOT EXISTS idx_roadmap_item_tasks_taskId ON roadmap_item_tasks (taskId);
        `);
      },
    },
    {
      version: 31,
      name: "add-task-ai-run-grounded-artifacts",
      up: () => {
        // O6: persist which knowledge artifacts grounded each AI run (the ones
        // injected into its prompt by the O2 knowledge-injection helper) so a
        // human can audit what knowledge shaped a run. JSON array of {id,title}.
        const cols = db.prepare("PRAGMA table_info(task_ai_runs)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "groundedArtifacts")) {
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN groundedArtifacts TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 32,
      name: "add-task-ai-run-resume",
      up: () => {
        // Auto-resume after usage-limit: a run that hits the subscription usage
        // limit is parked as status='waiting_limit' and resumed (same Claude
        // session) once the window resets. These columns persist the resume
        // schedule + the isolated worktree so a parked run survives a server
        // restart and resumes IN the exact tree it left.
        const cols = db.prepare("PRAGMA table_info(task_ai_runs)").all() as { name: string }[];
        const has = (n: string) => cols.some((c) => c.name === n);
        if (!has("resumeAt"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN resumeAt TEXT DEFAULT NULL");
        if (!has("resumeReason"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN resumeReason TEXT DEFAULT NULL");
        if (!has("resumeAttempts"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN resumeAttempts INTEGER NOT NULL DEFAULT 0");
        // The parked run's isolated tree + vk/… branch, so resume reuses it.
        if (!has("worktreeDir"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN worktreeDir TEXT DEFAULT NULL");
        if (!has("worktreeBranch"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN worktreeBranch TEXT DEFAULT NULL");
        // 'worktree' (isolated) | 'in_place' (no isolation; pause is best-effort).
        if (!has("runMode"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN runMode TEXT DEFAULT NULL");
        // First attempt's pre-spawn SHA, reused across resumes so verifiers diff
        // the whole change (baseline → final), not just the post-resume delta.
        if (!has("baselineSha"))
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN baselineSha TEXT DEFAULT NULL");
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_task_ai_runs_resume ON task_ai_runs (status, resumeAt)",
        );
      },
    },
    {
      version: 33,
      name: "add-graph-status-origin",
      up: () => {
        // Centralized-brain bridge: graph nodes/edges can be AI-proposed. `status`
        // gates whether an entity is live ('confirmed') or awaiting human review
        // ('suggested'); `origin` records provenance (brain:capture, brain:ingest,
        // manual, wikilink). Existing rows backfill to 'confirmed' via the column
        // default, so the graph is unchanged for pre-bridge projects.
        for (const table of ["project_graph_nodes", "project_graph_edges"]) {
          const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
          const has = (n: string) => cols.some((c) => c.name === n);
          if (!has("status")) {
            db.exec(
              `ALTER TABLE ${table} ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed' ` +
                `CHECK (status IN ('confirmed', 'suggested'))`,
            );
          }
          if (!has("origin")) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN origin TEXT DEFAULT NULL`);
          }
        }
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_graph_nodes_status ON project_graph_nodes (projectId, status)",
        );
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_graph_edges_status ON project_graph_edges (projectId, status)",
        );
      },
    },
    {
      version: 34,
      name: "add-claude-sessions",
      up: () => {
        // Interactive Claude terminals VK has spawned. `id` is the Claude CLI
        // --session-id UUID we pin at launch, so a picker can list past sessions
        // and resume a specific one (`claude --resume <id>`). taskId is optional
        // (a session may be project-scoped, not tied to a task).
        db.exec(`
          CREATE TABLE IF NOT EXISTS claude_sessions (
            id          TEXT PRIMARY KEY,
            projectId   TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE CASCADE,
            taskId      TEXT DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL,
            model       TEXT DEFAULT NULL,
            cwd         TEXT NOT NULL,
            title       TEXT DEFAULT NULL,
            createdAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            lastUsedAt  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          CREATE INDEX IF NOT EXISTS idx_claude_sessions_projectId ON claude_sessions (projectId, lastUsedAt DESC);
        `);
      },
    },
    {
      version: 35,
      name: "add-task-ai-run-deviations",
      up: () => {
        // Per-run deviations log: a resolve agent records how it diverged from
        // the plan (and the impl-notes artifact it authored) via the run-scoped
        // record_run_deviations MCP tool. JSON {notes?, artifactId?}, keyed by
        // runId for audit — complements the agent-authored artifact on the task.
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_ai_runs'")
          .get();
        if (!tableExists) return;
        const cols = db.prepare("PRAGMA table_info(task_ai_runs)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "deviations")) {
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN deviations TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 36,
      name: "add-project-default-branch",
      up: () => {
        // Per-project integration branch (e.g. main/develop). Base for the
        // ahead/behind divergence indicator; NULL falls back to main→master.
        const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "defaultBranch")) {
          db.exec("ALTER TABLE projects ADD COLUMN defaultBranch TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 37,
      name: "add-task-agent",
      up: () => {
        // Per-task resolver agent override (claude/opencode/grok). NULL = inherit
        // the batch-dialog choice, then the global aiAgent setting, then claude.
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "agent")) {
          db.exec("ALTER TABLE tasks ADD COLUMN agent TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 38,
      name: "add-terminal-sessions-table",
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS terminal_sessions (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            projectId TEXT,
            taskId TEXT,
            name TEXT,
            cwd TEXT NOT NULL,
            createdAt TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_terminal_sessions_projectId ON terminal_sessions (projectId);
        `);
      },
    },
    {
      version: 39,
      name: "add-knowledge-fts",
      up: () => {
        // Standalone FTS5 index over embedding-chunk content, unifying all three
        // knowledge sources for lexical (exact-token) retrieval. It is kept in
        // sync with the embeddings tables by the AFTER INSERT/DELETE triggers
        // below — embedders DELETE-then-INSERT within a txn, so no UPDATE trigger
        // is needed. `embId` is the source embeddings-row id; `entityId` is the
        // artifact/task/node id. All non-content columns are UNINDEXED (payload
        // only, not searchable). NOTE: FTS is synced OFF the embeddings tables,
        // so when VK_DISABLE_EMBEDDINGS is set from boot the embeddings tables
        // (and thus this index) stay empty. A future decoupled FTS + a separate
        // VK_DISABLE_KNOWLEDGE_SEARCH flag would enable lexical-when-model-off.
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
            content,
            embId UNINDEXED,
            entityId UNINDEXED,
            projectId UNINDEXED,
            kind UNINDEXED,
            chunkIdx UNINDEXED
          );

          CREATE TRIGGER IF NOT EXISTS trg_artifact_emb_fts_ai
          AFTER INSERT ON artifact_embeddings BEGIN
            INSERT INTO knowledge_fts (content, embId, entityId, projectId, kind, chunkIdx)
            VALUES (new.content, new.id, new.artifactId, new.projectId, 'artifact', new.chunkIdx);
          END;
          CREATE TRIGGER IF NOT EXISTS trg_artifact_emb_fts_ad
          AFTER DELETE ON artifact_embeddings BEGIN
            DELETE FROM knowledge_fts WHERE embId = old.id;
          END;

          CREATE TRIGGER IF NOT EXISTS trg_task_emb_fts_ai
          AFTER INSERT ON task_embeddings BEGIN
            INSERT INTO knowledge_fts (content, embId, entityId, projectId, kind, chunkIdx)
            VALUES (new.content, new.id, new.taskId, new.projectId, 'task', new.chunkIdx);
          END;
          CREATE TRIGGER IF NOT EXISTS trg_task_emb_fts_ad
          AFTER DELETE ON task_embeddings BEGIN
            DELETE FROM knowledge_fts WHERE embId = old.id;
          END;

          CREATE TRIGGER IF NOT EXISTS trg_graph_node_emb_fts_ai
          AFTER INSERT ON graph_node_embeddings BEGIN
            INSERT INTO knowledge_fts (content, embId, entityId, projectId, kind, chunkIdx)
            VALUES (new.content, new.id, new.nodeId, new.projectId, 'graph_node', new.chunkIdx);
          END;
          CREATE TRIGGER IF NOT EXISTS trg_graph_node_emb_fts_ad
          AFTER DELETE ON graph_node_embeddings BEGIN
            DELETE FROM knowledge_fts WHERE embId = old.id;
          END;
        `);

        // Backfill existing embedding rows into the fresh index. Mirror-node
        // rows are backfilled too; the retrieval layer excludes them at query
        // time (parity with the vector branch), so no filtering is needed here.
        db.exec(`
          INSERT INTO knowledge_fts (content, embId, entityId, projectId, kind, chunkIdx)
            SELECT content, id, artifactId, projectId, 'artifact', chunkIdx FROM artifact_embeddings;
          INSERT INTO knowledge_fts (content, embId, entityId, projectId, kind, chunkIdx)
            SELECT content, id, taskId, projectId, 'task', chunkIdx FROM task_embeddings;
          INSERT INTO knowledge_fts (content, embId, entityId, projectId, kind, chunkIdx)
            SELECT content, id, nodeId, projectId, 'graph_node', chunkIdx FROM graph_node_embeddings;
        `);
      },
    },
    {
      version: 40,
      name: "add-project-memory",
      up: () => {
        // Append-only typed memory log per project: decisions, gotchas, failed
        // attempts, conventions, fragile files. Auto-captured from AI runs and
        // injected into future prompts so agents don't repeat failed fixes.
        // Append-only: entries are superseded (supersededBy points at a later
        // row), never hard-updated/deleted except via project CASCADE.
        db.exec(`
          CREATE TABLE IF NOT EXISTS project_memory (
            id            TEXT PRIMARY KEY,
            projectId     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            type          TEXT NOT NULL
              CHECK (type IN ('decision', 'gotcha', 'attempt_failed', 'convention', 'fragile_file')),
            title         TEXT NOT NULL,
            body          TEXT NOT NULL DEFAULT '',
            files         TEXT NOT NULL DEFAULT '[]',
            taskId        TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            runId         TEXT REFERENCES task_ai_runs(id) ON DELETE SET NULL,
            origin        TEXT NOT NULL DEFAULT 'ai_captured'
              CHECK (origin IN ('human', 'ai_captured')),
            supersededBy  TEXT REFERENCES project_memory(id) ON DELETE SET NULL,
            createdAt     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          CREATE INDEX IF NOT EXISTS idx_project_memory_project_created ON project_memory (projectId, createdAt);
          CREATE INDEX IF NOT EXISTS idx_project_memory_project_type ON project_memory (projectId, type);
        `);
      },
    },
    {
      version: 41,
      name: "add-memory-embeddings",
      up: () => {
        // Mirrors task_embeddings (migration 22): one row per chunk, local
        // MiniLM-384 vector as BLOB, sourceHash gates re-embedding on unchanged
        // content. projectId carried on the row so a later cross-project memory
        // search is a WHERE-clause relaxation (see knowledgeRetrieval).
        db.exec(`
          CREATE TABLE IF NOT EXISTS memory_embeddings (
            id          TEXT PRIMARY KEY,
            memoryId    TEXT NOT NULL
              REFERENCES project_memory(id) ON DELETE CASCADE,
            projectId   TEXT NOT NULL
              REFERENCES projects(id) ON DELETE CASCADE,
            chunkIdx    INTEGER NOT NULL,
            content     TEXT NOT NULL,
            vector      BLOB NOT NULL,
            model       TEXT NOT NULL,
            dim         INTEGER NOT NULL,
            sourceHash  TEXT NOT NULL,
            createdAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memoryId ON memory_embeddings (memoryId);
          CREATE INDEX IF NOT EXISTS idx_memory_embeddings_projectId ON memory_embeddings (projectId);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_embeddings_memory_chunk ON memory_embeddings (memoryId, chunkIdx);
        `);
      },
    },
    {
      version: 42,
      name: "add-task-ai-runs-grounded-memory",
      up: () => {
        // Audit column: the memory events injected into a run's prompt (JSON
        // GroundedMemory[]), mirroring groundedArtifacts. Guarded so re-running
        // on a DB that already has the column is a no-op.
        const cols = db.prepare("PRAGMA table_info(task_ai_runs)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "groundedMemory")) {
          db.exec("ALTER TABLE task_ai_runs ADD COLUMN groundedMemory TEXT DEFAULT NULL");
        }
      },
    },
  ];

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      if (migration.noTransaction) {
        // These migrations rebuild the tasks table with FK enforcement off.
        // PRAGMA foreign_keys can only be toggled OUTSIDE a transaction — but the
        // rebuild itself (CREATE/INSERT/DROP/RENAME) and the _migrations ledger
        // write CAN run inside one. Doing so makes the rebuild atomic: a crash
        // between DROP TABLE tasks and the RENAME now rolls back (tasks survives)
        // instead of destroying the table and leaving the ledger inconsistent.
        db.exec("PRAGMA foreign_keys = OFF");
        try {
          db.transaction(() => {
            migration.up();
            db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(
              migration.version,
              migration.name,
            );
          })();
        } finally {
          db.exec("PRAGMA foreign_keys = ON");
        }
      } else {
        db.transaction(() => {
          migration.up();
          db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(
            migration.version,
            migration.name,
          );
        })();
      }
    }
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** @internal Reset singleton — for testing only */
export function _resetDb(): void {
  _db = null;
}

/** @internal Run migrations on any DatabaseHandle — for testing only */
export function _runMigrations(db: DatabaseHandle): void {
  runMigrations(db);
}
