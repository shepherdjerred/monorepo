import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { PersonInitial } from "@scout-for-lol/design-system/domain/profile/person-initial";
import { Link } from "react-router";
import {
  compactPoints,
  recordText,
  type ComparisonRow,
} from "#src/lib/champions/champion-pages.ts";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

type MasteryRow =
  RouterOutputs["consumerChampion"]["masteryLeaderboard"]["rows"][number];

/** Rows the mastery panel lists. */
export const MASTERY_LIMIT = 3;

const HEADING = "m-0 font-display text-2xl leading-tight font-bold";
const NAME = "font-display text-xl hover:text-scout-brand";
const YOU =
  "flex-none rounded-full bg-scout-brand px-2.5 text-[13px] leading-5 font-bold text-scout-brand-ink";

/** People with fewer games than the ranking needs, with how those went. */
export function WarmingUp(props: { rows: readonly ComparisonRow[] }) {
  return (
    <Panel variant="open" asChild>
      <section aria-labelledby="warming-h">
        <h2 id="warming-h" className={HEADING}>
          Still warming up
        </h2>
        <ul className="m-0 mt-3 grid list-none gap-1 p-0">
          {props.rows.map((row) => (
            <li
              key={`${row.guild.guildId}:${row.playerId.toString()}`}
              className="flex min-h-11 items-center gap-3"
            >
              <PersonInitial name={row.alias} size="s" you={row.viewerLinked} />
              <Link
                to={`/players/${row.playerId.toString()}`}
                className={`${NAME} min-w-0 flex-1 text-scout-ink no-underline`}
              >
                <b>{row.alias}</b>
              </Link>
              <span className="text-scout-subtle">
                {recordText(row.wins, row.losses)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}

/** The people with the most mastery points on the champion. */
export function MasteryPanel(props: { rows: readonly MasteryRow[] }) {
  return (
    <Panel asChild>
      <section aria-labelledby="mastery-h">
        <h2 id="mastery-h" className={HEADING}>
          Most mastery
        </h2>
        <ol className="m-0 mt-3.5 grid list-none gap-2 p-0">
          {props.rows.slice(0, MASTERY_LIMIT).map((row) => (
            <li
              key={`${row.guild.guildId}:${row.playerId.toString()}`}
              className="flex min-h-11 items-center gap-3"
            >
              <PersonInitial name={row.alias} size="s" you={row.viewerLinked} />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Link
                  to={`/players/${row.playerId.toString()}`}
                  className={`${NAME} min-w-0 text-scout-ink no-underline`}
                >
                  <b>{row.alias}</b>
                </Link>
                {row.viewerLinked ? <span className={YOU}>You</span> : null}
              </span>
              <span className="flex items-baseline gap-1.5">
                <b className="font-display text-xl">
                  {compactPoints(row.points)}
                </b>
                <span className="text-scout-subtle">points</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </Panel>
  );
}
