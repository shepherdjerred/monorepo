import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { ResultStrip } from "@scout-for-lol/design-system/domain/profile/result-strip";
import { SECTION_HEADING } from "#src/components/friendly-classes.ts";
import type { LatelyLines } from "#src/lib/player/player-page.ts";

/** The slots the strip draws: one per game "Lately" counts. */
const STRIP_SLOTS = 20;

/** How the newest games went: one plain sentence and a dot for every game. */
export function LatelyPanel(props: { lately: LatelyLines }) {
  const { lately } = props;
  return (
    <Panel asChild>
      <section aria-labelledby="lately-h">
        <h2 id="lately-h" className={SECTION_HEADING}>
          Lately
        </h2>
        <p className="m-0 mt-2.5 font-display text-[27px] leading-tight font-medium text-balance sm:text-[32px]">
          {lately.lead}
        </p>
        {lately.sub === undefined ? null : (
          <p className="m-0 mt-2 max-w-[58ch] text-pretty text-scout-subtle">
            {lately.sub}
          </p>
        )}
        <ResultStrip
          results={lately.results}
          slots={STRIP_SLOTS}
          className="mt-6"
        />
        <div className="mt-3 flex justify-between gap-3 text-scout-subtle">
          <span>{STRIP_SLOTS.toString()} games ago</span>
          <span>Latest</span>
        </div>
      </section>
    </Panel>
  );
}
