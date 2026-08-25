import {
  competitionGameVariantToString,
  competitionQueuesToString,
  visibilityToString,
} from "@scout-for-lol/data";
import type { CompetitionBuilderState } from "#src/lib/competition-builder-state.ts";

const CRITERION_LABELS: Record<
  CompetitionBuilderState["criteria"]["criteriaType"],
  string
> = {
  MOST_GAMES_PLAYED: "Most games played",
  MOST_WINS_PLAYER: "Most wins",
  MOST_WINS_CHAMPION: "Most wins on a champion",
  HIGHEST_WIN_RATE: "Highest win rate",
  HIGHEST_RANK: "Highest rank",
  MOST_RANK_CLIMB: "Most rank climb",
};

function queueLabel(state: CompetitionBuilderState): string {
  return competitionQueuesToString(state.criteria.queues);
}

function aggregationLabel(state: CompetitionBuilderState): string {
  if (
    state.criteria.criteriaType !== "HIGHEST_RANK" &&
    state.criteria.criteriaType !== "MOST_RANK_CLIMB"
  ) {
    return "";
  }
  return state.criteria.aggregation === "MAX"
    ? " · Best selected rank"
    : " · Combined ranks";
}

function windowLabel(state: CompetitionBuilderState): string {
  return state.dates.mode === "SEASON"
    ? `League season ${state.dates.seasonId || "not set"}`
    : `${state.dates.startDate || "not set"} through ${state.dates.endDate || "not set"} (${state.analysisTimezone})`;
}

export function CompetitionBuilderReview(props: {
  state: CompetitionBuilderState;
  channelName: string | undefined;
}) {
  const summary = competitionReviewSummary(props.state, props.channelName);
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-scout-subtle">Game version</dt>
        <dd className="font-medium text-scout-ink">{summary.gameVariant}</dd>
      </div>
      <div>
        <dt className="text-scout-subtle">Scoring</dt>
        <dd className="font-medium text-scout-ink">{summary.scoring}</dd>
      </div>
      <div>
        <dt className="text-scout-subtle">Window</dt>
        <dd className="font-medium text-scout-ink">{summary.window}</dd>
      </div>
      <div>
        <dt className="text-scout-subtle">Entrants</dt>
        <dd className="font-medium text-scout-ink">{summary.entrants}</dd>
      </div>
      <div>
        <dt className="text-scout-subtle">Delivery</dt>
        <dd className="font-medium text-scout-ink">{summary.delivery}</dd>
      </div>
    </dl>
  );
}

export function competitionReviewSummary(
  state: CompetitionBuilderState,
  channelName: string | undefined,
): {
  gameVariant: string;
  scoring: string;
  window: string;
  entrants: string;
  delivery: string;
} {
  const roster =
    state.visibility === "SERVER_WIDE"
      ? `All eligible tracked players, capped at ${state.maxParticipants}`
      : `${state.initialPlayerIds.length.toString()} selected tracked player(s)`;
  const updates = state.scheduledUpdates.enabled
    ? `${state.scheduledUpdates.cronExpression} in ${state.scheduledUpdates.timezone}`
    : "Disabled";
  return {
    gameVariant: competitionGameVariantToString(state.gameVariant),
    scoring: `${CRITERION_LABELS[state.criteria.criteriaType]} · ${queueLabel(state)}${aggregationLabel(state)}`,
    window: windowLabel(state),
    entrants: `${visibilityToString(state.visibility)} · ${roster}`,
    delivery: `#${channelName ?? "not set"} · Leaderboard updates ${updates}`,
  };
}
