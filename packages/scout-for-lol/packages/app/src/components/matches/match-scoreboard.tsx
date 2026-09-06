import { Link } from "react-router";
import { championNameToDisplayName } from "@scout-for-lol/data";
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
import { ChampionIcon } from "#src/components/matches/champion-icon.tsx";
import { formatRiotId } from "#src/lib/domain/riot-id-format.ts";

type MatchParticipant = {
  participantId: number;
  teamId: number;
  selectedPlayer: boolean;
  riotId: { gameName: string | null; tagLine: string | null };
  championId: number;
  championName: string;
  position: string;
  win: boolean;
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
  scoutAliases: { playerId: number; alias: string; guildName: string }[];
};

type MatchTeam = {
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

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100).toString()}%`;
}

function kda(participant: MatchParticipant): string {
  const value =
    participant.deaths === 0
      ? participant.kills + participant.assists
      : (participant.kills + participant.assists) / participant.deaths;
  return value.toFixed(2);
}

export function MatchScoreboards(props: { teams: MatchTeam[] }) {
  return (
    <div className="space-y-5">
      {props.teams.map((team) => (
        <Card key={team.teamId}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                Team {team.teamId.toString()}
                <Badge variant={team.win ? "default" : "outline"}>
                  {team.win ? "Victory" : "Defeat"}
                </Badge>
              </CardTitle>
              <p className="text-xs text-scout-subtle">
                {team.objectives.turrets.toString()} turrets ·{" "}
                {team.objectives.inhibitors.toString()} inhibitors ·{" "}
                {team.objectives.dragons.toString()} dragons ·{" "}
                {team.objectives.barons.toString()} barons
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.participants.map((participant) => (
                  <TableRow
                    key={participant.participantId}
                    className={
                      participant.selectedPlayer ? "bg-primary/10" : undefined
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
                            {participant.selectedPlayer && (
                              <span className="ml-2 text-xs text-primary">
                                Selected
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-scout-subtle">
                            {championNameToDisplayName(
                              participant.championName,
                            )}
                          </p>
                          {participant.scoutAliases.length > 0 && (
                            <p className="text-xs text-scout-subtle">
                              {participant.scoutAliases.map((alias, index) => (
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
