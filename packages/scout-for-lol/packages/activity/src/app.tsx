import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { CustomsDashboard } from "@/components/customs-dashboard";
import { JoinNight } from "@/components/join-night";
import { StartNight } from "@/components/start-night";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { useCustomSocket } from "@/hooks/use-custom-socket";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";

function ActivityContent() {
  const session = useActivitySession();
  const trpc = useTRPC();
  const active = useQuery(trpc.customs.active.queryOptions());
  useCustomSocket();

  useEffect(() => {
    if (active.data === undefined) return;
    void session.sdk.setReadyPresence(
      active.data?.recruitmentCounts.ready ?? 0,
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
