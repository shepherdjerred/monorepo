import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";

import { useTRPC } from "./trpc.ts";

export function DocumentChanges(): React.JSX.Element | null {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const invalidateAll = (): void => {
    void queryClient.invalidateQueries({
      queryKey: trpc.documents.list.queryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.documents.byId.pathKey(),
    });
  };

  useSubscription(
    trpc.documents.changes.subscriptionOptions(undefined, {
      onStarted: invalidateAll,
      onData: (event) => {
        void queryClient.invalidateQueries({
          queryKey: trpc.documents.list.queryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey:
            event.documentId === null
              ? trpc.documents.byId.pathKey()
              : trpc.documents.byId.queryKey({ id: event.documentId }),
        });
      },
    }),
  );

  return null;
}
