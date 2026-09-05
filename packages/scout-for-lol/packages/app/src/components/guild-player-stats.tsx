import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Section } from "#src/components/player-detail-sections.tsx";
import {
  ChampionPoolTable,
  MatchHistoryList,
  PlayerSummaryCards,
} from "#src/components/player-profile-sections.tsx";

export function GuildPlayerStats(props: { guildId: string; alias: string }) {
  const trpc = useTRPC();
  const summaryQuery = useQuery(
    trpc.player.profileSummary.queryOptions({
      guildId: props.guildId,
      alias: props.alias,
    }),
  );
  const historyQuery = useQuery(
    trpc.player.matchHistory.queryOptions(
      { guildId: props.guildId, alias: props.alias, limit: 20 },
      { enabled: summaryQuery.isSuccess },
    ),
  );

  if (summaryQuery.isPending) {
    return <p className="text-sm text-scout-subtle">Loading player stats…</p>;
  }
  if (summaryQuery.isError) {
    return (
      <p className="text-sm text-scout-danger">
        Couldn&apos;t load player stats.
      </p>
    );
  }
  const summary = summaryQuery.data;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Gameplay stats</h2>
        <p className="text-sm text-scout-subtle">
          Games Scout has recorded for this server.
        </p>
      </div>
      <PlayerSummaryCards
        ranks={summary.ranks}
        recentForm={summary.recentForm}
      />
      <Section title="Champions">
        <ChampionPoolTable
          rows={summary.championPool}
          minGamesForRate={summary.minGamesForRate}
          profileSearch=""
        />
      </Section>
      <Section title="Match history">
        {historyQuery.isPending ? (
          <p className="text-sm text-scout-subtle">Loading games…</p>
        ) : historyQuery.isError ? (
          <p className="text-sm text-scout-danger">
            Couldn&apos;t load match history.
          </p>
        ) : (
          <MatchHistoryList
            entries={historyQuery.data.entries}
            profileSearch=""
          />
        )}
      </Section>
    </div>
  );
}
