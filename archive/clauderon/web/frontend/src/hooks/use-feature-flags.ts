import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { FeatureFlagsResponse } from "@clauderon/shared";

export function useFeatureFlags() {
  return useQuery<FeatureFlagsResponse>({
    queryKey: ["feature-flags"],
    queryFn: () => apiClient.getFeatureFlags(),
    staleTime: 60_000,
  });
}
