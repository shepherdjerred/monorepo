import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { HeroPanel } from "@scout-for-lol/design-system/domain/profile/hero-panel";
import { Link } from "react-router";
import { LiveFriendLine } from "#src/components/live/live-friend-line.tsx";
import { LiveState } from "#src/components/live/live-hero.tsx";
import { LiveShell } from "#src/components/live/live-shell.tsx";
import {
  SECTION_HEADING,
  TEXT_LINK,
} from "#src/components/live/live-classes.ts";
import {
  liveListLead,
  summaryFriendLine,
  summaryLine,
  type Instant,
  type LiveListData,
  type LiveSummary,
} from "#src/lib/live/live-game.ts";

const NOBODY_LIVE = "No friends are in a game right now.";

function GamePanel(props: { game: LiveSummary; now: Instant }) {
  const { game } = props;
  const to = `/live/${game.riotMatchId}`;
  return (
    <Panel asChild>
      <section aria-labelledby={`game-${game.riotMatchId}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h2 id={`game-${game.riotMatchId}`} className={SECTION_HEADING}>
            {summaryLine(game, props.now)}
          </h2>
          <Link to={to} className={TEXT_LINK}>
            Watch the lobby
          </Link>
        </div>
        <ul className="m-0 mt-3.5 grid list-none gap-0.5 p-0 sm:-mx-3.5">
          {game.friends.map((friend) => (
            <li key={friend.playerId}>
              <LiveFriendLine
                to={to}
                name={friend.alias}
                line={`In a game now, ${summaryFriendLine(friend)}`}
              />
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}

/** The games the viewer's friends are in right now. */
export function LiveListView(props: { games: LiveListData; now: Instant }) {
  const [first] = props.games;
  const lead = first === undefined ? NOBODY_LIVE : liveListLead(props.games);
  const art = first?.friends[0];
  return (
    <LiveShell>
      <HeroPanel
        aria-labelledby="live-list-h"
        {...(art === undefined ? {} : { art: { champion: art.championId } })}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1
            id="live-list-h"
            className="m-0 font-display text-5xl leading-none font-bold sm:text-6xl"
          >
            Live
          </h1>
          {first === undefined ? null : <LiveState ended={false} />}
        </div>
        <p className="mt-4 mb-0 max-w-[34ch] font-display text-3xl leading-tight text-balance">
          {lead}
        </p>
      </HeroPanel>
      {props.games.map((game) => (
        <GamePanel key={game.riotMatchId} game={game} now={props.now} />
      ))}
    </LiveShell>
  );
}
