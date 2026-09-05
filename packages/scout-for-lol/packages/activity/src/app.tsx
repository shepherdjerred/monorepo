import { Loaded } from "@shepherdjerred/loaded";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DiscordGuildIdSchema,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import { GameControls } from "@/components/game-controls";
import { PlayerList } from "@/components/player-list";
import {
  revision,
  runSnapshotAction,
  StatePill,
} from "@/components/activity-shared";
import { useCustomSocket } from "@/hooks/use-custom-socket";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";
import { newestCustomSnapshot } from "@/lib/newest-custom-snapshot";

function CustomsExperience({ snapshot }: { snapshot: CustomNightSnapshot }) {
  const session = useActivitySession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const leave = useMutation(trpc.customs.leaveNight.mutationOptions());
  const end = useMutation(trpc.customs.endNight.mutationOptions());
  const guildInput = useMemo(
    () => ({ guildId: DiscordGuildIdSchema.parse(session.guildId) }),
    [session.guildId],
  );
  const update = (next: CustomNightSnapshot): void => {
    setError(null);
    queryClient.setQueryData<CustomNightSnapshot | null>(
      trpc.customs.active.queryKey(guildInput),
      (current) => newestCustomSnapshot(current, next),
    );
  };
  const fail = (cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : String(cause));
  };
  const callbacks = { onSnapshot: update, onError: fail };
  const manager = ["HOST", "COHOST", "ADMIN"].includes(snapshot.viewerRole);
  const viewerInCurrentRoster =
    snapshot.currentGame?.participants.some(
      (participant) => participant.discordId === session.identity.id,
    ) === true;

  return (
    <main className="activity-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">{snapshot.guildName}</p>
          <h1>Scout Customs</h1>
        </div>
        <StatePill state={snapshot.state} />
      </header>
      {error === null ? null : <p className="error-banner">{error}</p>}
      <GameControls
        {...callbacks}
        snapshot={snapshot}
        viewerId={session.identity.id}
      />
      <PlayerList
        {...callbacks}
        snapshot={snapshot}
        viewerId={session.identity.id}
      />
      <footer className="footer-actions">
        {manager || viewerInCurrentRoster ? null : (
          <button
            className="button subtle"
            onClick={() => {
              void runSnapshotAction(
                leave.mutateAsync(revision(snapshot)),
                callbacks,
              );
            }}
            type="button"
          >
            Leave night
          </button>
        )}
        {manager ? (
          <button
            className="button danger"
            onClick={() => {
              void runSnapshotAction(
                end.mutateAsync(revision(snapshot)),
                callbacks,
              );
            }}
            type="button"
          >
            End night
          </button>
        ) : null}
      </footer>
    </main>
  );
}

function ActivityContent() {
  const session = useActivitySession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const guildInput = useMemo(
    () => ({ guildId: DiscordGuildIdSchema.parse(session.guildId) }),
    [session.guildId],
  );
  const active = useQuery(trpc.customs.active.queryOptions(guildInput));
  const start = useMutation(trpc.customs.startNight.mutationOptions());
  const join = useMutation(trpc.customs.joinNight.mutationOptions());
  useCustomSocket();
  const cache = (snapshot: CustomNightSnapshot): void => {
    setError(null);
    queryClient.setQueryData<CustomNightSnapshot | null>(
      trpc.customs.active.queryKey(guildInput),
      (current) => newestCustomSnapshot(current, snapshot),
    );
  };
  const fail = (cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : String(cause));
  };
  const callbacks = { onSnapshot: cache, onError: fail };

  // `error` here means the night could not be read at all. A refetch that
  // failed over a snapshot already on screen is `degraded`, and falls through
  // to render it — dropping a live customs night because one poll failed would
  // be worse than showing a slightly stale one.
  const night = Loaded.fromQuery(active, ["customs"]);
  if (night.status === "loading") {
    return <main className="centered">Loading this server’s night…</main>;
  }
  if (night.status === "error") {
    return (
      <main className="centered">
        {Loaded.messageOf(night.errors[0].error)}
      </main>
    );
  }
  const stale = night.status === "degraded";
  if (night.data === null || night.data.state === "ENDED") {
    return (
      <main className="centered">
        {stale ? <StaleBanner /> : null}
        <section className="panel welcome">
          <p className="eyebrow">Beta</p>
          <h1>Scout Customs</h1>
          <p>
            Recruit, draft, move into team voice, and play Riot-verified custom
            games.
          </p>
          <p>
            Starting records consent to private game participation, account,
            champion, and Riot result history for this server.
          </p>
          {error === null ? null : <p className="error-banner">{error}</p>}
          <button
            className="button primary"
            onClick={() => {
              void runSnapshotAction(start.mutateAsync({}), callbacks);
            }}
            type="button"
          >
            Accept and start a custom night
          </button>
        </section>
      </main>
    );
  }
  const snapshot = night.data;
  const joined = snapshot.participants.some(
    (participant) => participant.discordId === session.identity.id,
  );
  const manager = ["HOST", "COHOST", "ADMIN"].includes(snapshot.viewerRole);
  if (joined || manager) {
    // The live view is the branch that most needs this: stale teams, roles and
    // controls presented as synchronized are worse than a stale lobby screen.
    return (
      <>
        {stale ? <StaleBanner /> : null}
        <CustomsExperience snapshot={snapshot} />
      </>
    );
  }

  return (
    <main className="centered">
      {stale ? <StaleBanner /> : null}
      <section className="panel welcome">
        <h1>{snapshot.guildName} Customs</h1>
        <p>
          Joining records consent to private game participation, account,
          champion, and Riot result history for this server.
        </p>
        {error === null ? null : <p className="error-banner">{error}</p>}
        <button
          className="button primary"
          onClick={() => {
            void runSnapshotAction(
              join.mutateAsync({
                ...revision(snapshot),
              }),
              callbacks,
            );
          }}
          type="button"
        >
          Consent and join
        </button>
      </section>
    </main>
  );
}

/**
 * A customs night is live state, so a snapshot that stopped updating is
 * misleading in a way a stale list is not — including the "no night yet"
 * screen, which is just as cacheable as a running one.
 */
function StaleBanner() {
  return (
    <p className="stale-banner" role="status">
      Showing the last synced night — reconnecting.
    </p>
  );
}

export function App() {
  return <ActivityContent />;
}
