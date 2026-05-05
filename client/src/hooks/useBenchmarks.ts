import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type BenchTriggerInput } from "@/lib/api";

export function useBenchmarkRuns() {
  return useQuery({
    queryKey: ["benchmarks", "runs"],
    queryFn: () => api.benchmarks.listRuns(),
    refetchInterval: 5000,
  });
}

export function useBenchmarkRun(id: string | null) {
  return useQuery({
    queryKey: ["benchmarks", "run", id],
    queryFn: () => api.benchmarks.getRun(id!),
    enabled: !!id,
  });
}

export function useBenchmarkFixtures() {
  return useQuery({
    queryKey: ["benchmarks", "fixtures"],
    queryFn: () => api.benchmarks.fixtures(),
  });
}

export function useBenchmarkAggregate() {
  return useQuery({
    queryKey: ["benchmarks", "aggregate"],
    queryFn: () => api.benchmarks.aggregate(),
    refetchInterval: 10000,
  });
}

export function useBenchmarkActive() {
  return useQuery({
    queryKey: ["benchmarks", "active"],
    queryFn: () => api.benchmarks.active(),
    refetchInterval: 2000,
  });
}

export function useTriggerBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BenchTriggerInput) => api.benchmarks.trigger(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["benchmarks", "runs"] });
      qc.invalidateQueries({ queryKey: ["benchmarks", "active"] });
    },
  });
}
