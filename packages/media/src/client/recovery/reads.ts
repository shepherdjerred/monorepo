import { useQuery } from "@tanstack/react-query";
import { RecoveryListSchema } from "#shared/recovery.ts";
import { readApi } from "#client/api.ts";

/** The reviews a reader may open and, for the owner, what a restore left held. */
export function useRecoveryList() {
  return useQuery({
    queryKey: ["recovery"],
    queryFn: () => readApi("/recovery", RecoveryListSchema),
  });
}
