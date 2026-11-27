import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import { HeroPanel } from "@scout-for-lol/design-system/domain/profile/hero-panel";
import { RankLockup } from "@scout-for-lol/design-system/domain/profile/rank-lockup";
import { Search } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router";
import { HERO_TITLE, TEXT_LINK } from "#src/components/friendly-classes.ts";
import {
  heroAbout,
  heroArtChampion,
  heroRank,
  type PlayerSummary,
} from "#src/lib/player/player-page.ts";

/** "A, B and C" from links, in the order given. */
function NameList(props: { names: { championId: number; name: string }[] }) {
  const last = props.names.length - 1;
  return (
    <>
      {props.names.map((champion, index) => (
        <Fragment key={champion.championId}>
          {index === 0 ? "" : index === last ? " and " : ", "}
          <Link
            to={`/champions/${champion.championId.toString()}`}
            className={TEXT_LINK}
          >
            {champion.name}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

/** The player: their name, their rank, where they play and who they play. */
export function ProfileHero(props: { summary: PlayerSummary }) {
  const { summary } = props;
  const art = heroArtChampion(summary);
  const rank = heroRank(summary.ranks);
  const about = heroAbout(summary);
  return (
    <HeroPanel
      aria-labelledby="who-h"
      {...(art === undefined ? {} : { art: { champion: art } })}
      action={
        <Link to="/players" className={chipVariants({ variant: "float" })}>
          <Search size={18} aria-hidden="true" />
          Find another player
        </Link>
      }
    >
      <h1 id="who-h" className={HERO_TITLE}>
        {summary.alias}
      </h1>
      <div className="mt-4">
        {rank === undefined ? (
          <p className="m-0 font-display text-2xl text-scout-subtle">
            Unranked
          </p>
        ) : (
          <RankLockup
            rank={rank.parts.rank}
            leaguePoints={rank.parts.leaguePoints}
            {...(rank.parts.division === undefined
              ? {}
              : { division: rank.parts.division })}
            {...(rank.secondary === undefined
              ? {}
              : { secondary: rank.secondary })}
          />
        )}
      </div>
      <p className="mt-4 mb-0 max-w-[46ch] text-lg text-pretty text-scout-subtle">
        <span>
          {about.main === undefined
            ? `Plays in ${about.guild}.`
            : `${about.main} in ${about.guild}.`}
        </span>
        {about.champions.length === 0 ? null : (
          <>
            {" "}
            <span>
              Mostly plays <NameList names={about.champions} />.
            </span>
          </>
        )}
      </p>
    </HeroPanel>
  );
}
