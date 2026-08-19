import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { Skeleton } from "@scout-for-lol/design-system/components/skeleton";
import { Toaster } from "@scout-for-lol/design-system/components/toaster";
import { useEffect } from "react";
import { CustomsDashboard } from "@/components/customs-dashboard";
import { JoinNight } from "@/components/join-night";
import { StartNight } from "@/components/start-night";
import { fireAndForget } from "@/lib/fire-and-forget";
import { newestCustomSnapshot } from "@/lib/newest-custom-snapshot";
import { useCustomSocket } from "@/hooks/use-custom-socket";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";

function ActivityContent() {
  const session = useActivitySession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const activeQuery = trpc.customs.active.queryOptions();
  const active = useQuery({
    ...activeQuery,
    queryFn: async (context) => {
      const queryFn = activeQuery.queryFn;
      if (queryFn === undefined)
        throw new Error("Customs active query is missing its query function");
      const candidate = await queryFn(context);
      const current = queryClient.getQueryData<CustomNightSnapshot | null>(
        trpc.customs.active.queryKey(),
      );
      return newestCustomSnapshot(current, candidate);
    },
  });
  useCustomSocket();

  useEffect(() => {
    if (active.data === undefined) return;
    const ready = active.data?.recruitmentCounts.ready ?? 0;
    fireAndForget(
      () => session.sdk.setReadyPresence(ready),
      "ready-presence update",
    );
  }, [active.data, session.sdk]);

  if (active.isPending) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-5">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }
  if (active.isError) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <p>Couldn’t load this server’s Customs night: {active.error.message}</p>
      </main>
    );
  }
  const snapshot = active.data;
  if (snapshot === null || snapshot.state === "ENDED") return <StartNight />;
  const joined = snapshot.participants.some(
    (participant) => participant.discordId === session.identity.id,
  );
  return joined ? (
    <CustomsDashboard snapshot={snapshot} />
  ) : (
    <JoinNight snapshot={snapshot} />
  );
}

export function App() {
  return (
    <>
      <ActivityContent />
      <Toaster position="top-center" />
    </>
  );
}
