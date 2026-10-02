import { Link } from "react-router";
import {
  championNameToDisplayName,
  computeKda,
  laneToString,
  type Lane,
  type MatchLoadout,
} from "@scout-for-lol/data";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { ChampionIcon } from "#src/components/match/champion-icon.tsx";
import { MatchObjectivesSummary } from "#src/components/match/match-objectives-summary.tsx";
import { MatchLoadoutDisplay } from "#src/components/match/match-loadout.tsx";
import { formatRiotId } from "#src/lib/format/riot-id-format.ts";

export type MatchParticipant = {
  participantId: number;
  teamId?: number | undefined;
  selectedPlayer?: boolean | undefined;
  riotId: { gameName: string | null; tagLine: string | null };
  championId: number;
  championName: string;
  position: string;
  win?: boolean | undefined;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  goldEarned: number;
  visionScore: number;
  damageToChampions: number;
  killParticipation: number | null;
  damageShare: number | null;
  objectives: {
    turrets: number;
    inhibitors: number;
    barons: number;
    dragons: number;
  };
  loadout?: MatchLoadout | undefined;
  augments?: { id: number; name: string | null }[] | undefined;
  scoutAliases?:
    { playerId: number; alias: string; guildName: string }[] | undefined;
};

export type MatchTeam = {
  teamId: number;
  win: boolean;
  participants: MatchParticipant[];
  objectives: {
    turrets: number;
    inhibitors: number;
    barons: number;
    dragons: number;
  };
};

export type RoleMatchup = {
  role: Lane;
  blueParticipantId: number;
  redParticipantId: number;
  at15: {
    timestampMs: number;
    goldDelta: number;
    creepScoreDelta: number;
    xpDelta: number;
  } | null;
};

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100).toString()}%`;
}

function kda(participant: MatchParticipant): string {
  return computeKda(participant).toFixed(2);
}

function formatAugments(augments: MatchParticipant["augments"]): string {
  return augments === undefined || augments.length === 0
    ? "—"
    : augments
        .map((augment) => augment.name ?? `#${augment.id.toString()}`)
        .join(" · ");
}

