import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { useTRPC } from "@/lib/activity-api";
import { newestCustomSnapshot } from "@/lib/newest-custom-snapshot";

export type SnapshotResult = {
  snapshot: CustomNightSnapshot;
  applied?: boolean;
};

export function useApplyCustomSnapshot() {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  return useCallback(
    (result: SnapshotResult) => {
      queryClient.setQueryData<CustomNightSnapshot | null>(
        trpc.customs.active.queryKey(),
        (current) => newestCustomSnapshot(current, result.snapshot),
      );
    },
    [queryClient, trpc.customs.active],
  );
}

export function mutationErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
