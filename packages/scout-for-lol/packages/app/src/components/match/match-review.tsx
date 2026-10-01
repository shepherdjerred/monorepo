import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@scout-for-lol/design-system/components/tabs";
import {
  MatchScoreboards,
  RolePairedMatchScoreboard,
  type MatchTeam,
  type RoleMatchup,
} from "./match-scoreboard.tsx";
import {
  MatchReviewTimeline,
  type ReviewSource,
} from "./match-review-timeline.tsx";
import { ChampionIcon } from "./champion-icon.tsx";
import {
  laneOpponent,
  participantName,
  teamName,
} from "#src/lib/player/match-review.ts";

export function MatchReview(props: {
  source: ReviewSource;
  matchId: string;
  teams: MatchTeam[];
  showRiftMap: boolean;
  durationSeconds: number;
  matchups?: RoleMatchup[] | null;
  arena?: ReactNode;
  children?: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState(
    props.teams
      .flatMap((team) => team.participants)
      .find((p) => p.selectedPlayer === true)?.participantId,
  );
  const selected = props.teams
    .flatMap((team) => team.participants)
    .find((p) => p.participantId === selectedId);
  const opponent =
    props.matchups == null ? undefined : laneOpponent(selected, props.teams);
  const teams = props.teams.map((team) => ({
    ...team,
    participants: team.participants.map((p) => ({
      ...p,
      selectedPlayer: p.participantId === selectedId,
    })),
  }));
  return (
    <div className="space-y-5">
      <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
        Review player
        <select
          className="max-w-full rounded-md border bg-background p-2"
          value={selectedId ?? ""}
          onChange={(event) => {
            setSelectedId(
              event.target.value === ""
                ? undefined
                : Number(event.target.value),
            );
          }}
        >
          <option value="">Team overview</option>
          {teams.map((team) => (
            <optgroup key={team.teamId} label={teamName(team.teamId)}>
              {team.participants.map((p) => (
                <option key={p.participantId} value={p.participantId}>
                  {participantName(p)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <Tabs
        value={params.get("view") === "timeline" ? "timeline" : "overview"}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("view", value);
          setParams(next, { replace: true });
        }}
      >
        <TabsList aria-label="Match review">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6">
          {selected !== undefined && (
            <section className="space-y-4 border-b pb-5">
              <div className="flex items-center gap-3">
                <ChampionIcon championName={selected.championName} size="md" />
                <div>
                  <h2 className="text-xl font-semibold">
                    {participantName(selected)}
                  </h2>
                  <p className="text-sm text-scout-subtle">
                    {teams.find((team) =>
                      team.participants.some(
                        (p) => p.participantId === selectedId,
                      ),
                    )?.win === true
                      ? "Victory"
                      : "Defeat"}
                    {opponent === undefined
                      ? ""
                      : ` · vs ${participantName(opponent)}`}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-4 tabular-nums sm:grid-cols-4">
                {[
                  [
                    "K / D / A",
                    `${selected.kills.toString()} / ${selected.deaths.toString()} / ${selected.assists.toString()}`,
                  ],
                  [
                    "CS / min",
                    props.durationSeconds > 0
                      ? (
                          selected.creepScore /
                          (props.durationSeconds / 60)
                        ).toFixed(1)
                      : "—",
                  ],
                  [
                    "Kill participation",
                    selected.killParticipation === null
                      ? "—"
                      : `${Math.round(selected.killParticipation * 100).toString()}%`,
                  ],
                  [
                    "Champion damage",
                    selected.damageToChampions.toLocaleString(),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-scout-subtle">{label}</dt>
                    <dd className="text-xl font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <TeamComparison teams={teams} />
          {props.arena ??
            (props.matchups !== null && props.matchups !== undefined ? (
              <RolePairedMatchScoreboard
                teams={teams}
                matchups={props.matchups}
              />
            ) : (
              <MatchScoreboards teams={teams} showLoadout />
            ))}
          {props.children}
        </TabsContent>
        <TabsContent value="timeline">
          <MatchReviewTimeline
            source={props.source}
            matchId={props.matchId}
            teams={teams}
            showRiftMap={props.showRiftMap}
            compareLanes={props.matchups != null}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TeamComparison(props: { teams: MatchTeam[] }) {
  const [blue, red] = props.teams;
  if (blue === undefined || red === undefined || props.teams.length !== 2)
    return null;
  const stats = [
    {
      label: "Kills",
      get: (team: MatchTeam) =>
        team.participants.reduce((sum, p) => sum + p.kills, 0),
    },
    {
      label: "Gold",
      get: (team: MatchTeam) =>
        team.participants.reduce((sum, p) => sum + p.goldEarned, 0),
    },
    { label: "Turrets", get: (team: MatchTeam) => team.objectives.turrets },
    { label: "Dragons", get: (team: MatchTeam) => team.objectives.dragons },
    { label: "Barons", get: (team: MatchTeam) => team.objectives.barons },
  ];
  return (
    <section className="space-y-3" aria-label="Team comparison">
      <div className="flex justify-between text-sm font-semibold">
        <span>
          {teamName(blue.teamId)} · {blue.win ? "Victory" : "Defeat"}
        </span>
        <span>
          {teamName(red.teamId)} · {red.win ? "Victory" : "Defeat"}
        </span>
      </div>
      {stats.map((stat) => {
        const left = stat.get(blue);
        const right = stat.get(red);
        return (
          <div key={stat.label}>
            <div className="grid grid-cols-3 text-sm tabular-nums">
              <span>{left.toLocaleString()}</span>
              <span className="text-center text-scout-subtle">
                {stat.label}
              </span>
              <span className="text-right">{right.toLocaleString()}</span>
            </div>
            <div
              className="mt-1 flex h-1.5 overflow-hidden rounded bg-muted"
              aria-hidden="true"
            >
              <span
                className="bg-sky-600"
                style={{
                  width: `${(left + right === 0 ? 50 : (left / (left + right)) * 100).toString()}%`,
                }}
              />
              <span className="flex-1 bg-rose-500" />
            </div>
          </div>
        );
      })}
    </section>
  );
}
