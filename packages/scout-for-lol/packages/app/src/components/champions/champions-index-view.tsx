import type { DiscordGuildId } from "@scout-for-lol/data";
import { Input } from "@scout-for-lol/design-system/components/input";
import { HeroPanel } from "@scout-for-lol/design-system/domain/profile/hero-panel";
import { PageState } from "@scout-for-lol/design-system/domain/profile/page-states";
import { Search } from "lucide-react";
import {
  PopularList,
  YoursList,
} from "#src/components/champions/champions-index-lists.tsx";
import { ChampionsShell } from "#src/components/champions/champions-shell.tsx";
import { HeroWords } from "#src/components/champions/hero-words.tsx";
import { ServerChips } from "#src/components/champions/server-chips.tsx";
import {
  championsIndexLines,
  popularChampions,
  yoursChampions,
} from "#src/lib/champions/champion-pages.ts";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

export type ChampionsIndexData = RouterOutputs["consumerChampion"]["index"];

/** The champions index once its data is in: hero, the viewer's champions and the friends'. */
export function ChampionsIndexView(props: {
  data: ChampionsIndexData;
  guildIds: DiscordGuildId[] | undefined;
  onGuildIds: (guildIds: DiscordGuildId[] | undefined) => void;
  find: string;
  onFind: (find: string) => void;
}) {
  const { data } = props;
  const servers = (
    <ServerChips
      servers={data.availableGuilds}
      selected={props.guildIds}
      onChange={props.onGuildIds}
    />
  );
  const favourite = data.champions[0];
  if (favourite === undefined) {
    return (
      <ChampionsShell>
        {servers}
        <PageState
          kind="empty"
          level={1}
          id="champions-empty"
          title="Champions"
          lead="No champion games yet"
        />
      </ChampionsShell>
    );
  }
  const lines = championsIndexLines(favourite);
  const yours = yoursChampions(data.champions);
  const popular = popularChampions(data.champions, props.find);
  const showPopular = props.find !== "" || popular.length > 0;
  const columns =
    showPopular && yours.length > 0
      ? "min-[1181px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
      : "";
  return (
    <ChampionsShell>
      <HeroPanel
        aria-labelledby="champions-h"
        art={{ champion: favourite.championId }}
      >
        <HeroWords
          id="champions-h"
          title="Champions"
          lead={lines.lead}
          sub={lines.sub}
        >
          <form
            role="search"
            className="relative mt-6 block w-full max-w-[380px] text-scout-subtle"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <label className="scout-sr-only" htmlFor="find-champion">
              Find a champion
            </label>
            <Search
              aria-hidden="true"
              size={18}
              className="pointer-events-none absolute top-1/2 left-5 -mt-[9px]"
            />
            <Input
              id="find-champion"
              name="find"
              type="search"
              placeholder="Find a champion"
              autoComplete="off"
              value={props.find}
              onChange={(event) => {
                props.onFind(event.currentTarget.value);
              }}
              className="h-[52px] rounded-full border-0 bg-[var(--scout-surface-inset)] pr-5 pl-12 text-base font-semibold shadow-[var(--scout-ring)] hover:bg-[var(--scout-surface-inset-strong)]"
            />
          </form>
        </HeroWords>
      </HeroPanel>
      {showPopular ? null : servers}
      <div className={`grid items-start gap-7 ${columns}`}>
        {yours.length === 0 ? null : (
          <div className="min-[1181px]:order-2">
            <YoursList
              champions={yours}
              qualifyingGames={data.qualifyingGames}
            />
          </div>
        )}
        {showPopular ? (
          <PopularList champions={popular} controls={servers} />
        ) : null}
      </div>
    </ChampionsShell>
  );
}
