import { openDatabase, type DatabaseHandle } from "../lib/runtime";
import { getDbPath } from "../lib/data-dir";
import { SCHEMA_SQL } from "./schema";

let _db: DatabaseHandle | null = null;

export function getDb(): DatabaseHandle {
  if (_db) return _db;

  const dbPath = getDbPath();
  _db = openDatabase(dbPath);

  // Set pragmas
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA busy_timeout = 5000");

  // Run initial schema
  runMigrations(_db);

  return _db;
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
