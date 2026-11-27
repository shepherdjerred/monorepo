import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { Fold } from "@scout-for-lol/design-system/components/surfaces/fold";
import {
  GoldLeadChart,
  matchClock,
  type GoldLeadPoint,
} from "@scout-for-lol/design-system/domain/charts/gold-lead-chart";
import type { MatchStory, StoryMoment } from "./match-model.ts";

/** Facts shown before the rest fold away. */
const VISIBLE_MOMENTS = 8;

function teamColour(teamId: number): "Blue" | "Red" {
  return teamId === 100 ? "Blue" : "Red";
}

function chartPoints(
  goldLead: NonNullable<MatchStory["goldLead"]>,
): GoldLeadPoint[] {
  return goldLead.points.map((point) => ({
    timeMs: point.timestampMs,
    lead: point.leadGold,
  }));
}

function MomentRow(props: { moment: StoryMoment; viewerTeamId: number }) {
  const { moment } = props;
  const ours = moment.teamId === props.viewerTeamId;
  return (
    <li className="flex items-baseline gap-3 py-1.5">
      <span className="w-12 shrink-0 text-scout-subtle tabular-nums">
        {matchClock(moment.timestampMs)}
      </span>
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 translate-y-[-1px] rounded-full ${ours ? "bg-scout-win-fill" : "bg-scout-loss-fill"}`}
      />
      <span>
        {moment.text}
        <span className="scout-sr-only">
          {ours ? ", your team" : ", their team"}
        </span>
      </span>
    </li>
  );
}

function Moments(props: {
  moments: readonly StoryMoment[];
  viewerTeamId: number;
}) {
  const head = props.moments.slice(0, VISIBLE_MOMENTS);
  const rest = props.moments.slice(VISIBLE_MOMENTS);
  const rows = (list: readonly StoryMoment[]) =>
    list.map((moment) => (
      <MomentRow
        key={moment.id}
        moment={moment}
        viewerTeamId={props.viewerTeamId}
      />
    ));
  return (
    <div className="mt-6">
      <h3 className="font-display text-lg font-bold">Moments</h3>
      <ol className="mt-2">{rows(head)}</ol>
      {rest.length === 0 ? null : (
        <Fold summary={`All ${props.moments.length.toString()} moments`}>
          <ol>{rows(rest)}</ol>
        </Fold>
      )}
    </div>
  );
}

/** Whether the story has a gold lead or moments to draw at all. */
export function hasWent(story: MatchStory): boolean {
  return (
    story.coverage !== "end_of_game" &&
    (story.goldLead !== null || story.moments.length > 0)
  );
}

/**
 * The gold lead over the game and the facts the timeline states. A game with
 * no timeline has neither, so the panel is not drawn at all.
 */
export function MatchWent(props: { story: MatchStory; viewerTeamId: number }) {
  const { story, viewerTeamId } = props;
  if (!hasWent(story)) return null;
  const { goldLead } = story;
  const otherTeamId = viewerTeamId === 100 ? 200 : 100;
  return (
    <Panel asChild>
      <section aria-labelledby="match-went-title">
        <h2 id="match-went-title" className="font-display text-2xl font-bold">
          How it went
        </h2>
        {goldLead === null ? null : (
          <GoldLeadChart
            className="mt-5"
            points={chartPoints(goldLead)}
            positiveName={teamColour(viewerTeamId)}
            negativeName={teamColour(otherTeamId)}
          />
        )}
        {story.moments.length === 0 ? null : (
          <Moments moments={story.moments} viewerTeamId={viewerTeamId} />
        )}
      </section>
    </Panel>
  );
}
