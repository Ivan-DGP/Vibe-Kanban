// ============================================================
// Roadmap
// ============================================================

export type RoadmapItemStatus = "planned" | "in_progress" | "completed" | "blocked";

export interface RoadmapItem {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  description: string | null;
  status: RoadmapItemStatus;
  startDate: string | null;
  endDate: string | null;
  dependsOn: string[]; // array of roadmap item IDs
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  // Task linkage (join table roadmap_item_tasks)
  taskIds: string[];
  // Rollup over linked tasks
  tasksTotal: number;
  tasksDone: number;
  // Rollup over the linked milestone's tasks (null when no milestone)
  milestoneTasksTotal: number | null;
  milestoneTasksDone: number | null;
}

export interface CreateRoadmapItemInput {
  title: string;
  description?: string;
  status?: RoadmapItemStatus;
  milestoneId?: string | null;
  startDate?: string;
  endDate?: string;
  dependsOn?: string[];
  color?: string;
  taskIds?: string[];
}

export interface UpdateRoadmapItemInput {
  title?: string;
  description?: string | null;
  status?: RoadmapItemStatus;
  milestoneId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dependsOn?: string[];
  color?: string | null;
  sortOrder?: number;
  taskIds?: string[];
}
