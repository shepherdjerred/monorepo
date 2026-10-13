import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DiscordGuildIdSchema,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import { CustomOperationStatus } from "@/components/operation-status";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";

/** Old cleanups stay separate from the guild's current night and its controls. */
export function ExpiredCustomCleanups() {
  const session = useActivitySession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const input = { guildId: DiscordGuildIdSchema.parse(session.guildId) };
  const pending = useQuery({
    ...trpc.customs.pendingCleanups.queryOptions(input),
    refetchInterval: 10_000,
  });
  const update = (snapshot: CustomNightSnapshot) => {
    setError(null);
    queryClient.setQueryData<CustomNightSnapshot[]>(
      trpc.customs.pendingCleanups.queryKey(input),
      (current) =>
        current?.map((night) => (night.id === snapshot.id ? snapshot : night)),
    );
  };
  if (
    pending.isPending ||
    (error === null && pending.error === null && pending.data.length === 0)
  )
    return null;
  return (
    <aside
      className="activity-shell expired-cleanups"
      aria-label="Expired night cleanup"
    >
      {pending.error === null ? null : (
        <p className="error-banner">
          Unable to read expired voice cleanup: {pending.error.message}
        </p>
      )}
      {error === null ? null : <p className="error-banner">{error}</p>}
      {pending.data?.map((snapshot) => (
        <CustomOperationStatus
          key={snapshot.id}
          snapshot={snapshot}
          viewerId={session.identity.id}
          onSnapshot={update}
          onError={(cause) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          }}
        />
      ))}
    </aside>
  );
}
