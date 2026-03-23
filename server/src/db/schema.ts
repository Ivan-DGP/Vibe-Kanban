export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS _migrations (
  version  INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  path         TEXT NOT NULL UNIQUE,
  favorite     INTEGER NOT NULL DEFAULT 0,
  category     TEXT DEFAULT NULL,
  techStack    TEXT NOT NULL DEFAULT '[]',
  externalLinks TEXT NOT NULL DEFAULT '[]',
  aiCommitMode TEXT NOT NULL DEFAULT 'stage'
    CHECK (aiCommitMode IN ('commit', 'stage', 'none')),
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_favorite ON projects (favorite);
CREATE INDEX IF NOT EXISTS idx_projects_category ON projects (category);

CREATE TABLE IF NOT EXISTS milestones (
  id           TEXT PRIMARY KEY,
  projectId    TEXT NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_milestones_projectId ON milestones (projectId);
CREATE INDEX IF NOT EXISTS idx_milestones_projectId_status ON milestones (projectId, status);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  projectId    TEXT NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  milestoneId  TEXT DEFAULT NULL
    REFERENCES milestones(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT DEFAULT NULL,
  prompt       TEXT DEFAULT NULL,
  status       TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
  priority     TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  taskNumber   INTEGER NOT NULL DEFAULT 0,
  sortOrder    REAL NOT NULL DEFAULT 0,
  inboxAt      TEXT DEFAULT NULL,
  inProgressAt TEXT DEFAULT NULL,
  doneAt       TEXT DEFAULT NULL,
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_projectId_status ON tasks (projectId, status);
CREATE INDEX IF NOT EXISTS idx_tasks_projectId_status_sortOrder ON tasks (projectId, status, sortOrder);
CREATE INDEX IF NOT EXISTS idx_tasks_projectId_milestoneId ON tasks (projectId, milestoneId);
CREATE INDEX IF NOT EXISTS idx_tasks_doneAt ON tasks (doneAt);
CREATE INDEX IF NOT EXISTS idx_tasks_projectId_priority ON tasks (projectId, priority);

CREATE TABLE IF NOT EXISTS github_accounts (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token        TEXT NOT NULL,
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS project_github_mappings (
  projectId       TEXT NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  subPath         TEXT NOT NULL DEFAULT '',
  githubAccountId TEXT NOT NULL
    REFERENCES github_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (projectId, subPath)
);

CREATE TABLE IF NOT EXISTS system_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('info', 'warn', 'error')),
  category     TEXT NOT NULL DEFAULT 'server'
    CHECK (category IN ('server', 'git', 'claude', 'sync', 'terminal', 'mcp', 'tasks', 'files')),
  message      TEXT NOT NULL,
  details      TEXT DEFAULT NULL,
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_level ON system_logs (level);
CREATE INDEX IF NOT EXISTS idx_logs_category ON system_logs (category);
CREATE INDEX IF NOT EXISTS idx_logs_level_category ON system_logs (level, category);
CREATE INDEX IF NOT EXISTS idx_logs_createdAt ON system_logs (createdAt DESC);

CREATE TABLE IF NOT EXISTS settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS todos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  completed    INTEGER NOT NULL DEFAULT 0,
  linkedTaskId TEXT DEFAULT NULL
    REFERENCES tasks(id) ON DELETE SET NULL,
  sortOrder    REAL NOT NULL DEFAULT 0,
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos (completed);
CREATE INDEX IF NOT EXISTS idx_todos_sortOrder ON todos (sortOrder);
`;
