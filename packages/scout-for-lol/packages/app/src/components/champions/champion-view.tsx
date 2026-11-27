import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import { HeroPanel } from "@scout-for-lol/design-system/domain/profile/hero-panel";
import { PageState } from "@scout-for-lol/design-system/domain/profile/page-states";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { RankingPanel } from "#src/components/champions/champion-ranking.tsx";
import { WarmingUp } from "#src/components/champions/champion-side.tsx";
import { ChampionsShell } from "#src/components/champions/champions-shell.tsx";
import { HeroWords } from "#src/components/champions/hero-words.tsx";
import {
  championHeroLines,
  type ComparisonRow,
} from "#src/lib/champions/champion-pages.ts";

/**
 * A champion in the viewer's servers: the hero, who is best on it, who is still
 * warming up and, in the slots the route fills, the matchups and mastery.
 */
export function ChampionView(props: {
  championId: number;
  name: string;
  qualifyingGames: number;
  qualified: readonly ComparisonRow[];
  small: readonly ComparisonRow[];
  /** More qualified rows exist than the page read. */
  truncated: boolean;
  servers: ReactNode;
  matchups: ReactNode;
  mastery: ReactNode;
}) {
  if (props.qualified.length === 0 && props.small.length === 0) {
    return (
      <ChampionsShell>
        {props.servers}
        <PageState
          kind="empty"
          level={1}
          id="champion-empty"
          title={props.name}
          lead={`Nobody in your servers has played ${props.name}`}
          actions={
            <Link
              to="/champions"
              className={chipVariants({ variant: "ghost" })}
            >
              Change champion
            </Link>
          }
        />
      </ChampionsShell>
    );
  }
  const lines = championHeroLines({
    name: props.name,
    qualifyingGames: props.qualifyingGames,
    qualified: props.qualified,
    small: props.small,
    truncated: props.truncated,
  });
  const hasSide = props.small.length > 0 || props.mastery !== null;
  return (
    <ChampionsShell>
      <HeroPanel
        aria-labelledby="champion-h"
        art={{ champion: props.championId }}
        action={
          <Link to="/champions" className={chipVariants({ variant: "float" })}>
            <Search size={18} aria-hidden="true" />
            Change champion
          </Link>
        }
      >
        <HeroWords
          id="champion-h"
          title={props.name}
          lead={lines.lead}
          sub={lines.sub}
        />
      </HeroPanel>
      <div
        className={`grid items-start gap-7 ${hasSide ? "min-[1181px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : ""}`}
      >
        <div className="grid min-w-0 gap-7">
          {props.qualified.length === 0 ? props.servers : null}
          {props.qualified.length === 0 ? null : (
            <RankingPanel
              championName={props.name}
              rows={props.qualified}
              controls={props.servers}
            />
          )}
          {props.matchups}
        </div>
        {hasSide ? (
          <div className="grid min-w-0 gap-7">
            {props.small.length === 0 ? null : <WarmingUp rows={props.small} />}
            {props.mastery}
          </div>
        ) : null}
      </div>
    </ChampionsShell>
  );
}