export function MatchScoreboards(props: {
  teams: MatchTeam[];
  showLoadout?: boolean;
}) {
  return (
    <div className="space-y-5">
      {props.teams.map((team) => (
        <Card key={team.teamId}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                {team.teamId === 100
                  ? "Blue team"
                  : team.teamId === 200
                    ? "Red team"
                    : `Team ${team.teamId.toString()}`}
                <Badge variant={team.win ? "default" : "outline"}>
                  {team.win ? "Victory" : "Defeat"}
                </Badge>
              </CardTitle>
              <p className="text-xs text-scout-subtle">
                <MatchObjectivesSummary objectives={team.objectives} />
              </p>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead className="text-right">K / D / A</TableHead>
                  <TableHead className="text-right">KDA</TableHead>
                  <TableHead className="text-right">CS</TableHead>
                  <TableHead className="text-right">Gold</TableHead>
                  <TableHead className="text-right">Vision</TableHead>
                  <TableHead className="text-right">Damage</TableHead>
                  <TableHead className="text-right">KP</TableHead>
                  <TableHead className="text-right">Damage share</TableHead>
                  {props.showLoadout === true && <TableHead>Loadout</TableHead>}
                  {team.participants.some(
                    (participant) => (participant.augments?.length ?? 0) > 0,
                  ) && <TableHead>Augments</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.participants.map((participant) => (
                  <TableRow
                    key={participant.participantId}
                    className={
                      participant.selectedPlayer === true
                        ? "bg-scout-brand/10"
                        : undefined
                    }
                  >
                    <TableCell>
                      <div className="flex min-w-48 items-center gap-2">
                        <ChampionIcon championName={participant.championName} />
                        <div>
                          <p className="font-medium">
                            {formatRiotId(
                              participant.riotId,
                              "Unknown Riot ID",
                            )}
                            {participant.selectedPlayer === true && (
                              <span className="ml-2 text-xs text-scout-brand">
                                Selected
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-scout-subtle">
                            {championNameToDisplayName(
                              participant.championName,
                            )}
                          </p>
                          {(participant.scoutAliases?.length ?? 0) > 0 && (
                            <p className="text-xs text-scout-subtle">
                              {participant.scoutAliases?.map((alias, index) => (
                                <span
                                  key={`${alias.guildName}:${alias.playerId.toString()}`}
                                >
                                  {index > 0 ? " · " : ""}
                                  <Link
                                    className="hover:underline"
                                    to={`/players/${alias.playerId.toString()}`}
                                  >
                                    {alias.alias} ({alias.guildName})
                                  </Link>
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{participant.position || "—"}</TableCell>
                    <TableCell className="text-right">
                      {participant.kills.toString()} /{" "}
                      {participant.deaths.toString()} /{" "}
                      {participant.assists.toString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {kda(participant)}
                    </TableCell>
                    <TableCell className="text-right">
                      {participant.creepScore.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {participant.goldEarned.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {participant.visionScore.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {participant.damageToChampions.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {percent(participant.killParticipation)}
                    </TableCell>
                    <TableCell className="text-right">
                      {percent(participant.damageShare)}
                    </TableCell>
                    {props.showLoadout === true && (
                      <TableCell>
                        {participant.loadout === undefined ? (
                          "—"
                        ) : (
                          <MatchLoadoutDisplay loadout={participant.loadout} />
                        )}
                      </TableCell>
                    )}
                    {team.participants.some(
                      (member) => (member.augments?.length ?? 0) > 0,
                    ) && (
                      <TableCell className="min-w-40 text-xs">
                        {formatAugments(participant.augments)}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function requireTeam(teams: MatchTeam[], teamId: number): MatchTeam {
  const team = teams.find((candidate) => candidate.teamId === teamId);
  if (team === undefined) {
    throw new Error(
      `Role-paired scoreboard is missing team ${teamId.toString()}`,
    );
  }
  return team;
}

function requireParticipant(
  teams: MatchTeam[],
  participantId: number,
): MatchParticipant {
  const participant = teams
    .flatMap((team) => team.participants)
    .find((candidate) => candidate.participantId === participantId);
  if (participant === undefined) {
    throw new Error(
      `Role-paired scoreboard is missing participant ${participantId.toString()}`,
    );
  }
  return participant;
}

function ParticipantPanel(props: {
  participant: MatchParticipant;
  align: "left" | "right";
}) {
  const reverse = props.align === "right";
  if (props.participant.loadout === undefined) {
    throw new Error("Role-paired participant is missing a loadout");
  }
  return (
    <div
      className={`space-y-2 rounded-md p-3 ${
        props.participant.selectedPlayer === true ? "bg-scout-brand/10" : ""
      }`}
    >
      <div
        className={`flex items-center gap-2 ${reverse ? "flex-row-reverse text-right" : ""}`}
      >
        <ChampionIcon championName={props.participant.championName} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {formatRiotId(props.participant.riotId, "Unknown Riot ID")}
            {props.participant.selectedPlayer === true && (
              <span className="ml-1 text-xs text-scout-brand">Selected</span>
            )}
          </p>
          <p className="text-xs text-scout-subtle">
            {championNameToDisplayName(props.participant.championName)}
          </p>
        </div>
      </div>
      <p className={`text-sm ${reverse ? "text-right" : ""}`}>
        <span className="font-medium">
          {props.participant.kills.toString()} /{" "}
          {props.participant.deaths.toString()} /{" "}
          {props.participant.assists.toString()}
        </span>
        <span className="text-scout-subtle">
          {" "}
          · {kda(props.participant)} KDA
        </span>
      </p>
      <p className={`text-xs text-scout-subtle ${reverse ? "text-right" : ""}`}>
        {props.participant.creepScore.toLocaleString()} CS ·{" "}
        {props.participant.goldEarned.toLocaleString()} gold ·{" "}
        {props.participant.damageToChampions.toLocaleString()} damage ·{" "}
        {props.participant.visionScore.toLocaleString()} vision ·{" "}
        {percent(props.participant.killParticipation)} KP
      </p>
      <div className={reverse ? "flex justify-end" : ""}>
        <MatchLoadoutDisplay loadout={props.participant.loadout} />
      </div>
      {(props.participant.scoutAliases?.length ?? 0) > 0 && (
        <p
          className={`text-xs text-scout-subtle ${reverse ? "text-right" : ""}`}
        >
          {props.participant.scoutAliases?.map((alias, index) => (
            <span key={`${alias.guildName}:${alias.playerId.toString()}`}>
              {index > 0 ? " · " : ""}
              <Link
                className="hover:underline"
                to={`/players/${alias.playerId.toString()}`}
              >
                {alias.alias} ({alias.guildName})
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

function LaneDelta(props: { matchup: RoleMatchup; redPerspective: boolean }) {
  const direction = props.redPerspective ? -1 : 1;
  return (
    <div className="px-2 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
        {laneToString(props.matchup.role)}
      </p>
      {props.matchup.at15 === null ? (
        <p className="mt-2 text-xs text-scout-subtle">15m unavailable</p>
      ) : (
        <div
          className="mt-1 space-y-0.5 text-xs"
          aria-label={`${props.redPerspective ? "Red" : "Blue"} side advantage at 15 minutes`}
        >
          <p>{signed(props.matchup.at15.goldDelta * direction)} gold</p>
          <p>{signed(props.matchup.at15.creepScoreDelta * direction)} CS</p>
          <p>{signed(props.matchup.at15.xpDelta * direction)} XP</p>
          <p className="text-xs text-scout-subtle">
            {props.redPerspective ? "Red" : "Blue"} advantage · 15m
          </p>
          {props.matchup.at15.timestampMs !== 900_000 && (
            <p className="text-xs text-scout-subtle">
              Snapshot {Math.floor(props.matchup.at15.timestampMs / 60_000)}:
              {Math.floor((props.matchup.at15.timestampMs % 60_000) / 1000)
                .toString()
                .padStart(2, "0")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function RolePairedMatchScoreboard(props: {
  teams: MatchTeam[];
  matchups: RoleMatchup[];
}) {
  const blue = requireTeam(props.teams, 100);
  const red = requireTeam(props.teams, 200);
  return (
    <Card>
      <CardHeader>
        <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
          <div>
            <CardTitle className="flex items-center gap-2">
              Blue team
              <Badge variant={blue.win ? "default" : "outline"}>
                {blue.win ? "Victory" : "Defeat"}
              </Badge>
            </CardTitle>
            <p className="mt-1 text-xs text-scout-subtle">
              <MatchObjectivesSummary objectives={blue.objectives} />
            </p>
          </div>
          <p className="hidden pt-1 text-center text-xs text-scout-subtle md:block">
            Lane matchup
          </p>
          <div className="text-right">
            <CardTitle className="flex items-center justify-end gap-2">
              <Badge variant={red.win ? "default" : "outline"}>
                {red.win ? "Victory" : "Defeat"}
              </Badge>
              Red team
            </CardTitle>
            <p className="mt-1 text-xs text-scout-subtle">
              <MatchObjectivesSummary objectives={red.objectives} />
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <div className="divide-y">
          {props.matchups.map((matchup) => (
            <div
              key={matchup.role}
              className="grid grid-cols-1 items-center gap-3 py-2 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]"
            >
              <ParticipantPanel
                participant={requireParticipant(
                  props.teams,
                  matchup.blueParticipantId,
                )}
                align="left"
              />
              <LaneDelta
                matchup={matchup}
                redPerspective={red.participants.some(
                  (p) => p.selectedPlayer === true,
                )}
              />
              <ParticipantPanel
                participant={requireParticipant(
                  props.teams,
                  matchup.redParticipantId,
                )}
                align="right"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
