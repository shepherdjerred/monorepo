import { LiveFriendsPanel } from "#src/components/live/live-friends-panel.tsx";
import { LiveHero } from "#src/components/live/live-hero.tsx";
import { LiveLobby } from "#src/components/live/live-lobby.tsx";
import { LiveShell } from "#src/components/live/live-shell.tsx";
import { LiveWatch } from "#src/components/live/live-watch.tsx";
import {
  liveHeroLines,
  type Instant,
  type LiveGameData,
} from "#src/lib/live/live-game.ts";
import { watchLines } from "#src/lib/live/live-watch.ts";

/** One game's lobby: who is playing, both teams, and who to watch. */
export function LiveGameView(props: { game: LiveGameData; now: Instant }) {
  const { game } = props;
  const watch = watchLines(game);
  return (
    <LiveShell>
      <LiveHero lines={liveHeroLines(game, props.now)} ended={game.ended} />
      <div
        className={`grid items-start gap-7 ${
          watch.length === 0
            ? ""
            : "min-[1181px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
        }`}
      >
        <LiveFriendsPanel game={game} />
        <div className="grid min-w-0 gap-7">
          <LiveWatch lines={watch} />
          {game.ended ? null : (
            <p className="m-0 px-3 text-scout-subtle max-[720px]:px-1.5">
              Updates when the game ends.
            </p>
          )}
        </div>
      </div>
      <LiveLobby game={game} />
    </LiveShell>
  );
}
