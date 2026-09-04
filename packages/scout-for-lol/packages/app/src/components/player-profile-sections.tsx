import {
  championNameToDisplayName,
  divisionToString,
  type Rank,
} from "@scout-for-lol/data";
import { SCOUT_RANKS } from "@scout-for-lol/design-system/assets";
import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
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
import { ChampionIcon } from "#src/components/champion-icon.tsx";
import { formatRiotId } from "#src/lib/riot-id-format.ts";
import { RankDisplay } from "@scout-for-lol/design-system/domain/rank-display";

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
        <RankValue rank={props.rank} />
      </CardContent>
    </Card>
  );
}

function scoutRank(rank: Rank) {
  const display = SCOUT_RANKS.find(
    (candidate) => candidate.toLowerCase() === rank.tier,
  );
  if (display === undefined) {
    throw new Error(`No crest exists for rank tier ${rank.tier}`);
  }
  return display;
}

export function RankValue(props: {
  rank: Rank | undefined;
  compact?: boolean;
}) {
  if (props.rank === undefined) {
    return <p className="text-lg font-semibold">Unranked</p>;
  }
  return (
    <RankDisplay
      rank={scoutRank(props.rank)}
      division={divisionToString(props.rank.division)}
      leaguePoints={props.rank.lp}
      {...(props.compact === undefined ? {} : { compact: props.compact })}
      className="text-scout-ink"
    />
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

export function PlayerSummaryCards(props: {
  ranks: { solo?: Rank; flex?: Rank; ranked5s?: Rank };
  recentForm: RecentForm | null;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <RankCard label="Ranked solo/duo" rank={props.ranks.solo} />
      <RankCard label="Ranked flex" rank={props.ranks.flex} />
      <RankCard label="Ranked 5s" rank={props.ranks.ranked5s} />
      {props.recentForm === null ? null : (
        <RecentFormCard form={props.recentForm} />
      )}
    </div>
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
  profileSearch: string;
}) {
  const [page, setPage] = useState(0);
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
          {props.rows.slice(page * 10, page * 10 + 10).map((row) => (
            <TableRow key={row.championId}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <ChampionIcon championName={row.championName} decorative />
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    to={`/champions/${row.championId.toString()}${props.profileSearch}`}
                  >
                    {championNameToDisplayName(row.championName)}
                  </Link>
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
      {props.rows.length > 10 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Page {(page + 1).toString()} of{" "}
            {Math.ceil(props.rows.length / 10).toString()}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => {
                setPage((current) => current - 1);
              }}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={(page + 1) * 10 >= props.rows.length}
              onClick={() => {
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
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
  account: {
    gameName: string | null;
    tagLine: string | null;
    region: string;
  };
};

function matchAccountLabel(account: MatchEntry["account"]): string {
  return formatRiotId(account, account.region);
}

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

export function MatchHistoryList(props: {
  entries: MatchEntry[];
  playerId?: number;
  profileSearch: string;
}) {
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
              ? "border-scout-success bg-scout-success/10"
              : "border-scout-danger bg-scout-danger/10"
          }`}
        >
          <ChampionIcon championName={entry.championName} size="md" />
          <div className="min-w-32">
            <p className="text-sm font-medium text-scout-ink">
              {props.playerId === undefined ? (
                entry.win ? (
                  "Victory"
                ) : (
                  "Defeat"
                )
              ) : (
                <Link
                  className="underline-offset-4 hover:underline"
                  to={`/players/${props.playerId.toString()}/matches/${encodeURIComponent(entry.matchId)}${props.profileSearch}`}
                >
                  {entry.win ? "Victory" : "Defeat"}
                </Link>
              )}
            </p>
            <p className="text-xs text-scout-ink">
              {entry.queue ?? "Unknown queue"} ·{" "}
              {Math.round(entry.gameDurationSeconds / 60).toString()}m ·{" "}
              {formatRelative(entry.gameCreationMs)}
            </p>
            <p className="mt-1 text-xs text-scout-subtle">
              {matchAccountLabel(entry.account)}
            </p>
          </div>
          <div className="min-w-28">
            <p className="text-sm font-medium text-scout-ink">
              {entry.kills.toString()} / {entry.deaths.toString()} /{" "}
              {entry.assists.toString()}
            </p>
            <p className="text-xs text-scout-ink">
              {formatKda(entry.kills, entry.deaths, entry.assists)} KDA
            </p>
          </div>
          <div className="min-w-28">
            <p className="text-sm text-scout-ink">
              {entry.creepScore.toString()} CS
              <span className="text-scout-ink">
                {" "}
                ({entry.csPerMinute.toFixed(1)}/m)
              </span>
            </p>
            <p className="text-xs text-scout-ink">
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
