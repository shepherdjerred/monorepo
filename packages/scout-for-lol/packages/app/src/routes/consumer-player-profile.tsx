import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ConsumerGuildAvatar } from "#src/components/consumer-guild-avatar.tsx";
import { Section } from "#src/components/player-detail-sections.tsx";
import {
  ChampionPoolTable,
  MatchHistoryList,
  PlayerSummaryCards,
  RankValue,
} from "#src/components/player-profile-sections.tsx";
import { PlayerProfileFilterBar } from "#src/components/player-profile-filter-bar.tsx";
import { track } from "#src/lib/analytics.ts";
import { formatRiotId } from "#src/lib/riot-id-format.ts";
import { useConsumerPlayerParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import {
  filterKey,
  playerProfileSearch,
  type PlayerProfileFilters,
} from "#src/lib/player-profile-filters.ts";
import { usePlayerProfileUrlState } from "#src/lib/use-player-profile-url-state.ts";

const EntryStateSchema = z.object({
  entrySurface: z.enum(["search_results", "direct_link"]),
});

export const PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always",
} as const;

export function isFreshConsumerProfileAccess(
  state: "available" | "feature_disabled" | "no_shared_guild" | undefined,
  isSuccess: boolean,
  isFetching: boolean,
): boolean {
  return isSuccess && !isFetching && state === "available";
}

function playerProfileOutcome(options: {
  summarySuccess: boolean;
  summaryError: boolean;
  accessError: boolean;
  accessSuccess: boolean;
  accessState: "available" | "feature_disabled" | "no_shared_guild" | undefined;
}): "succeeded" | "failed" | null {
  if (options.summarySuccess) return "succeeded";
  if (
    options.summaryError ||
    options.accessError ||
    (options.accessSuccess && options.accessState !== "available")
  ) {
    return "failed";
  }
  return null;
}

function profileFilterInput(filters: PlayerProfileFilters) {
  return {
    games: filters.games,
    ...(filters.queues === undefined ? {} : { queues: filters.queues }),
  };
}

function shouldLoadHistory(
  accessIsFresh: boolean,
  summarySuccess: boolean,
  summaryFetching: boolean,
): boolean {
  return accessIsFresh && summarySuccess && !summaryFetching;
}

function profileUnavailable(
  accessError: boolean,
  accessState: "available" | "feature_disabled" | "no_shared_guild" | undefined,
  summaryError: boolean,
): boolean {
  return accessError || accessState !== "available" || summaryError;
}

function observedAt(value: Date | string | null): string {
  if (value === null) return "Not observed yet";
  return new Date(value).toLocaleString();
}

export function ConsumerPlayerProfile() {
  const { filters, setFilters } = usePlayerProfileUrlState();
  return (
    <ConsumerPlayerProfileContent
      key={filterKey(filters)}
      filters={filters}
      onFiltersChange={(nextFilters, kind) => {
        setFilters(nextFilters);
        track("player_profile_filter_changed", {
          kind,
          action:
            nextFilters.queues === undefined ? "all" : "explicit_selection",
        });
      }}
    />
  );
}

type HistoryCursor = {
  gameCreationMs: number;
  matchId: string;
  consumed?: number | undefined;
};

