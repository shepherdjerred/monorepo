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

type SnapshotMutation = () => Promise<SnapshotResult>;

export function useApplyCustomSnapshot() {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  return useCallback(
    async (mutation: SnapshotMutation): Promise<void> => {
      const queryKey = trpc.customs.active.queryKey();
      const currentAtRequest =
        queryClient.getQueryData<CustomNightSnapshot | null>(queryKey);
      const result = await mutation();
      if (result.applied === false) {
        toast.error("The night changed before that action was applied.");
      }
      queryClient.setQueryData<CustomNightSnapshot | null>(
        queryKey,
        (current) =>
          newestCustomSnapshot(
            current,
            result.snapshot,
            currentAtRequest,
            currentAtRequest === undefined,
          ),
      );
    },
    [queryClient, trpc.customs.active],
  );
}

export function mutationErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
