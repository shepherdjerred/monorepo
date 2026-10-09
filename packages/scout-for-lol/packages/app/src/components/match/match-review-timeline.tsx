import type { RiotMatchId } from "@scout-for-lol/data";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loaded } from "@shepherdjerred/loaded";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  GoldChart,
  RiftMap,
  goldLead,
  ComparePlayer,
} from "./match-review-visuals.tsx";
import { useTRPC } from "#src/lib/query/trpc.ts";
import type { MatchTeam } from "./match-scoreboard.tsx";
import { MatchTimeline } from "./match-timeline.tsx";
import {
  eventDescription,
  eventTeam,
  frameDifference,
  laneOpponent,
  matchClock,
  participantName,
  reviewSnapshots,
  snapshotAt,
  teamName,
  type ReviewTimeline,
} from "#src/lib/player/match-review.ts";

export type ReviewSource =
  { kind: "consumer"; playerId: number } | { kind: "explore" };
type Props = {
  source: ReviewSource;
  matchId: RiotMatchId;
  teams: MatchTeam[];
  showRiftMap: boolean;
  compareLanes: boolean;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
};

export function MatchReviewTimeline(props: Props) {
  return props.source.kind === "consumer" ? (
    <ConsumerTimeline {...props} playerId={props.source.playerId} />
  ) : (
    <ExploreTimeline {...props} />
  );
}

