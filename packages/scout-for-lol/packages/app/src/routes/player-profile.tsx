import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { usePlayerParams } from "#src/lib/route-params.ts";
import { PlayerTabsNav } from "#src/components/player-tabs-nav.tsx";
import { Section } from "#src/components/player-detail-sections.tsx";
import {
  ChampionPoolTable,
  MatchHistoryList,
  RankCard,
  RecentFormCard,
} from "#src/components/player-profile-sections.tsx";

/**
 * A player's gameplay profile over the matches Scout ingested for this server.
 *
 * The denominator matters and is stated in the UI: this is not the League
 * ladder, it is the games Scout happened to watch. Rates over a handful of
 * games are marked rather than printed as if they were solid.
 */
export function PlayerProfile() {
  const { guildId, alias } = usePlayerParams();
  const trpc = useTRPC();

  const summaryQuery = useSuspenseQuery(
    trpc.player.profileSummary.queryOptions({ guildId, alias }),
  );
  const historyQuery = useQuery(
    trpc.player.matchHistory.queryOptions({ guildId, alias, limit: 20 }),
  );

  const summary = summaryQuery.data;
  const accountCount = summary.accountCount;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{alias}</h2>
        <p className="text-sm text-muted-foreground">
          {accountCount === 1
            ? "1 Riot account"
            : `${accountCount.toString()} Riot accounts combined`}
          {" · "}
          Games Scout has recorded for this server
        </p>
      </div>

      <PlayerTabsNav guildId={guildId} alias={alias} />

      <div className="grid gap-4 md:grid-cols-3">
        <RankCard label="Ranked solo/duo" rank={summary.ranks.solo} />
        <RankCard label="Ranked flex" rank={summary.ranks.flex} />
        {summary.recentForm !== null && (
          <RecentFormCard form={summary.recentForm} />
        )}
      </div>

      <Section title="Champions">
        <ChampionPoolTable
          rows={summary.championPool}
          minGamesForRate={summary.minGamesForRate}
        />
      </Section>

      <Section title="Match history">
        {historyQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading games…</p>
        ) : historyQuery.isError ? (
          <p className="text-sm text-destructive">
            Couldn&apos;t load match history.
          </p>
        ) : (
          <MatchHistoryList entries={historyQuery.data.entries} />
        )}
      </Section>
    </div>
  );
}
