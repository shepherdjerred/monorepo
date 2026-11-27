import type { DiscordGuildId } from "@scout-for-lol/data";
import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import { HeroPanel } from "@scout-for-lol/design-system/domain/profile/hero-panel";
import { PageState } from "@scout-for-lol/design-system/domain/profile/page-states";
import { ServerChips } from "#src/components/champions/server-chips.tsx";
import { HeroWords } from "#src/components/champions/hero-words.tsx";
import { FriendlyPage } from "#src/components/friendly-page.tsx";
import { TWO_COLUMNS } from "#src/components/friendly-classes.ts";
import { HeroSearch } from "#src/components/hero-search.tsx";
import { PlayersPanel } from "#src/components/players/friends-panel.tsx";
import { YouPanel } from "#src/components/players/you-panel.tsx";
import {
  playersIn,
  rosterHero,
  youIn,
  type Roster,
  type RosterPlayer,
} from "#src/lib/players/roster-page.ts";

/** What a search has found: nothing asked yet, still looking, failed, or these people. */
export type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed"; onRetry: () => void }
  | { kind: "found"; players: readonly RosterPlayer[] };

function SearchResults(props: { state: SearchState; nowMs: number }) {
  const { state } = props;
  if (state.kind === "failed") {
    return (
      <PageState
        kind="unavailable"
        id="search-unavailable"
        title="Results"
        lead="Search could not finish."
        actions={
          <button
            type="button"
            className={chipVariants()}
            onClick={state.onRetry}
          >
            Retry
          </button>
        }
      />
    );
  }
  return (
    <PlayersPanel
      id="results-h"
      title="Results"
      players={state.kind === "found" ? state.players : []}
      nowMs={props.nowMs}
      empty={state.kind === "loading" ? "Searching…" : "No players found"}
      everyone
    />
  );
}

/** The Players page once its roster is in: hero, friends, and the viewer. */
export function PlayersView(props: {
  roster: Roster;
  guildIds: DiscordGuildId[] | undefined;
  onGuildIds: (guildIds: DiscordGuildId[] | undefined) => void;
  find: string;
  onFind: (find: string) => void;
  search: SearchState;
  nowMs: number;
}) {
  const { roster } = props;
  if (roster.players.length === 0) {
    return (
      <FriendlyPage>
        <PageState
          kind="empty"
          level={1}
          id="players-empty"
          title="Players"
          lead="No players yet"
        />
      </FriendlyPage>
    );
  }
  const hero = rosterHero(roster.players);
  const visible = playersIn(roster, props.guildIds);
  const you = youIn(roster.players);
  const friends = visible.filter((player) => !player.isYou);
  return (
    <FriendlyPage>
      <HeroPanel
        aria-labelledby="players-h"
        {...(hero.art === undefined ? {} : { art: { champion: hero.art } })}
      >
        <HeroWords
          id="players-h"
          title="Players"
          lead={hero.lead}
          sub={hero.sub}
        >
          <HeroSearch
            id="find-player"
            label="Find a player"
            value={props.find}
            onChange={props.onFind}
          />
        </HeroWords>
      </HeroPanel>
      <div className={you === undefined ? "" : TWO_COLUMNS}>
        {props.search.kind === "idle" ? (
          <PlayersPanel
            id="friends-h"
            title="Your friends"
            players={friends}
            nowMs={props.nowMs}
            empty="No friends yet"
            controls={
              <ServerChips
                servers={roster.guilds.map((guild) => ({
                  guildId: guild.id,
                  name: guild.name,
                }))}
                selected={props.guildIds}
                onChange={props.onGuildIds}
              />
            }
          />
        ) : (
          <SearchResults state={props.search} nowMs={props.nowMs} />
        )}
        {you === undefined ? null : <YouPanel player={you} />}
      </div>
    </FriendlyPage>
  );
}
