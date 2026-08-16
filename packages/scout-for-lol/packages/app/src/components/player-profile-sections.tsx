import {
  championNameToDisplayName,
  rankToString,
  type Rank,
} from "@scout-for-lol/data";
import { ChampionIcon } from "#src/components/champion-icon.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100).toString()}%`;
}

function formatKda(kills: number, deaths: number, assists: number): string {
  const value = deaths === 0 ? kills + assists : (kills + assists) / deaths;
  return value.toFixed(2);
}

function formatRelative(epochMs: number): string {
  const days = Math.floor((Date.now() - epochMs) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days.toString()}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

export function RankCard(props: { label: string; rank: Rank | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">
          {props.rank === undefined ? "Unranked" : rankToString(props.rank)}
        </p>
      </CardContent>
    </Card>
  );
}

type RecentForm = {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  averageKillParticipation: number | null;
};

export function RecentFormCard(props: { form: RecentForm }) {
  const { form } = props;
  const losses = form.games - form.wins;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Last {form.games.toString()} games
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-lg font-semibold">
          {form.wins.toString()}W {losses.toString()}L
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {formatPercent(form.games > 0 ? form.wins / form.games : null)}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {formatKda(form.kills, form.deaths, form.assists)} KDA ·{" "}
          {formatPercent(form.averageKillParticipation)} kill participation
        </p>
      </CardContent>
    </Card>
  );
}

type ChampionRow = {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  winRate: number;
  kda: number;
  csPerMinute: number;
  lowSample: boolean;
};

export function ChampionPoolTable(props: {
  rows: ChampionRow[];
  minGamesForRate: number;
}) {
  if (props.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No games in Scout&apos;s history for this player yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Champion</TableHead>
            <TableHead className="text-right">Games</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead className="text-right">KDA</TableHead>
            <TableHead className="text-right">CS/min</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <TableRow key={row.championId}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <ChampionIcon championName={row.championName} />
                  {championNameToDisplayName(row.championName)}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {row.games.toString()}
              </TableCell>
              <TableCell className="text-right">
                {/* A rate over a handful of games is noise; say so rather than
                    printing a confident number next to a real one. */}
                {row.lowSample ? (
                  <span className="text-muted-foreground">
                    {formatPercent(row.winRate)}*
                  </span>
                ) : (
                  formatPercent(row.winRate)
                )}
              </TableCell>
              <TableCell className="text-right">{row.kda.toFixed(2)}</TableCell>
              <TableCell className="text-right">
                {row.csPerMinute.toFixed(1)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {props.rows.some((row) => row.lowSample) && (
        <p className="text-xs text-muted-foreground">
          * Fewer than {props.minGamesForRate.toString()} games — treat the rate
          as indicative only.
        </p>
      )}
    </div>
  );
}

type MatchEntry = {
  matchId: string;
  gameCreationMs: number;
  gameDurationSeconds: number;
  queue: string | null;
  championName: string;
  teamPosition: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  csPerMinute: number;
  killParticipation: number | null;
  leaguePointsDelta: number | null;
};

function LeaguePointsBadge(props: { delta: number | null }) {
  if (props.delta === null) return null;
  const positive = props.delta >= 0;
  return (
    <span
      className={
        positive
          ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
          : "text-xs font-medium text-red-600 dark:text-red-400"
      }
    >
      {positive ? "+" : ""}
      {props.delta.toString()} LP
    </span>
  );
}

export function MatchHistoryList(props: { entries: MatchEntry[] }) {
  if (props.entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Scout hasn&apos;t recorded any games for this player yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {props.entries.map((entry) => (
        <li
          key={entry.matchId}
          className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${
            entry.win
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
              : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
          }`}
        >
          <ChampionIcon championName={entry.championName} size="md" />
          <div className="min-w-32">
            <p className="text-sm font-medium">
              {entry.win ? "Victory" : "Defeat"}
            </p>
            <p className="text-xs text-muted-foreground">
              {entry.queue ?? "Unknown queue"} ·{" "}
              {Math.round(entry.gameDurationSeconds / 60).toString()}m ·{" "}
              {formatRelative(entry.gameCreationMs)}
            </p>
          </div>
          <div className="min-w-28">
            <p className="text-sm font-medium">
              {entry.kills.toString()} / {entry.deaths.toString()} /{" "}
              {entry.assists.toString()}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatKda(entry.kills, entry.deaths, entry.assists)} KDA
            </p>
          </div>
          <div className="min-w-28">
            <p className="text-sm">
              {entry.creepScore.toString()} CS
              <span className="text-muted-foreground">
                {" "}
                ({entry.csPerMinute.toFixed(1)}/m)
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {formatPercent(entry.killParticipation)} KP
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {entry.teamPosition.length > 0 && (
              <Badge variant="outline">{entry.teamPosition}</Badge>
            )}
            <LeaguePointsBadge delta={entry.leaguePointsDelta} />
          </div>
        </li>
      ))}
    </ul>
  );
}
