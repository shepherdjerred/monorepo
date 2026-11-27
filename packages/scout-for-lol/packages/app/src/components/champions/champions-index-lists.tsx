import { Link } from "react-router";
import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { ChampionFace } from "@scout-for-lol/design-system/domain/profile/champion-face";
import { PersonInitial } from "@scout-for-lol/design-system/domain/profile/person-initial";
import { formatPercent } from "@scout-for-lol/design-system/domain/profile/win-rate-bar";

import type { ReactNode } from "react";
import {
  gamesText,
  type IndexChampion,
} from "#src/lib/champions/champion-pages.ts";

const NOTE =
  "mt-2 rounded-full bg-[var(--scout-surface-inset-strong)] px-3 text-[13px] leading-5 font-semibold text-scout-subtle";
const LIST_HEADING = "m-0 font-display text-2xl leading-tight font-bold";

/** The champions the viewer plays, most played first. */
export function YoursList(props: {
  champions: readonly IndexChampion[];
  qualifyingGames: number;
}) {
  return (
    <Panel variant="open" asChild>
      <section aria-labelledby="yours-h">
        <h2 id="yours-h" className={LIST_HEADING}>
          Yours
        </h2>
        <ul className="m-0 mt-3 grid list-none grid-cols-3 gap-2 p-0">
          {props.champions.map((champion) => (
            <YoursItem
              key={champion.championId}
              champion={champion}
              qualifyingGames={props.qualifyingGames}
            />
          ))}
        </ul>
      </section>
    </Panel>
  );
}

function YoursItem(props: {
  champion: IndexChampion;
  qualifyingGames: number;
}) {
  const { champion, qualifyingGames } = props;
  const you = champion.you;
  if (you === null)
    throw new Error("Yours listed a champion the viewer has not played");
  return (
    <li>
      <Link
        to={`/champions/${champion.championId.toString()}`}
        className="grid justify-items-center rounded-lg px-1.5 pt-3.5 pb-4 text-center text-scout-ink no-underline hover:bg-scout-surface"
      >
        <ChampionFace champion={champion.championId} size={92} alt="" />
        <b className="mt-3 font-display text-[21px] leading-tight">
          {champion.name}
        </b>
        <span className="text-scout-subtle">{gamesText(you.games)}</span>
        <span className="text-scout-subtle">
          Won {formatPercent(you.winRate * 100)}
        </span>
        {you.games < qualifyingGames ? (
          <span className={NOTE}>Small sample</span>
        ) : null}
      </Link>
    </li>
  );
}

/** The champions the friends play, each with the friend who is best on it. */
export function PopularList(props: {
  champions: readonly IndexChampion[];
  controls: ReactNode;
}) {
  return (
    <Panel asChild>
      <section aria-labelledby="popular-h">
        <h2 id="popular-h" className={LIST_HEADING}>
          Popular with your friends
        </h2>
        <div className="mt-3">{props.controls}</div>
        {props.champions.length === 0 ? (
          <p className="mt-4 mb-0 text-scout-subtle">No champions match.</p>
        ) : (
          <ol className="m-0 mt-3.5 grid list-none gap-0.5 p-0 sm:-mx-3.5">
            {props.champions.map((champion) => (
              <PopularRow key={champion.championId} champion={champion} />
            ))}
          </ol>
        )}
      </section>
    </Panel>
  );
}

const ROW_LINK =
  "flex min-w-0 items-center gap-3.5 text-scout-ink no-underline hover:[&_b]:text-scout-brand";

function PopularRow(props: { champion: IndexChampion }) {
  const { champion } = props;
  const best = champion.bestFriend;
  return (
    <li className="grid grid-cols-1 items-center gap-0.5 rounded-lg py-2 pr-3 pl-2 sm:grid-cols-[minmax(0,1fr)_13.25rem] sm:gap-3.5 sm:rounded-full sm:py-[7px] sm:pr-[18px] sm:pl-3">
      <Link
        to={`/champions/${champion.championId.toString()}`}
        className={ROW_LINK}
      >
        <ChampionFace champion={champion.championId} size={46} alt="" />
        <span className="grid min-w-0 leading-snug">
          <b className="font-display text-xl">{champion.name}</b>
          <span className="text-scout-subtle">
            Played by {champion.friendCount.toString()}{" "}
            {champion.friendCount === 1 ? "friend" : "friends"}
          </span>
        </span>
      </Link>
      {best === null ? null : (
        <Link
          to={`/players/${best.playerId.toString()}`}
          className={`${ROW_LINK} gap-3 max-sm:pl-[60px]`}
        >
          <PersonInitial name={best.alias} size="s" />
          <span className="grid min-w-0 leading-snug">
            <b className="font-display text-lg">{best.alias}</b>
            <span className="text-scout-subtle">
              {best.qualified
                ? `Best at ${formatPercent(best.winRate * 100)}`
                : `Won ${best.wins.toString()} of ${gamesText(best.games)}`}
            </span>
          </span>
        </Link>
      )}
    </li>
  );
}
