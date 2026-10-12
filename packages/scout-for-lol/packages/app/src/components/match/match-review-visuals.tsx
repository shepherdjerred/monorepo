import { getChampionImageUrl } from "@scout-for-lol/data";
import type { MatchTeam } from "./match-scoreboard.tsx";
import {
  matchClock,
  participantName,
  projectRiftPosition,
  teamName,
  type ReviewSnapshot,
} from "#src/lib/player/match-review.ts";

export function ComparePlayer(props: {
  teams: MatchTeam[];
  selectedId: number | undefined;
  onSelect: (id: number) => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>Compare player</span>
      <select
        className="w-full rounded border bg-background p-2"
        value={props.selectedId ?? ""}
        onChange={(event) => {
          props.onSelect(Number(event.target.value));
        }}
      >
        <option value="" disabled>
          Choose a player
        </option>
        {props.teams.map((team) => (
          <optgroup key={team.teamId} label={teamName(team.teamId)}>
            {team.participants.map((participant) => (
              <option
                key={participant.participantId}
                value={participant.participantId}
              >
                {participantName(participant)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function goldLead(value: number | null): string {
  return value === null
    ? "Gold comparison unavailable"
    : value === 0
      ? "Gold is even"
      : `${value > 0 ? "Blue" : "Red"} team leads by ${Math.abs(value).toLocaleString()} gold`;
}

export function GoldChart(props: {
  snapshots: ReviewSnapshot[];
  time: number;
}) {
  const points = props.snapshots.filter(
    (snapshot) => snapshot.goldDifference !== null,
  );
  const maxTime = Math.max(1, props.snapshots.at(-1)?.timestampMs ?? 0);
  const scale = Math.max(
    1000,
    ...points.map((point) => Math.abs(point.goldDifference ?? 0)),
  );
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${((point.timestampMs / maxTime) * 1000).toString()},${(90 - ((point.goldDifference ?? 0) / scale) * 75).toString()}`,
    )
    .join(" ");
  return (
    <div className="rounded-lg border p-3">
      <div className="flex justify-between text-xs text-scout-subtle">
        <span>Blue advantage</span>
        <span>{scale.toLocaleString()} gold</span>
      </div>
      <svg
        viewBox="0 0 1000 180"
        className="h-40 w-full"
        role="img"
        aria-label="Gold advantage over time. Values are available below and with the match time slider."
      >
        <line
          x1="0"
          x2="1000"
          y1="90"
          y2="90"
          stroke="currentColor"
          opacity="0.3"
        />
        <path
          d={path}
          fill="none"
          stroke="var(--scout-color-text)"
          strokeWidth="3"
        />
        <line
          x1={Math.min(props.time / maxTime, 1) * 1000}
          x2={Math.min(props.time / maxTime, 1) * 1000}
          y1="0"
          y2="180"
          stroke="var(--scout-color-text)"
          strokeDasharray="5 5"
        />
      </svg>
      <div className="flex justify-between text-xs text-scout-subtle">
        <span>Red advantage</span>
        <span>{matchClock(maxTime)}</span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">Gold values</summary>
        <div className="mt-2 max-h-48 overflow-y-auto">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">
              Team gold advantage at each snapshot
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Advantage</th>
              </tr>
            </thead>
            <tbody>
              {props.snapshots.map((snapshot) => (
                <tr key={snapshot.timestampMs}>
                  <th scope="row" className="font-normal">
                    {matchClock(snapshot.timestampMs)}
                  </th>
                  <td>{goldLead(snapshot.goldDifference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function RiftMap(props: {
  snapshot: ReviewSnapshot;
  teams: MatchTeam[];
  selectedId: number | undefined;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-lg bg-muted">
      <img
        src="/assets/scout/maps/summoners-rift-16.18.1.png"
        alt="Summoner’s Rift"
        width={512}
        height={512}
        className="h-full w-full"
      />
      {props.teams.flatMap((team) =>
        team.participants.map((participant) => {
          const frame = props.snapshot.frames.find(
            (row) => row.participant_id === participant.participantId,
          );
          if (frame === undefined) return null;
          const position = projectRiftPosition(
            frame.position_x,
            frame.position_y,
          );
          return (
            <button
              key={participant.participantId}
              type="button"
              onClick={() => {
                props.onSelect(participant.participantId);
              }}
              aria-label={`${participantName(participant)}, ${teamName(team.teamId)}, at ${matchClock(props.snapshot.timestampMs)}`}
              aria-pressed={props.selectedId === participant.participantId}
              style={{
                left: `clamp(14px, ${position.x.toString()}%, calc(100% - 14px))`,
                top: `clamp(14px, ${position.y.toString()}%, calc(100% - 14px))`,
                borderColor: team.teamId === 100 ? "#38bdf8" : "#fb7185",
              }}
              className="absolute size-7 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 bg-black shadow-md aria-pressed:z-10 aria-pressed:ring-2 aria-pressed:ring-white focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-white"
            >
              <img
                src={getChampionImageUrl(participant.championName)}
                alt=""
                className="h-full w-full"
              />
            </button>
          );
        }),
      )}
    </div>
  );
}
