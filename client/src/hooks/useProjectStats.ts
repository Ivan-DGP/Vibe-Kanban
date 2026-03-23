import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface ProjectStats {
  taskCounts: { inbox: number; inProgress: number; done: number; urgent: number };
  gitBranch: string | null;
}

export function useProjectStats(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-stats", projectId],
    queryFn: async (): Promise<ProjectStats> => {
      // Fetch tasks and git status in parallel — use limit:1 just to get totals
      const [backlog, todo, ip, done, gitStatus] = await Promise.allSettled([
        api.tasks.list(projectId!, { status: "backlog" as any, limit: 1 }),
        api.tasks.list(projectId!, { status: "todo" as any, limit: 1 }),
        api.tasks.list(projectId!, { status: "in_progress" as any, limit: 1 }),
        api.tasks.list(projectId!, { status: "done" as any, limit: 1 }),
        api.git.status(projectId!),
      ]);

      const backlogTotal = backlog.status === "fulfilled" ? backlog.value.total : 0;
      const todoTotal = todo.status === "fulfilled" ? todo.value.total : 0;
      const ipTotal = ip.status === "fulfilled" ? ip.value.total : 0;
      const doneTotal = done.status === "fulfilled" ? done.value.total : 0;

      // Count urgent from backlog items (we got at most 1 item, so fetch more if needed)
      let urgentCount = 0;
      if (backlogTotal > 0) {
        try {
          const urgentData = await api.tasks.list(projectId!, { status: "backlog" as any, limit: 100 });
          urgentCount = urgentData.items.filter((t) => t.priority === "urgent").length;
        } catch {}
      }

      return {
        taskCounts: {
          inbox: backlogTotal + todoTotal,
          inProgress: ipTotal,
          done: doneTotal,
          urgent: urgentCount,
        },
        gitBranch: gitStatus.status === "fulfilled" && gitStatus.value.branch ? gitStatus.value.branch : null,
      };
    },
    enabled: !!projectId,
    staleTime: 30_000,
    retry: 1,
  });
}
