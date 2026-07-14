// ============================================================
// Milestone
// ============================================================

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  status: "active" | "closed";
  aiInstructions: string | null;
  createdAt: string;
}

export interface CreateMilestoneInput {
  name: string;
}

export interface UpdateMilestoneInput {
  name?: string;
  status?: "active" | "closed";
  aiInstructions?: string | null;
}
