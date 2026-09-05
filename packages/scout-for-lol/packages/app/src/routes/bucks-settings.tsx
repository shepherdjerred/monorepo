import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { BucksNotificationPreferencesForm } from "#src/components/bucks/bucks-notification-preferences-form.tsx";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { useBucksGuild } from "#src/routes/bucks-workspace.tsx";

export function BucksSettings() {
  const { guildId } = useBucksGuild();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const query = useQuery(
    trpc.bucks.notificationPreferences.queryOptions({ guildId }),
  );
  const mutation = useMutation(
    trpc.bucks.setNotificationPreferences.mutationOptions({
      meta: analyticsMeta("bucks_notification_prefs_updated"),
      onSuccess: (preferences) => {
        setError(null);
        // The server answered with the canonical row; adopt it directly.
        queryClient.setQueryData(
          trpc.bucks.notificationPreferences.queryKey({ guildId }),
          preferences,
        );
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );

  if (query.isPending) {
    return <LoadingState label="Loading your preferences…" />;
  }
  if (query.isError) {
    return (
      <ErrorState
        message="Scout couldn't load your Bryan Bucks preferences."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  return (
    <BucksNotificationPreferencesForm
      preferences={query.data}
      pending={mutation.isPending}
      error={error}
      onSubmit={(preferences) => {
        mutation.mutate({ guildId, ...preferences });
      }}
    />
  );
}
