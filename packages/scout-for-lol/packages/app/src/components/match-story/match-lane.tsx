import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { ChampionFace } from "@scout-for-lol/design-system/domain/profile/champion-face";
import {
  championLabel,
  selfName,
  laneDetail,
  laneLead,
  riotIdOf,
  type DetailParticipant,
  type LaneResult,
} from "./match-model.ts";

function Side(props: {
  participant: DetailParticipant;
  name: string;
  win?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <ChampionFace
        champion={props.participant.championName}
        size={72}
        alt=""
        {...(props.win === true ? { result: "win" as const } : {})}
      />
      <span className="grid min-w-0 leading-snug">
        <b className="truncate font-display text-xl">
          {championLabel(props.participant.championName)}
        </b>
        <span className="truncate text-scout-subtle">{props.name}</span>
      </span>
    </span>
  );
}

/** The viewer's lane at 15 minutes: the figure carries its own definition. */
export function MatchLane(props: {
  viewer: DetailParticipant;
  lane: LaneResult;
}) {
  const { lane, viewer } = props;
  return (
    <Panel asChild>
      <section aria-labelledby="match-lane-title">
        <h2 id="match-lane-title" className="font-display text-2xl font-bold">
          Lane
        </h2>
        <p className="mt-3 font-display text-2xl leading-snug sm:text-3xl">
          {laneLead(lane)}
        </p>
        <p className="mt-2 text-scout-subtle">{laneDetail(lane)}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Side
            participant={viewer}
            name={selfName(viewer)}
            win={lane.goldDelta > 0}
          />
          <span className="rounded-full bg-[var(--scout-surface-inset)] px-3 py-0.5 text-scout-subtle">
            against
          </span>
          <Side participant={lane.opponent} name={riotIdOf(lane.opponent)} />
        </div>
      </section>
    </Panel>
  );
}
