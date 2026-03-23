import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useNotionStatus() {
  return useQuery({
    queryKey: ["notion", "status"],
    queryFn: () => api.notion.status(),
  });
}

export function useNotionDatabases(enabled = true) {
  return useQuery({
    queryKey: ["notion", "databases"],
    queryFn: () => api.notion.databases(),
    enabled,
  });
}

export function useNotionDatabasePages(databaseId: string | null | undefined) {
  return useQuery({
    queryKey: ["notion", "database-pages", databaseId],
    queryFn: () => api.notion.databasePages(databaseId!),
    enabled: !!databaseId,
  });
}

export function useNotionPage(pageId: string | null | undefined) {
  return useQuery({
    queryKey: ["notion", "page", pageId],
    queryFn: () => api.notion.page(pageId!),
    enabled: !!pageId,
  });
}

export function useNotionSearch() {
  return useMutation({
    mutationFn: ({ query, filter }: { query?: string; filter?: "database" | "page" }) =>
      api.notion.search(query, filter),
  });
}
