import type { SessionView } from "@arcade/common/catalog.ts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DiscordIdSchema,
  GameIdSchema,
  games,
  type GameId,
} from "@arcade/common/catalog.ts";
import { ServersSchema } from "@arcade/common/protocol.ts";
import {
  useMe,
  signIn,
  useSignOut,
} from "@shepherdjerred/discord-plays-web/session/me.ts";
import { clientModules } from "./games/registry.ts";
import { useRoom, useStats, SessionConflict } from "./session.ts";
import { PlayStage, RoomControls, GoalForm } from "./room-controls.tsx";
import { Statistics } from "./stats.tsx";

export function App() {
  const segments = globalThis.location.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return <Catalog />;
  if (segments[0] === "games" && segments.length === 2) {
    const gameId = GameIdSchema.safeParse(segments[1]);
    if (gameId.success) return <Catalog selected={gameId.data} />;
  }
  if (
    segments[0] === "servers" &&
    segments[2] === "games" &&
    segments.length === 4
  ) {
    const guildId = DiscordIdSchema.safeParse(segments[1]);
    const gameId = GameIdSchema.safeParse(segments[3]);
    if (guildId.success && gameId.success)
      return <GameRoom guildId={guildId.data} gameId={gameId.data} />;
  }
  return (
    <main className="catalog">
      <h1>Room not found</h1>
      <a href="/">Back to Arcade</a>
    </main>
  );
}

function Catalog({ selected }: { readonly selected?: GameId }) {
  const { me } = useMe();
  const servers = useQuery({
    queryKey: ["servers"],
    enabled: me.signedIn,
    queryFn: async () => {
      const response = await fetch("/api/servers");
      if (!response.ok) throw new Error("Could not load your servers");
      return ServersSchema.parse(await response.json());
    },
  });
  return (
    <div className="arcade">
      <header className="arcade-header">
        <a className="brand" href="/">
          ARCADE
          <span className="brand-dot" />
        </a>
        <span className="header-note">GOOD GAMES. GOOD COMPANY.</span>
        {!me.signedIn && <button onClick={signIn}>Sign in with Discord</button>}
      </header>
      <main className="catalog">
        <div className="catalog-intro">
          <span className="eyebrow">YOUR DISCORD GAME NIGHT</span>
          <h1>
            Pick your next
            <br />
            <em>friendly rivalry.</em>
          </h1>
          <p>
            A shared screen, your own controller, and a record book for every
            game.
          </p>
        </div>
        <div className="game-catalog">
          {Object.values(clientModules).map((module) => (
            <a
              className={`game-tile theme-${module.definition.id} ${selected === module.definition.id ? "selected" : ""}`}
              href={`/games/${module.definition.id}`}
              key={module.definition.id}
            >
              <div className="tile-art">
                <span>{module.mark}</span>
                <i />
                <i />
                <i />
              </div>
              <div className="tile-copy">
                <span className="eyebrow">
                  {module.definition.family === "pokemon"
                    ? "SHARED ADVENTURE"
                    : "UP TO 4 PLAYERS"}
                </span>
                <h2>{module.definition.title}</h2>
                <p>{module.subtitle}</p>
                <strong>
                  Choose game <span aria-hidden="true">↗</span>
                </strong>
              </div>
            </a>
          ))}
        </div>
        {selected && (
          <section className="server-picker">
            <h2>Where are we playing?</h2>
            {me.signedIn ? (
              servers.isPending ? (
                <p>Finding your servers…</p>
              ) : servers.error ? (
                <p role="alert">Could not load your servers.</p>
              ) : servers.data.length === 0 ? (
                <p>
                  No shared servers found. Invite Arcade to your server to play.
                </p>
              ) : (
                <div className="server-list">
                  {servers.data.map((server) => (
                    <a
                      key={server.id}
                      href={`/servers/${server.id}/games/${selected}`}
                    >
                      <strong>{server.name}</strong>
                      <span>
                        {server.voiceChannelName ??
                          "Join a voice channel to play"}
                      </span>
                      <span aria-hidden="true">→</span>
                    </a>
                  ))}
                </div>
              )
            ) : (
              <p>
                <button onClick={signIn}>Sign in with Discord</button> to choose
                a server. Public room links work without signing in.
              </p>
            )}
          </section>
        )}
        <p className="catalog-footer">
          One arcade. Five ways to spend the evening.
        </p>
      </main>
    </div>
  );
}

