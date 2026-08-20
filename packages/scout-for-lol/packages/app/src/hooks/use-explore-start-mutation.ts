import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";

/** Start a run and make its new conversation visible in the sidebar at once. */
export function useExploreStartMutation() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.explore.start.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.explore.list.queryKey(),
        });
      },
    }),
  );
}
