import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { useTRPC } from "@/lib/activity-api";
import { newestCustomSnapshot } from "@/lib/newest-custom-snapshot";
import { toast } from "@scout-for-lol/design-system/components/toaster";

export type SnapshotResult = {
  snapshot: CustomNightSnapshot;
  applied?: boolean;
};

export function useApplyCustomSnapshot() {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  return useCallback(
    (result: SnapshotResult) => {
      if (result.applied === false) {
        toast.error("The night changed before that action was applied.");
      }
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
