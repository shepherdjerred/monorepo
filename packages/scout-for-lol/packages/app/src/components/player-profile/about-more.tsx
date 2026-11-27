import { Fold } from "@scout-for-lol/design-system/components/surfaces/fold";
import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { Link } from "react-router";
import {
  SECTION_HEADING,
  TEXT_LINK,
} from "#src/components/friendly-classes.ts";
import {
  accountsSentence,
  masterySentence,
  playTimesSentence,
} from "#src/lib/player/player-about.ts";
import type { PlayerSummary } from "#src/lib/player/player-page.ts";

const FACT = "m-0 text-scout-subtle";

/** A challenge run the player is in, as the fold lists it. */
export type ChallengeRun = {
  id: string;
  title: string;
  status: string;
  recomputing: boolean;
};

/** The player's challenge runs: a fold of links, or nothing without any. */
function ChallengesFold(props: { runs: readonly ChallengeRun[] }) {
  if (props.runs.length === 0) return null;
  return (
    <Fold summary={`Challenges (${props.runs.length.toString()})`}>
      <ul className="m-0 grid list-none gap-1 p-0">
        {props.runs.map((run) => (
          <li key={run.id} className="flex min-h-11 items-center gap-3">
            <Link to={`/challenge-runs/${run.id}`} className={TEXT_LINK}>
              {run.title}
            </Link>
            <span className="text-scout-subtle">
              {run.recomputing ? "Updating now" : run.status}
            </span>
          </li>
        ))}
      </ul>
    </Fold>
  );
}

/** Accounts, mastery, when they play and challenges: each a fold with one fact. */
export function AboutMore(props: {
  summary: PlayerSummary;
  challenges: readonly ChallengeRun[];
}) {
  const { summary } = props;
  const mastery = masterySentence(summary.accounts);
  const times = playTimesSentence(summary.behavior?.activityTimes ?? []);
  return (
    <Panel variant="open" asChild>
      <section aria-labelledby="about-h">
        <h2 id="about-h" className={SECTION_HEADING}>
          More about {summary.alias}
        </h2>
        <div className="mt-3.5 grid gap-2">
          <Fold summary={`Accounts (${summary.accounts.length.toString()})`}>
            <p className={FACT}>{accountsSentence(summary.accounts)}</p>
          </Fold>
          {mastery === undefined ? null : (
            <Fold summary="Mastery">
              <p className={FACT}>{mastery}</p>
            </Fold>
          )}
          {times === undefined ? null : (
            <Fold summary="When they play">
              <p className={FACT}>{times}</p>
            </Fold>
          )}
          <ChallengesFold runs={props.challenges} />
        </div>
      </section>
    </Panel>
  );
}
