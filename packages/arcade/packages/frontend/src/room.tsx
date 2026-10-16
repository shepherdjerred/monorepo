import { useState, type ReactNode } from "react";
import type { GameId } from "@arcade/common/catalog.ts";
import {
  useMe,
  signIn,
  useSignOut,
} from "@shepherdjerred/discord-plays-web/session/me.ts";
import { useRoom, useStats, SessionConflict } from "./session.ts";
import {
  PlayStage,
  RoomControls,
  RoomSeats,
  RoomController,
  GoalForm,
} from "./room-controls.tsx";
import { Statistics } from "./stats.tsx";

/** Transport and authority are shared; each game owns its complete presentation. */
export function useGameRoom(guildId: string, gameId: GameId) {
  const connection = useRoom(guildId, gameId);
  const { me } = useMe();
  const signOut = useSignOut(connection.socket);
  const stats = useStats(guildId, gameId);
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
  const room = connection.snapshot;
  const session = room?.session ?? null;
  return {
    gameId,
    guildId,
    connection,
    room,
    session,
    access:
      connection.access?.sessionId === session?.id ? connection.access : null,
    me,
    stats: stats.data,
    notice: actionError ?? connection.error ?? room?.error ?? null,
    occupiedRoom,
    busy,
    action,
    signOut: () => action(signOut),
  };
}

export type GameRoomModel = ReturnType<typeof useGameRoom>;

export function RoomAccount({ model }: { readonly model: GameRoomModel }) {
  return (
    <div className="account">
      {model.me.signedIn ? (
        <>
          <span>{model.me.user.name}</span>
          <button disabled={model.busy} onClick={() => void model.signOut()}>
            Sign out
          </button>
        </>
      ) : (
        <button onClick={signIn}>Sign in with Discord</button>
      )}
    </div>
  );
}

export function RoomStatus({ model }: { readonly model: GameRoomModel }) {
  return (
    <span
      className={`connection-status ${model.connection.connected ? "connected" : ""}`}
      role="status"
    >
      <i aria-hidden="true" />
      {model.connection.connected
        ? model.session?.phase === "running"
          ? "GAME IN PROGRESS"
          : (model.session?.phase.toUpperCase() ?? "READY TO PLAY")
        : "RECONNECTING"}
    </span>
  );
}

export function RoomNotice({ model }: { readonly model: GameRoomModel }) {
  return model.notice === null ? null : (
    <p role="alert" className="notice">
      {model.notice}
      {model.occupiedRoom !== null && (
        <>
          {" "}
          <a href={model.occupiedRoom}>Open the active game →</a>
        </>
      )}
    </p>
  );
}

export function GameStage({
  model,
  art,
}: {
  readonly model: GameRoomModel;
  readonly art: ReactNode;
}) {
  return (
    <PlayStage
      gameId={model.gameId}
      guildId={model.guildId}
      connection={model.connection}
      session={model.session}
      access={model.access}
      signedIn={model.me.signedIn}
      busy={model.busy}
      action={model.action}
      art={art}
    />
  );
}

export function GameControls({ model }: { readonly model: GameRoomModel }) {
  return model.room === null ? null : (
    <RoomControls
      connection={model.connection}
      room={model.room}
      access={model.access}
    />
  );
}

export function GameSeats({ model }: { readonly model: GameRoomModel }) {
  return model.room === null ? null : (
    <RoomSeats
      connection={model.connection}
      room={model.room}
      access={model.access}
    />
  );
}

export function GameController({ model }: { readonly model: GameRoomModel }) {
  return model.room === null ? null : (
    <RoomController
      connection={model.connection}
      room={model.room}
      access={model.access}
    />
  );
}

export function GameRecords({ model }: { readonly model: GameRoomModel }) {
  return (
    <Statistics
      guildId={model.guildId}
      gameId={model.gameId}
      viewerId={model.me.signedIn ? model.me.user.discordId : undefined}
    />
  );
}

export function AdventureGoal({ model }: { readonly model: GameRoomModel }) {
  return model.session !== null &&
    model.me.signedIn &&
    model.session.startedByUserId === model.me.user.discordId ? (
    <GoalForm
      sessionId={model.session.id}
      busy={model.busy}
      action={model.action}
    />
  ) : null;
}
