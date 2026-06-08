import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

export function useBenchmarkDrift() {
  return useQuery({
    queryKey: ["benchmarks", "drift"],
    queryFn: () => api.benchmarks.drift(),
    refetchInterval: 30000,
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

export type BenchEventStatus = "connecting" | "running" | "done" | "error" | "closed";

const MAX_CLIENT_LINES = 1000;

export function useBenchmarkEvents(runId: string | null, enabled: boolean) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<BenchEventStatus>("connecting");
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    if (!runId || !enabled) {
      setLines([]);
      setStatus("connecting");
      setExitCode(null);
      return;
    }
    const es = new EventSource(`/api/benchmarks/runs/${encodeURIComponent(runId)}/events`);
    setLines([]);
    setStatus("connecting");
    setExitCode(null);

    es.addEventListener("log", (evt) => {
      try {
        const line = JSON.parse((evt as MessageEvent).data) as string;
        setLines((prev) => {
          const next = prev.length >= MAX_CLIENT_LINES ? prev.slice(1) : prev;
          return [...next, line];
        });
        setStatus((s) => (s === "connecting" ? "running" : s));
      } catch {
        /* malformed line — drop */
      }
    });

    es.addEventListener("status", (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as {
          status: "running" | "done" | "error";
          exitCode: number | null;
        };
        setStatus(payload.status);
        setExitCode(payload.exitCode);
        if (payload.status !== "running") es.close();
      } catch {
        /* ignore */
      }
    });

    es.onerror = () => {
      setStatus((s) => (s === "running" || s === "connecting" ? "error" : s));
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId, enabled]);

  return { lines, status, exitCode };
}
