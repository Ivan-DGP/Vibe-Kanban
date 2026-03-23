import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useReport(params: { period: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ["report", params],
    queryFn: () => api.reports.get(params),
    enabled: !!params.period,
  });
}
