import { RankCrest } from "@scout-for-lol/design-system/assets";
import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { ClimbChart } from "@scout-for-lol/design-system/domain/charts/climb-chart";
import { SECTION_HEADING } from "#src/components/friendly-classes.ts";
import type { SplitClimb } from "#src/lib/player/player-feed.ts";
import { rankName, rankParts } from "#src/lib/player/rank-parts.ts";
import type { Rank } from "@scout-for-lol/data";

function End(props: { rank: Rank; caption: string; flip?: boolean }) {
  const crest = (
    <RankCrest rank={rankParts(props.rank).rank} width={40} alt="" />
  );
  return (
    <span className="flex items-center gap-2">
      {props.flip === true ? null : crest}
      <span className="grid leading-snug">
        <b className="font-display text-lg">{rankName(props.rank)}</b>
        <span className="text-scout-subtle">{props.caption}</span>
      </span>
      {props.flip === true ? crest : null}
    </span>
  );
}

/** This split's Solo/Duo climb: the sentence, the line, and both ends of it. */
export function SplitPanel(props: { climb: SplitClimb }) {
  const { climb } = props;
  return (
    <Panel asChild>
      <section aria-labelledby="split-h">
        <h2 id="split-h" className={SECTION_HEADING}>
          This split
        </h2>
        <p className="m-0 mt-2 max-w-[58ch] text-pretty text-scout-subtle">
          {climb.sentence}
        </p>
        <ClimbChart
          className="mt-4"
          series={[
            {
              id: "solo",
              name: "Solo/Duo",
              you: true,
              points: climb.points,
            },
          ]}
          startLabel={<End rank={climb.start} caption="Start of the split" />}
          nowLabel={<End rank={climb.now} caption="Now" flip />}
          {...(climb.reached === undefined ? {} : { marks: [climb.reached] })}
        />
      </section>
    </Panel>
  );
}
