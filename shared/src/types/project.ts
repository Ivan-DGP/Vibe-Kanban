// ============================================================
// Project
// ============================================================

export interface Project {
  id: string;
  name: string;
  path: string;
  favorite: boolean;
  category: string | null;
  techStack: string[];
  externalLinks: ExternalLink[];
  aiCommitMode: "commit" | "stage" | "none";
  defaultBranch: string | null;
  treeDepth: number;
  aiInstructions: string | null;
  notionDatabaseId: string | null;
  autoSpawnEnabled: boolean;
  qaAgentPath: string | null;
  qaAgentPython: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalLink {
  label: string;
  url: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  category?: string;
}

export interface UpdateProjectInput {
  name?: string;
  favorite?: boolean;
  category?: string | null;
  techStack?: string[];
  externalLinks?: ExternalLink[];
  aiCommitMode?: "commit" | "stage" | "none";
  defaultBranch?: string | null;
  treeDepth?: number;
  aiInstructions?: string | null;
  notionDatabaseId?: string | null;
  autoSpawnEnabled?: boolean;
  qaAgentPath?: string | null;
  qaAgentPython?: string | null;
}

export interface ScannedProject {
  name: string;
  path: string;
  techStack: string[];
}
