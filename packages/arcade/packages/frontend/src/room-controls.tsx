import { useState, type ReactNode } from "react";
import { type GameId, type SessionView } from "@arcade/common/catalog.ts";
import type { Access, RoomSnapshot } from "@arcade/common/protocol.ts";
import { useDriverFeed } from "@shepherdjerred/discord-plays-web/feed/use-driver-feed.ts";
import { useFeedSound } from "@shepherdjerred/discord-plays-web/feed/use-feed-sound.ts";
import { DRIVER_FEED_PATH } from "@shepherdjerred/discord-plays-core/driver-feed/protocol.ts";
import { Controller, SharedController } from "./controller.tsx";
import { mutate, type RoomConnection } from "./session.ts";
export function PlayStage({
  gameId,
  guildId,
  connection,
  session,
  access,
  signedIn,
  busy,
  action,
  art,
}: {
  readonly gameId: GameId;
  readonly guildId: string;
  readonly connection: RoomConnection;
  readonly session: SessionView | null;
  readonly access: Access | null;
  readonly signedIn: boolean;
  readonly busy: boolean;
  readonly action: (work: () => Promise<void>) => Promise<void>;
  readonly art: ReactNode;
}) {
  return (
    <section className="play-stage">
      <div className="video-stage">
        {session && access?.canWatch === true ? (
          <LiveFeed
            sessionId={session.id}
            socketId={connection.socket.id ?? ""}
          />
        ) : (
          <div className="stage-idle">
            <div className="stage-art" aria-hidden="true">
              {art}
            </div>
            <h2>
              {session
                ? "Grab a controller. Join the game."
                : "The next game starts with you."}
            </h2>
            <p>
              {session
                ? gameId === "emerald"
                  ? "Join the voice channel to watch and play here."
                  : "Claim a seat for your live player view. Spectators can watch in Discord."
                : "Join a Discord voice channel, then start a session."}
            </p>
            {!session && (
              <button
                className="primary"
                disabled={busy || !signedIn || !connection.connected}
                onClick={() => {
                  void action(() =>
                    mutate("/api/sessions", "POST", { guildId, gameId }),
                  );
                }}
              >
                {busy ? "Starting…" : "Start game"}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="session-bar">
        <span>
          {session
            ? gameId === "emerald"
              ? "One shared adventure. Everyone plays."
              : "One shared screen. Your own controls."
            : "Your server’s saves and records are waiting."}
        </span>
        {session && access?.canStop === true && (
          <button
            disabled={busy}
            onClick={() => {
              void action(() =>
                mutate(`/api/sessions/${session.id}`, "DELETE"),
              );
            }}
          >
            Stop game
          </button>
        )}
      </div>
    </section>
  );
}

type ControlsProps = {
  readonly connection: RoomConnection;
  readonly room: RoomSnapshot;
  readonly access: Access | null;
};

export function RoomSeats({ connection, room, access }: ControlsProps) {
  const session = room.session;
  return (
    <div className="seat-strip">
      {room.seats.map((player, seat) => (
        <div
          className={`seat player-${String(seat)} ${access?.seat === seat ? "yours" : ""}`}
          key={seat}
        >
          <span className="seat-number">P{seat + 1}</span>
          <div>
            <strong>{player?.name ?? "Open seat"}</strong>
            <span>
              {access?.seat === seat
                ? "YOUR CONTROLLER"
                : player
                  ? "PLAYING"
                  : "READY FOR YOU"}
            </span>
          </div>
          {access?.seat === seat ? (
            <button
              onClick={() => {
                if (session)
                  connection.send({ kind: "release", sessionId: session.id });
              }}
            >
              Leave seat
            </button>
          ) : (
            player === null && (
              <button
                disabled={access?.canPlay !== true || !session}
                onClick={() => {
                  if (session)
                    connection.send({
                      kind: "claim",
                      sessionId: session.id,
                      seat,
                    });
                }}
              >
                Join
              </button>
            )
          )}
        </div>
      ))}
    </div>
  );
}

export function RoomController({ connection, room, access }: ControlsProps) {
  const session = room.session;
  const sendCommand = (command: string) => {
    if (session !== null)
      connection.send({ kind: "command", sessionId: session.id, command });
  };
  return (
    <>
      {session &&
        (room.gameId === "emerald" ? (
          <SharedController
            enabled={access?.canPlay === true}
            send={sendCommand}
          />
        ) : (
          access?.seat !== null &&
          access?.seat !== undefined && (
            <Controller
              enabled={access.canPlay && connection.connected}
              n64={room.gameId === "mk64"}
              send={(state) => {
                connection.send({
                  kind: "input",
                  sessionId: session.id,
                  state,
                });
              }}
            />
          )
        ))}
      {access?.reason !== null && access?.reason !== undefined && (
        <p className="play-reason" role="status">
          {access.reason}
        </p>
      )}
    </>
  );
}

export function RoomControls(props: ControlsProps) {
  return (
    <>
      <RoomSeats {...props} />
      <RoomController {...props} />
    </>
  );
}

export function GoalForm({
  sessionId,
  busy,
  action,
}: {
  readonly sessionId: string;
  readonly busy: boolean;
  readonly action: (work: () => Promise<void>) => Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  return (
    <section className="panel goal-form">
      <h2>Give the adventure a goal</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (goal.trim())
            void action(() =>
              mutate(`/api/sessions/${sessionId}/goal`, "POST", {
                objective: goal.trim(),
              }),
            );
        }}
      >
        <label htmlFor="goal">What should we do next?</label>
        <div className="form-row">
          <input
            id="goal"
            value={goal}
            onChange={(event) => {
              setGoal(event.target.value);
            }}
            maxLength={1000}
            placeholder="Catch a new companion"
          />
          <button disabled={busy || !goal.trim()}>Set goal</button>
        </div>
      </form>
    </section>
  );
}

function LiveFeed({
  sessionId,
  socketId,
}: {
  readonly sessionId: string;
  readonly socketId: string;
}) {
  const sound = useFeedSound("arcade-muted");
  const feed = useDriverFeed({
    path: `${DRIVER_FEED_PATH}/${sessionId}`,
    query: { socketId },
    onAudio: sound.play,
  });
  return (
    <div className="live-feed">
      <canvas ref={feed.canvasRef} aria-label="Live game video" />
      <span className="feed-status">
        {feed.status.kind === "playing"
          ? "LIVE"
          : feed.status.kind.toUpperCase()}
      </span>
      <button className="sound-toggle" onClick={sound.toggleMuted}>
        {sound.muted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}
