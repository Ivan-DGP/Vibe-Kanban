import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const PROPOSALS_KEY = ["supervisor-proposals"] as const;

/** List the supervisor-origin proposals (cross-project, newest first). */
export function useSupervisorProposals() {
  return useQuery({
    queryKey: PROPOSALS_KEY,
    queryFn: () => api.supervisor.proposals(),
  });
}

/** Trigger a cross-project scan → emit idempotent backlog proposals. */
export function useScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.supervisor.scan(),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROPOSALS_KEY }),
  });
}

/** Dispatch ONE proposal into the isolated headless runner (human-gated). */
export function useDispatchProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.supervisor.dispatch(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROPOSALS_KEY }),
  });
}
