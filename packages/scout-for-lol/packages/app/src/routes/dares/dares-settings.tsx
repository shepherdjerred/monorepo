import { Loaded } from "@shepherdjerred/loaded";
import { useDelayedLoading } from "@shepherdjerred/loaded/react.tsx";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ErrorState,
  LoadingState,
  StaleState,
} from "@scout-for-lol/design-system/domain/states";
import { DareNotificationPreferencesForm } from "#src/components/dares/dares-notification-preferences-form.tsx";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { useDaresGuild } from "#src/routes/dares/dares-workspace.tsx";

export function DaresSettings() {
  const { guildId } = useDaresGuild();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const query = useQuery(
    trpc.dares.notificationPreferences.queryOptions({ guildId }),
  );
  const mutation = useMutation(
    trpc.dares.setNotificationPreferences.mutationOptions({
      meta: analyticsMeta("dare_notification_prefs_updated"),
      onSuccess: (preferences) => {
        setError(null);
        // The server answered with the canonical row; adopt it directly.
        queryClient.setQueryData(
          trpc.dares.notificationPreferences.queryKey({ guildId }),
          preferences,
        );
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );

  const value = Loaded.fromQuery(query, ["dares.settings"]);
  const showLoading = useDelayedLoading(value.status === "loading");
  if (value.status === "error") {
    return (
      <ErrorState
        message="Scout couldn't load your Dares preferences."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (showLoading) {
    return <LoadingState label="Loading your preferences…" />;
  }
  if (value.status === "loading") {
    return null;
  }
  return (
    <>
      <StaleState errors={value.status === "degraded" ? value.errors : []} />
      <DareNotificationPreferencesForm
        preferences={value.data}
        pending={mutation.isPending}
        error={error}
        onSubmit={(preferences) => {
          mutation.mutate({ guildId, ...preferences });
        }}
      />
    </>
  );
}
