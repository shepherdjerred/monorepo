import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";

import { opsKeys } from "./ops/ops-api.ts";
import { reportsKeys } from "./reports/reports-api.ts";
import { useTRPC } from "./trpc.ts";

export function Changes(): React.JSX.Element | null {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: trpc.summary.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.alerts.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.events.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.system.pathKey() });
    void queryClient.invalidateQueries({ queryKey: reportsKeys.all });
  };
  useSubscription(
    trpc.changes.subscriptionOptions(undefined, {
      onData: (change) => {
        // A new snapshot refreshes the ops views; report ingests refresh the
        // reports explorer; alert/email changes refresh the ledger views.
        if (change.reason === "ops") {
          void queryClient.invalidateQueries({ queryKey: opsKeys.snapshot() });
          void queryClient.invalidateQueries({
            queryKey: [...opsKeys.all, "changes"],
          });
          return;
        }
        if (change.reason === "reports") {
          void queryClient.invalidateQueries({ queryKey: reportsKeys.all });
          return;
        }
        invalidate();
      },
      onStarted: invalidate,
    }),
  );
  return null;
}
