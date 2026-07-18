// ============================================================
// Git
// ============================================================

export interface GitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
}

export interface FileChange {
  path: string;
  status: string; // M, A, D, R, C, etc.
  oldPath?: string; // for renames
}

export interface GitLogEntry {
  hash: string;
  hashShort: string;
  author: string;
  date: string;
  message: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

// ============================================================
// GitHub Account
// ============================================================

export interface GitHubAccount {
  id: string;
  name: string;
  hasToken: boolean;
  username: string | null;
  email: string | null;
  createdAt: string;
}

// ============================================================
// CI/CD (GitHub Actions)
// ============================================================

export type CIStatus = "success" | "failure" | "pending" | "running" | "unknown";

export interface CICheckResult {
  branch: string;
  status: CIStatus;
  conclusion: string | null;
  workflowName: string | null;
  runUrl: string | null;
  updatedAt: string | null;
}
