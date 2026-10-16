import { useQuery } from "@tanstack/react-query";
import {
  DiscordIdSchema,
  GameIdSchema,
  type GameId,
} from "@arcade/common/catalog.ts";
import { ServersSchema } from "@arcade/common/protocol.ts";
import { useMe, signIn } from "@shepherdjerred/discord-plays-web/session/me.ts";
import { clientModules } from "./games/registry.ts";
import { useGameRoom } from "./room.tsx";

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
  const model = useGameRoom(guildId, gameId);
  const module = clientModules[gameId];
  return <module.Room model={model} />;
}