function ConsumerTimeline(props: Props & { playerId: number }) {
  const trpc = useTRPC();
  const query = useQuery(
    trpc.consumerMatch.reviewTimeline.queryOptions(
      { matchId: props.matchId, playerId: props.playerId },
      { staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    ),
  );
  return (
    <TimelineQuery
      {...props}
      value={Loaded.strict(Loaded.fromQuery(query, ["reviewTimeline"]))}
      onRetry={() => void query.refetch()}
    />
  );
}
function ExploreTimeline(props: Props) {
  const trpc = useTRPC();
  const query = useQuery(
    trpc.exploreMatch.reviewTimeline.queryOptions(
      { matchId: props.matchId },
      { staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    ),
  );
  return (
    <TimelineQuery
      {...props}
      value={Loaded.strict(Loaded.fromQuery(query, ["reviewTimeline"]))}
      onRetry={() => void query.refetch()}
    />
  );
}
function TimelineQuery(
  props: Props & { value: Loaded<ReviewTimeline>; onRetry: () => void },
) {
  if (props.value.status === "loading")
    return <p role="status">Loading timeline…</p>;
  if (props.value.status === "error")
    return (
      <div className="space-y-3">
        <p>Timeline couldn’t load.</p>
        <Button onClick={props.onRetry}>Retry timeline</Button>
      </div>
    );
  const data = props.value.data;
  if (data.coverage === null || data.frames.length === 0)
    return (
      <p className="text-scout-subtle">
        No timeline is available for this match.
      </p>
    );
  return <TimelineReview {...props} data={data} />;
}

function TimelineReview(props: Props & { data: ReviewTimeline }) {
  const snapshots = useMemo(
    () => reviewSnapshots(props.data.frames, props.teams),
    [props.data.frames, props.teams],
  );
  const last = snapshots.at(-1);
  const first = snapshots[0];
  if (first === undefined || last === undefined)
    throw new Error("Timeline has no snapshots");
  const [time, setTime] = useState(
    Math.max(first.timestampMs, Math.min(900_000, last.timestampMs)),
  );
  const [category, setCategory] = useState("all");
  const [teamFilter, setTeamFilter] = useState(0);
  const [playerFilter, setPlayerFilter] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const snapshot = snapshotAt(snapshots, time);
  const participants = props.teams.flatMap((team) => team.participants);
  const selected = participants.find(
    (p) => p.participantId === props.selectedId,
  );
  const opponent = props.compareLanes
    ? laneOpponent(selected, props.teams)
    : undefined;
  const frame = snapshot?.frames.find(
    (row) => row.participant_id === props.selectedId,
  );
  const opponentFrame = snapshot?.frames.find(
    (row) => row.participant_id === opponent?.participantId,
  );
  const difference =
    frame !== undefined && opponentFrame !== undefined
      ? frameDifference(frame, opponentFrame)
      : undefined;
  const end = Math.max(
    last.timestampMs,
    props.data.events.at(-1)?.timestampMs ?? 0,
  );
  const events = props.data.events.filter(
    (event) =>
      (category === "all" ||
        (category === "kills"
          ? event.type === "CHAMPION_KILL"
          : event.type === "ELITE_MONSTER_KILL" ||
            event.type === "BUILDING_KILL")) &&
      (teamFilter === 0 || eventTeam(event, props.teams) === teamFilter) &&
      (playerFilter === 0 ||
        event.participantIds.includes(playerFilter) ||
        event.killerId === playerFilter ||
        event.victimId === playerFilter),
  );
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label="Match time">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Gold advantage</h2>
          <output
            className="text-2xl font-semibold tabular-nums"
            htmlFor="review-time"
          >
            {matchClock(time)}
          </output>
        </div>
        <GoldChart snapshots={snapshots} time={time} />
        <label className="block text-sm font-medium" htmlFor="review-time">
          Match time
        </label>
        <input
          id="review-time"
          className="w-full accent-primary"
          type="range"
          min={first.timestampMs}
          max={end}
          step={1000}
          value={time}
          aria-valuetext={matchClock(time)}
          onChange={(event) => {
            setTime(Number(event.target.value));
          }}
        />
        <div className="flex flex-wrap gap-2">
          {[600_000, 900_000, 1_200_000]
            .filter((value) => value <= end)
            .map((value) => (
              <Button
                key={value}
                size="sm"
                variant="outline"
                onClick={() => {
                  setTime(value);
                }}
              >
                {matchClock(value)}
              </Button>
            ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTime(end);
            }}
          >
            End
          </Button>
        </div>
        <p className="text-sm text-scout-subtle" aria-live="polite">
          {snapshot === undefined
            ? "No snapshot recorded at this time."
            : `Snapshot ${matchClock(snapshot.timestampMs)} · ${goldLead(snapshot.goldDifference)}`}
        </p>
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Map positions</h3>
          {snapshot !== undefined && props.showRiftMap ? (
            <RiftMap
              snapshot={snapshot}
              teams={props.teams}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
            />
          ) : (
            <p className="text-sm text-scout-subtle">
              Map positions aren’t available for this map.
            </p>
          )}
          <p className="text-xs text-scout-subtle">
            Recorded positions at{" "}
            {snapshot === undefined ? "—" : matchClock(snapshot.timestampMs)}.
          </p>
        </section>
        <section className="space-y-4">
          <h3 className="text-lg font-semibold">Player comparison</h3>
          <ComparePlayer
            teams={props.teams}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
          />
          {selected === undefined ? (
            <p className="text-sm text-scout-subtle">
              Choose a player to compare their lane.
            </p>
          ) : frame === undefined ? (
            <p className="text-sm text-scout-subtle">
              No snapshot for {participantName(selected)} at this time.
            </p>
          ) : (
            <>
              <h4 className="font-medium">
                {participantName(selected)} ·{" "}
                {matchClock(frame.frame_timestamp_ms)}
              </h4>
              <dl className="grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-4">
                {[
                  ["Gold", frame.total_gold.toLocaleString()],
                  [
                    "CS",
                    (
                      frame.minions_killed + frame.jungle_minions_killed
                    ).toString(),
                  ],
                  ["Level", frame.level.toString()],
                  ["XP", frame.xp.toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-scout-subtle">{label}</dt>
                    <dd className="text-lg font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              {difference === undefined || opponent === undefined ? (
                <p className="text-sm text-scout-subtle">
                  Lane comparison unavailable.
                </p>
              ) : (
                <div className="border-t pt-3">
                  <p className="mb-2 text-sm text-scout-subtle">
                    Compared with {participantName(opponent)}
                  </p>
                  <p className="font-medium tabular-nums">
                    {signed(difference.gold)} gold · {signed(difference.cs)} CS
                    · {signed(difference.xp)} XP
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <section className="space-y-3">
        <h3 className="text-xl font-semibold">Key moments</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1" role="group" aria-label="Event type">
            {[
              ["all", "All"],
              ["kills", "Kills"],
              ["objectives", "Objectives"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={category === value ? "default" : "outline"}
                aria-pressed={category === value}
                onClick={() => {
                  setCategory(value ?? "all");
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className="text-sm">
            Team
            <select
              className="ml-2 rounded border bg-background p-2"
              value={teamFilter}
              onChange={(event) => {
                setTeamFilter(Number(event.target.value));
              }}
            >
              <option value={0}>Both teams</option>
              {props.teams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {teamName(team.teamId)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Player
            <select
              className="ml-2 max-w-52 rounded border bg-background p-2"
              value={playerFilter}
              onChange={(event) => {
                setPlayerFilter(Number(event.target.value));
              }}
            >
              <option value={0}>Everyone</option>
              {participants.map((p) => (
                <option key={p.participantId} value={p.participantId}>
                  {participantName(p)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-scout-subtle">
            No events match these filters.
          </p>
        ) : (
          <ol
            className="max-h-96 divide-y overflow-y-auto rounded-md border"
            aria-label="Key moments"
          >
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  className="flex w-full gap-4 px-4 py-3 text-left text-sm hover:bg-muted aria-pressed:bg-primary/10"
                  aria-pressed={event.timestampMs === time}
                  onClick={() => {
                    setTime(event.timestampMs);
                  }}
                >
                  <span className="w-12 shrink-0 font-semibold tabular-nums">
                    {matchClock(event.timestampMs)}
                  </span>
                  <span>{eventDescription(event, props.teams)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <details
        onToggle={(event) => {
          setAdvanced(event.currentTarget.open);
        }}
      >
        <summary className="cursor-pointer py-3 text-sm font-medium">
          Advanced data
        </summary>
        {advanced && (
          <MatchTimeline
            source={props.source}
            matchId={props.matchId}
            coverage={props.data.coverage}
            participantIds={participants.map((p) => p.participantId)}
          />
        )}
      </details>
    </div>
  );
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}
