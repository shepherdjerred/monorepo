import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { PlayerCard } from "./player-card.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import "@shepherdjerred/streambot/web/client/styles/player.css";

const STOP_COPY = {
  unauthorized: "Your sign-in expired. Reload the page to sign in again.",
  guild_denied: "You no longer share this server with Streambot.",
  feature_disabled: "The web remote is not enabled for this server.",
} as const;

/** Whether the live view is current, said only when it is not. */
function ConnectionNote() {
  const remote = useRemote();
  const { connection } = remote;
  if (connection.status === "live") return null;
  if (connection.status === "stopped")
    return (
      <p className="rail-note" role="status">
        {STOP_COPY[connection.reason]}{" "}
        <button
          type="button"
          className="status-link"
          onClick={remote.reconnect}
        >
          Try again
        </button>
      </p>
    );
  if (remote.view === null) return null;
  return (
    <p className="rail-note" role="status">
      Reconnecting… what you see may be out of date.
    </p>
  );
}

/** Listening first, then each Watching stream in slot order, numbered from 1. */
export function railOrder(
  players: readonly WebRoomPlayer[],
): { player: WebRoomPlayer; streamNumber: number }[] {
  const sorted = players.toSorted((left, right) =>
    left.transport === right.transport
      ? left.slot - right.slot
      : left.transport === "listen"
        ? -1
        : 1,
  );
  return sorted.map((player) => ({
    player,
    streamNumber:
      sorted
        .filter((other) => other.transport === player.transport)
        .indexOf(player) + 1,
  }));
}

/** The right-hand rail: the truth about what plays in the viewer's voice channel. */
export function Rail() {
  const remote = useRemote();
  const { room } = remote;
  return (
    <aside className="rail" aria-label="Playing in your voice channel">
      <ConnectionNote />
      {room === null ? (
        <div className="player player-empty" aria-busy="true">
          <p className="muted">Connecting to your voice channel…</p>
        </div>
      ) : room.location === null ? (
        <div className="player player-empty">
          <h2 className="player-heading">Not in a voice channel</h2>
          <p>Join a voice channel in Discord to play.</p>
          <p className="muted">
            Search and browsing still work; Listen and Watch turn on once
            Streambot sees you in a voice channel.
          </p>
        </div>
      ) : room.players.length === 0 ? (
        <div className="player player-empty">
          <h2 className="player-heading">
            Nothing playing in {room.location.channel.name}
          </h2>
          <p className="muted">
            Find something, then choose Listen or Watch. Its player appears
            here.
          </p>
        </div>
      ) : (
        railOrder(room.players).map(({ player, streamNumber }) => (
          <PlayerCard
            key={player.slot}
            player={player}
            streamNumber={streamNumber}
          />
        ))
      )}
    </aside>
  );
}
