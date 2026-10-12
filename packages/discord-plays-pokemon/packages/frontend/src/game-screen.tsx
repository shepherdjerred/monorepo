import { useDriverFeed } from "@shepherdjerred/discord-plays-web/feed/use-driver-feed.ts";
import { useFeedSound } from "@shepherdjerred/discord-plays-web/feed/use-feed-sound.ts";
import type { DriverFeedStatus } from "@shepherdjerred/discord-plays-web/feed/driver-feed-client.ts";
import type { Game } from "./game.ts";
import { disabledReason } from "./game.ts";

function feedMessage(status: DriverFeedStatus): string | null {
  switch (status.kind) {
    case "playing":
      return null;
    case "connecting":
      return "Connecting to the live game…";
    case "waiting":
      return "Waiting for the next video frame…";
    case "unsupported":
      return "This browser cannot decode the live feed. Try a current version of Chrome or Edge.";
    case "error":
      return status.message;
  }
}

function LiveFeed() {
  const sound = useFeedSound("pokemon-feed-muted");
  const feed = useDriverFeed({ onAudio: sound.play });
  const message = feedMessage(feed.status);
  return (
    <>
      <div className="screen">
        <canvas
          ref={feed.canvasRef}
          width={240}
          height={160}
          aria-label="Live Pokémon Emerald game"
        />
        {message !== null && <ScreenMessage message={message} />}
      </div>
      <div className="screen-footer">
        <span>
          <i
            className={
              feed.status.kind === "playing" ? "status-dot live" : "status-dot"
            }
          />
          {feed.status.kind === "playing" ? "LIVE GAME" : "VIDEO CONNECTING"}
        </span>
        <button
          type="button"
          onClick={sound.toggleMuted}
          aria-pressed={sound.muted}
        >
          {sound.muted
            ? "Sound off"
            : sound.blocked
              ? "Tap to enable sound"
              : "Sound on"}
        </button>
      </div>
    </>
  );
}

function ScreenMessage({ message }: { readonly message: string }) {
  return (
    <div className="screen-message">
      <span className="pokeball" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

export function GameScreen({
  game,
  signedIn,
}: {
  readonly game: Game;
  readonly signedIn: boolean;
}) {
  const status = game.status;
  const admitted =
    game.connected &&
    signedIn &&
    status?.sessionActive === true &&
    (status.playBlocker === null || status.playBlocker === "too-few-players");
  const canWatch = admitted && status.driverFeedEnabled;
  const reason = admitted
    ? "The live feed is disabled for this session."
    : (disabledReason(game, signedIn) ?? "Checking the game session…");
  return (
    <section className="game-panel" aria-label="Game screen">
      <div className="location-banner">
        <span aria-hidden="true">◆</span>
        {game.state?.location ?? "Hoenn awaits"}
      </div>
      {canWatch ? (
        <LiveFeed />
      ) : (
        <>
          <div className="screen">
            <ScreenMessage message={reason} />
          </div>
          <div className="screen-footer">
            <span>
              <i className="status-dot" />
              {game.connected ? "GAME SERVER CONNECTED" : "CONNECTING"}
            </span>
            <span>POKÉMON EMERALD</span>
          </div>
        </>
      )}
    </section>
  );
}
