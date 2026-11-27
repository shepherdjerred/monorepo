import type { Lane } from "@scout-for-lol/data";
import { Chip } from "@scout-for-lol/design-system/components/surfaces/chip";
import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { ChampionFace } from "@scout-for-lol/design-system/domain/profile/champion-face";
import {
  laneLabel,
  matchupGroups,
  matchupLines,
  type MatchupEntry,
} from "#src/lib/champions/champion-pages.ts";

/**
 * The viewer's matchups in one lane: the ones they win and the ones they lose,
 * each with the games behind it and how often they were ahead at 15 minutes.
 * With no matchup to show in a lane it stays only when another lane can be
 * chosen.
 */
export function MatchupsPanel(props: {
  matchups: readonly MatchupEntry[];
  lanes: readonly Lane[];
  lane: Lane;
  onLane: (lane: Lane) => void;
}) {
  const groups = matchupGroups(props.matchups);
  const hasMatchups = groups.good.length > 0 || groups.hard.length > 0;
  if (!hasMatchups && props.lanes.length < 2) return null;
  return (
    <Panel asChild>
      <section aria-labelledby="matchups-h">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h2
            id="matchups-h"
            className="m-0 font-display text-2xl leading-tight font-bold"
          >
            Your matchups
          </h2>
          {props.lanes.length < 2 ? null : (
            <div
              role="group"
              aria-label="Lane"
              className="flex flex-wrap gap-2"
            >
              {props.lanes.map((lane) => (
                <Chip
                  key={lane}
                  pressed={lane === props.lane}
                  onClick={() => {
                    props.onLane(lane);
                  }}
                >
                  {laneLabel(lane)}
                </Chip>
              ))}
            </div>
          )}
        </div>
        {groups.lead === undefined ? null : (
          <p className="mt-3 mb-0 font-display text-3xl leading-tight text-balance">
            {groups.lead}
          </p>
        )}
        <div className="mt-5 grid gap-x-11 gap-y-5 sm:grid-cols-2">
          <MatchupColumn heading="Does well against" entries={groups.good} />
          <MatchupColumn
            heading="Has a hard time against"
            entries={groups.hard}
          />
        </div>
      </section>
    </Panel>
  );
}

function MatchupColumn(props: {
  heading: string;
  entries: readonly MatchupEntry[];
}) {
  if (props.entries.length === 0) return null;
  return (
    <div>
      <h3 className="m-0 text-[15px] leading-snug font-semibold text-scout-subtle">
        {props.heading}
      </h3>
      <ul className="m-0 mt-1.5 grid list-none gap-0.5 p-0 sm:-mx-3">
        {props.entries.map((entry) => (
          <MatchupItem key={entry.opponent.championId} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function MatchupItem(props: { entry: MatchupEntry }) {
  const { you } = props.entry;
  if (you === null)
    throw new Error("Matchups listed an opponent the viewer has not faced");
  const lines = matchupLines(you);
  return (
    <li className="flex items-center gap-3.5 py-[7px] pr-4 pl-3">
      <ChampionFace
        champion={props.entry.opponent.championId}
        size={46}
        alt=""
      />
      <span className="grid min-w-0 flex-1 leading-snug">
        <b className="font-display text-xl">{props.entry.opponent.name}</b>
        <span className="text-scout-subtle">{lines.result}</span>
        {lines.lane === undefined ? null : (
          <span className="text-scout-subtle">{lines.lane}</span>
        )}
      </span>
    </li>
  );
}
