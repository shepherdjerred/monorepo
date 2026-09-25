import { computeKda, divisionToString, type Rank } from "@scout-for-lol/data";
import { SCOUT_RANKS } from "@scout-for-lol/design-system/assets";
import { Link } from "react-router";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ChampionIcon } from "#src/components/match/champion-icon.tsx";
import { formatRiotId } from "#src/lib/format/riot-id-format.ts";
import { regionName } from "#src/lib/regions.ts";
import { RankDisplay } from "@scout-for-lol/design-system/domain/rank-display";

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100).toString()}%`;
}

function formatKda(kills: number, deaths: number, assists: number): string {
  return computeKda({ kills, deaths, assists }).toFixed(2);
}

function formatRelative(epochMs: number): string {
  const days = Math.floor((Date.now() - epochMs) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return days < 30
    ? `${days.toString()}d ago`
    : new Date(epochMs).toLocaleDateString();
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

export function formatPosition(position: string): string {
  const normalized = position.trim().toUpperCase();
  const map: Record<string, string> = {
    TOP: "Top",
    JUNGLE: "Jungle",
    MIDDLE: "Mid",
    MID: "Mid",
    BOTTOM: "Bot",
    BOT: "Bot",
    UTILITY: "Support",
    SUPPORT: "Support",
  };
  return map[normalized] ?? position;
}

type RecentForm = {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  averageKillParticipation: number | null;
  averageCs?: number | null;
  averageCsPerMinute?: number | null;
  averageVisionScore?: number | null;
  preferredPositions?: {
    position: string;
    games: number;
    percentage: number;
  }[];
};

export function RecentFormCard(props: {
  form: RecentForm;
  className?: string | undefined;
}) {
  const { form } = props;
  const losses = form.games - form.wins;
  return (
    <Card className={props.className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Last {form.games.toString()} games
          </CardTitle>
          {form.preferredPositions && form.preferredPositions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {form.preferredPositions.map((pos) => (
                <Badge
                  key={pos.position}
                  variant="secondary"
                  className="px-1.5 py-0 text-[11px] font-medium"
                >
                  {formatPosition(pos.position)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-lg font-semibold">
            {form.wins.toString()}W {losses.toString()}L
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {formatPercent(form.games > 0 ? form.wins / form.games : null)}
            </span>
          </p>
          <p className="text-sm font-medium text-muted-foreground">
            {formatKda(form.kills, form.deaths, form.assists)} KDA
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-xs">
          <div>
            <p className="text-muted-foreground">Kill part.</p>
            <p className="font-semibold text-foreground">
              {formatPercent(form.averageKillParticipation)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">CS / min</p>
            <p className="font-semibold text-foreground">
              {form.averageCsPerMinute !== null &&
              form.averageCsPerMinute !== undefined
                ? `${form.averageCsPerMinute.toFixed(1)}/m`
                : "—"}
              {form.averageCs !== null && form.averageCs !== undefined ? (
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  ({Math.round(form.averageCs).toString()})
                </span>
              ) : null}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Vision</p>
            <p className="font-semibold text-foreground">
              {form.averageVisionScore !== null &&
              form.averageVisionScore !== undefined
                ? form.averageVisionScore.toFixed(1)
                : "—"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PlayerSummaryCards(props: {
  ranks: { solo?: Rank; flex?: Rank; ranked5s?: Rank };
  recentForm: RecentForm | null;
}) {
  const hasRanked5s = props.ranks.ranked5s !== undefined;
  const rankCount =
    (props.ranks.solo ? 1 : 0) +
    (props.ranks.flex ? 1 : 0) +
    (hasRanked5s ? 1 : 0);

  if (rankCount === 0 && props.recentForm === null) {
    return null;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {props.ranks.solo !== undefined && (
        <RankCard label="Ranked solo/duo" rank={props.ranks.solo} />
      )}
      {props.ranks.flex !== undefined && (
        <RankCard label="Ranked flex" rank={props.ranks.flex} />
      )}
      {props.ranks.ranked5s !== undefined && (
        <RankCard label="Ranked 5s" rank={props.ranks.ranked5s} />
      )}
      {props.recentForm !== null && (
        <RecentFormCard
          className={rankCount <= 2 ? "sm:col-span-2" : undefined}
          form={props.recentForm}
        />
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
  return formatRiotId(account, regionName(account.region));
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
      <p className="text-sm text-scout-subtle">
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
              ? "border-scout-success-fill bg-scout-success-fill/10"
              : "border-scout-danger-fill bg-scout-danger-fill/10"
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
              <Badge variant="outline">
                {formatPosition(entry.teamPosition)}
              </Badge>
            )}
            <LeaguePointsBadge delta={entry.leaguePointsDelta} />
          </div>
        </li>
      ))}
    </ul>
  );
}
