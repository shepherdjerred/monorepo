import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { ChampionFace } from "@scout-for-lol/design-system/domain/profile/champion-face";
import { useState } from "react";
import { Link } from "react-router";
import {
  NOTE,
  SECTION_HEADING,
  TEXT_LINK,
} from "#src/components/friendly-classes.ts";
import { wholePercent } from "#src/lib/format/percent.ts";
import { gamesText } from "#src/lib/champions/champion-pages.ts";
import {
  BEST_CHAMPIONS_PREVIEW,
  type BestChampion,
} from "#src/lib/player/player-page.ts";

function Tile(props: { champion: BestChampion }) {
  const { champion } = props;
  return (
    <Link
      to={`/champions/${champion.championId.toString()}`}
      className="grid justify-items-center rounded-lg px-1.5 pt-3.5 pb-4 text-center text-scout-ink no-underline hover:bg-scout-surface"
    >
      <ChampionFace champion={champion.championId} size={92} alt="" />
      <b className="mt-3 font-display text-[21px] leading-tight">
        {champion.name}
      </b>
      <span className="text-scout-subtle">{gamesText(champion.games)}</span>
      <span className="text-scout-subtle">
        Won {wholePercent(champion.winRate)}
      </span>
      {champion.lowSample ? (
        <span className={`${NOTE} mt-2`}>Small sample</span>
      ) : null}
    </Link>
  );
}

/** The champions this player does most with, three to a row. */
export function BestChampionsPanel(props: {
  champions: readonly BestChampion[];
}) {
  const [all, setAll] = useState(false);
  const shown = all
    ? props.champions
    : props.champions.slice(0, BEST_CHAMPIONS_PREVIEW);
  const more = props.champions.length > BEST_CHAMPIONS_PREVIEW && !all;
  return (
    <Panel variant="open" asChild>
      <section aria-labelledby="best-h">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="best-h" className={SECTION_HEADING}>
            Best champions
          </h2>
          {more ? (
            <button
              type="button"
              className={`${TEXT_LINK} inline-flex min-h-11 items-center`}
              onClick={() => {
                setAll(true);
              }}
            >
              See all {props.champions.length.toString()}
            </button>
          ) : null}
        </div>
        <ul className="m-0 mt-3.5 grid list-none grid-cols-3 gap-2 p-0 max-sm:gap-0">
          {shown.map((champion) => (
            <li key={champion.championId}>
              <Tile champion={champion} />
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}
