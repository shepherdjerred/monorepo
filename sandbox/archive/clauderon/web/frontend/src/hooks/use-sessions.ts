import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Session, HealthCheckResult } from "@clauderon/shared";

export function useSessions() {
  return useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: () => apiClient.listSessions(),
    staleTime: 5000,
    refetchInterval: 30_000,
  });
}

export function useHealthReports() {
  return useQuery<HealthCheckResult>({
    queryKey: ["health"],
    queryFn: () => apiClient.getHealth(),
    staleTime: 10_000,
  });
}