function ConsumerPlayerProfileContent(props: {
  filters: PlayerProfileFilters;
  onFiltersChange: (
    filters: PlayerProfileFilters,
    kind: "games" | "queues",
  ) => void;
}) {
  const { playerId } = useConsumerPlayerParams();
  const trpc = useTRPC();
  const location = useLocation();
  const parsedEntry = EntryStateSchema.safeParse(location.state);
  const entrySurface = parsedEntry.success
    ? parsedEntry.data.entrySurface
    : "direct_link";
  const [historyCursors, setHistoryCursors] = useState<
    (HistoryCursor | undefined)[]
  >([undefined]);
  const [historyPage, setHistoryPage] = useState(0);
  const currentHistoryCursor = historyCursors[historyPage];
  const filterInput = profileFilterInput(props.filters);
  const trackedOutcome = useRef<string | null>(null);

  const accessQuery = useQuery(
    trpc.consumerPlayer.status.queryOptions(undefined, {
      staleTime: 0,
      refetchOnMount: "always",
    }),
  );
  const accessIsFresh = isFreshConsumerProfileAccess(
    accessQuery.data?.state,
    accessQuery.isSuccess,
    accessQuery.isFetching,
  );
  const accessState = accessQuery.data?.state;
  const summaryQuery = useQuery(
    trpc.consumerPlayer.profileSummary.queryOptions(
      {
        playerId,
        ...filterInput,
      },
      {
        enabled: accessIsFresh,
        ...PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS,
      },
    ),
  );
  const historyQuery = useQuery(
    trpc.consumerPlayer.matchHistory.queryOptions(
      {
        playerId,
        limit: 20,
        ...filterInput,
        ...(currentHistoryCursor === undefined
          ? {}
          : { cursor: currentHistoryCursor }),
      },
      {
        enabled: shouldLoadHistory(
          accessIsFresh,
          summaryQuery.isSuccess,
          summaryQuery.isFetching,
        ),
        ...PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS,
      },
    ),
  );

  useEffect(() => {
    trackedOutcome.current = null;
  }, [playerId]);

  useEffect(() => {
    const outcome = playerProfileOutcome({
      summarySuccess: summaryQuery.isSuccess,
      summaryError: summaryQuery.isError,
      accessError: accessQuery.isError,
      accessSuccess: accessQuery.isSuccess,
      accessState,
    });
    if (outcome === null || trackedOutcome.current === outcome) return;
    trackedOutcome.current = outcome;
    track("player_profile_opened", {
      outcome,
      surface: entrySurface,
    });
  }, [
    accessState,
    accessQuery.isError,
    accessQuery.isSuccess,
    entrySurface,
    summaryQuery.isError,
    summaryQuery.isSuccess,
  ]);

  if (accessQuery.isPending || accessQuery.isFetching) {
    return (
      <ProfileShell>
        <p className="text-sm text-scout-subtle">Checking profile access…</p>
      </ProfileShell>
    );
  }

  if (
    profileUnavailable(accessQuery.isError, accessState, summaryQuery.isError)
  ) {
    return (
      <ProfileShell>
        <Card>
          <CardHeader>
            <CardTitle>Player profile unavailable</CardTitle>
            <CardDescription>
              Scout could not find this player inside your currently enabled
              shared servers, or could not verify membership. No other
              guild&apos;s player data was returned.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (accessState !== "available" || accessQuery.isError) {
                  void accessQuery.refetch();
                } else {
                  void summaryQuery.refetch();
                }
              }}
            >
              Retry
            </Button>
            <Button asChild variant="outline">
              <Link to="/players">Search players</Link>
            </Button>
          </CardContent>
        </Card>
      </ProfileShell>
    );
  }

  if (summaryQuery.isPending || summaryQuery.isFetching) {
    return (
      <ProfileShell>
        <p className="text-sm text-scout-subtle">Loading player profile…</p>
      </ProfileShell>
    );
  }

  const summary = summaryQuery.data;
  if (summary === undefined) {
    throw new Error("Successful player profile query returned no summary");
  }
  const entries = historyQuery.data?.entries ?? [];
  const profileSearch = playerProfileSearch(props.filters);

  return (
    <ProfileShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <ConsumerGuildAvatar name={summary.guild.name} size="large" />
          <div>
            <p className="text-sm text-scout-subtle">{summary.guild.name}</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {summary.alias}
            </h1>
            <p className="mt-1 text-sm text-scout-subtle">
              {summary.accountCount === 1
                ? "1 Riot account"
                : `${summary.accountCount.toString()} Riot accounts combined`}
              {" · "}Only games Scout recorded
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/players">Find another player</Link>
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {summary.accounts.map((account, index) => (
          <Card
            key={`${account.region}:${account.gameName ?? "pending"}:${account.tagLine ?? "pending"}:${index.toString()}`}
          >
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg">
                  {formatRiotId(account, "Riot ID pending")}
                </CardTitle>
                <Badge variant="outline">{account.region}</Badge>
              </div>
              <CardDescription>
                Last observed match: {observedAt(account.lastMatchTime)}
                <br />
                Last checked by Scout: {observedAt(account.lastCheckedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-scout-subtle">Solo / duo</p>
                <RankValue rank={account.ranks.solo} compact />
              </div>
              <div>
                <p className="text-scout-subtle">Flex</p>
                <RankValue rank={account.ranks.flex} compact />
              </div>
              <div>
                <p className="text-scout-subtle">Ranked 5s</p>
                <RankValue rank={account.ranks.ranked5s} compact />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <div>
          <h2 className="text-xl font-semibold">Combined performance</h2>
          <p className="text-sm text-scout-subtle">
            Accounts are combined only because this guild configured them as one
            Scout player.
          </p>
        </div>
      </div>

      <PlayerProfileFilterBar
        filters={props.filters}
        onChange={props.onFiltersChange}
      />

      <PlayerSummaryCards
        ranks={summary.ranks}
        recentForm={summary.recentForm}
      />

      <Section title="Champion performance">
        <ChampionPoolTable
          key={filterKey(props.filters)}
          rows={summary.championPool}
          minGamesForRate={summary.minGamesForRate}
          profileSearch={profileSearch}
        />
      </Section>

      <Section title="Recorded match history">
        <p className="mb-3 text-sm text-scout-subtle">
          This is Scout&apos;s stored coverage, not a complete Riot match
          history. Each card identifies the account Scout observed.
        </p>
        {historyQuery.isPending || historyQuery.isRefetching ? (
          <p className="text-sm text-scout-subtle">Loading games…</p>
        ) : historyQuery.isError ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-scout-danger">
              Match history didn&apos;t load.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void historyQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <MatchHistoryList
              entries={entries}
              playerId={playerId}
              profileSearch={profileSearch}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-scout-subtle">
                Page {(historyPage + 1).toString()}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={historyPage === 0 || historyQuery.isFetching}
                  onClick={() => {
                    setHistoryPage((page) => page - 1);
                  }}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    historyQuery.data.nextCursor === null ||
                    historyQuery.isFetching
                  }
                  onClick={() => {
                    const next = historyQuery.data.nextCursor;
                    if (next === null) return;
                    setHistoryCursors((cursors) => [
                      ...cursors.slice(0, historyPage + 1),
                      next,
                    ]);
                    setHistoryPage((page) => page + 1);
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </Section>
    </ProfileShell>
  );
}

function ProfileShell(props: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      {props.children}
    </div>
  );
}
