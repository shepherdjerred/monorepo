import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { AuthStatus } from "@clauderon/shared";

export function useAuthStatus() {
  return useQuery<AuthStatus>({
    queryKey: ["auth-status"],
    queryFn: async () => {
      try {
        return await apiClient.getAuthStatus();
      } catch (error) {
        // 404 means auth is not enabled (localhost mode) — expected
        if (
          error instanceof Error &&
          error.message.includes("Authentication not enabled")
        ) {
          return { requires_auth: false, has_users: false } as AuthStatus;
        }
        throw error;
      }
    },
    retry: 2,
    staleTime: 60_000,
  });
}
