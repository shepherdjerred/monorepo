import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";

import { useTRPC } from "./trpc.ts";

export function Changes(): React.JSX.Element | null {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: trpc.summary.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.alerts.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.events.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.system.pathKey() });
  };
  useSubscription(
    trpc.changes.subscriptionOptions(undefined, {
      onData: invalidate,
      onStarted: invalidate,
    }),
  );
  return null;
}