function GameRoom({
  guildId,
  gameId,
}: {
  readonly guildId: string;
  readonly gameId: GameId;
}) {
  const connection = useRoom(guildId, gameId);
  const { me } = useMe();
  const signOut = useSignOut(connection.socket);
  const stats = useStats(guildId, gameId);
  const { action, busy, actionError, occupiedRoom } = useRoomAction();
  const module = clientModules[gameId];
  const room = connection.snapshot;
  const session = room?.session ?? null;
  const access =
    connection.access?.sessionId === session?.id ? connection.access : null;
  const notice = actionError ?? connection.error ?? room?.error ?? null;
  return (
    <div className={`arcade theme-${gameId}`}>
      <header className="arcade-header">
        <a className="brand" href="/">
          ARCADE
          <span className="brand-dot" />
        </a>
        <a className="back-link" href="/">
          ← All games
        </a>
        <div className="account">
          {me.signedIn ? (
            <>
              <span>{me.user.name}</span>
              <button
                onClick={() => {
                  void action(signOut);
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button onClick={signIn}>Sign in with Discord</button>
          )}
        </div>
      </header>
      <main className="room-page">
        <GameHeading
          gameId={gameId}
          session={session}
          connected={connection.connected}
        />
        {notice !== null && (
          <p role="alert" className="notice">
            {notice}
            {occupiedRoom !== null && (
              <>
                {" "}
                <a href={occupiedRoom}>Open the active game →</a>
              </>
            )}
          </p>
        )}
        <PlayStage
          gameId={gameId}
          guildId={guildId}
          connection={connection}
          session={session}
          access={access}
          signedIn={me.signedIn}
          busy={busy}
          action={action}
        />
        {room && (
          <>
            <RoomControls connection={connection} room={room} access={access} />
            <module.Page room={room} stats={stats.data} />
            {gameId === "emerald" && (
              <AdventureGoal
                session={session}
                viewerId={me.signedIn ? me.user.discordId : null}
                busy={busy}
                action={action}
              />
            )}
          </>
        )}
        <Statistics
          guildId={guildId}
          gameId={gameId}
          viewerId={me.signedIn ? me.user.discordId : undefined}
        />
      </main>
    </div>
  );
}

function useRoomAction() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [occupiedRoom, setOccupiedRoom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    setOccupiedRoom(null);
    try {
      await work();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Request failed");
      if (error instanceof SessionConflict)
        setOccupiedRoom(
          `/servers/${error.session.guildId}/games/${error.session.gameId}`,
        );
    } finally {
      setBusy(false);
    }
  };
  return { action, busy, actionError, occupiedRoom };
}

function AdventureGoal({
  session,
  viewerId,
  busy,
  action,
}: {
  readonly session: SessionView | null;
  readonly viewerId: string | null;
  readonly busy: boolean;
  readonly action: (work: () => Promise<void>) => Promise<void>;
}) {
  return session !== null && session.startedByUserId === viewerId ? (
    <GoalForm sessionId={session.id} busy={busy} action={action} />
  ) : null;
}

function GameHeading({
  gameId,
  session,
  connected,
}: {
  readonly gameId: GameId;
  readonly session: SessionView | null;
  readonly connected: boolean;
}) {
  const module = clientModules[gameId];
  return (
    <div className="game-heading">
      <div>
        <span className="eyebrow">{module.subtitle}</span>
        <h1>{games[gameId].title}</h1>
      </div>
      <span className={`connection-status ${connected ? "connected" : ""}`}>
        <i />
        {connected
          ? session?.phase === "running"
            ? "GAME IN PROGRESS"
            : (session?.phase.toUpperCase() ?? "READY TO PLAY")
          : "RECONNECTING"}
      </span>
    </div>
  );
}
