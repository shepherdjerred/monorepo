import { Loaded } from "@shepherdjerred/loaded";
import { useEffect, useRef } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@scout-for-lol/design-system/components/tabs";
import { ChampionPoolTable } from "#src/components/player/champion-pool-table.tsx";
import { usePlayerHistoryState } from "#src/lib/player/use-player-history-state.ts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { ConsumerPlayerChallengeRuns } from "#src/components/challenge/player-challenge-runs.tsx";
import { CombinedPerformance } from "#src/components/player/player-combined-performance.tsx";
import { PlayerRankHistoryPanel } from "#src/components/player/player-rank-history.tsx";
import { PlayerBehavior } from "#src/components/player/player-behavior.tsx";
import { ConsumerPlayerCommunity } from "#src/components/player/consumer-player-community.tsx";
import { RankValue } from "#src/components/player/player-profile-sections.tsx";
import { track } from "#src/lib/analytics.ts";
import { formatRiotId } from "#src/lib/format/riot-id-format.ts";
import { regionName } from "#src/lib/regions.ts";
import { useConsumerPlayerParams } from "#src/lib/routes/route-params.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { type PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";
import { usePlayerProfileUrlState } from "#src/lib/player/use-player-profile-url-state.ts";

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
  const failed =
    options.summaryError ||
    options.accessError ||
    (options.accessSuccess && options.accessState !== "available");
  return options.summarySuccess ? "succeeded" : failed ? "failed" : null;
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
  return value === null ? "Not observed yet" : new Date(value).toLocaleString();
}

function masteryPoints(points: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(points);
}

export function ConsumerPlayerProfile() {
  const { playerId } = useConsumerPlayerParams();
  const { filters, setFilters } = usePlayerProfileUrlState();
  return (
    <ConsumerPlayerProfileContent
      key={playerId}
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

const EMPTY_HISTORY: { entries: never[]; nextCursor: null } = {
  entries: [],
  nextCursor: null,
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
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") ?? "overview";
  const tab = [
    "overview",
    "champions",
    "progress",
    "community",
    "accounts",
  ].includes(requestedTab)
    ? requestedTab
    : "overview";
  const historyState = usePlayerHistoryState();
  const parsedEntry = EntryStateSchema.safeParse(location.state);
  const entrySurface = parsedEntry.success
    ? parsedEntry.data.entrySurface
    : "direct_link";
  const historyPage = historyState.page;
  const championSearch = historyState.championSearch;
  const currentHistoryCursor = historyState.cursor;
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
        placeholderData: keepPreviousData,
      },
    ),
  );
  // Deliberately NOT migrated: `accessQuery` and the summary gate above.
  // They block on `isFetching` as well as `isPending` because the access
  // decision must be freshly fetched (`staleTime: 0`,
  // `refetchOnMount: "always"`), and `Loaded`'s `degraded` says the exact
  // opposite — keep rendering the last known answer when the refresh fails.
  // That is right for a match list and wrong for an authorization check.
  const rankHistoryQuery = useQuery(
    trpc.consumerPlayer.rankHistory.queryOptions(
      { playerId },
      { enabled: accessIsFresh },
    ),
  );
  const historyQuery = useQuery(
    trpc.consumerPlayer.matchHistory.queryOptions(
      {
        playerId,
        limit: 20,
        ...filterInput,
        championSearch,
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
              This player is unavailable. Check that you still share a server
              with them, then try again.
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

  if (
    summaryQuery.isPending ||
    (summaryQuery.isFetching && !summaryQuery.isPlaceholderData)
  ) {
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
  // Consumer-scoped, so `strict`. Its PROTECTED options set `gcTime: 0`, which
  // means there is no cache to go stale today — this states the requirement
  // rather than depending on that option staying put.
  const history = Loaded.strict(
    Loaded.fromQuery(historyQuery, ["matchHistory"]),
  );
  // One fallback instead of two optional chains and two `??`s: the component
  // was already at the cyclomatic limit, and "absent history" has one shape.
  const { entries, nextCursor } = Loaded.getOrElse(history, EMPTY_HISTORY);
  const profileSearch = `?${params.toString()}`;

  return (
    <ProfileShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <ConsumerGuildAvatar
            guildId={summary.guild.id}
            icon={summary.guild.icon}
            name={summary.guild.name}
            size="large"
          />
          <div>
            <p className="text-sm text-scout-subtle">{summary.guild.name}</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {summary.alias}
            </h1>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/players">Find another player</Link>
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("tab", value);
          setParams(next, { replace: true });
        }}
      >
        <TabsList
          aria-label="Player profile"
          className="flex h-auto flex-wrap justify-start"
        >
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="champions">Champions</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
          <TabsTrigger value="community">Community</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="champions" className="space-y-6">
          <h2 className="text-xl font-semibold">Champion performance</h2>
          <ChampionPoolTable
            rows={summary.championPool}
            minGamesForRate={summary.minGamesForRate}
            profileSearch={profileSearch}
          />
          <h2 className="text-xl font-semibold">Champion mastery</h2>
          {summary.accounts.map((account, index) =>
            account.mastery === null ? null : (
              <section key={index} className="space-y-2">
                <h3 className="font-medium">
                  {formatRiotId(account, "Riot ID pending")}
                </h3>
                <p className="text-xs text-scout-subtle">
                  {account.mastery.freshness === "stale"
                    ? "Last known · "
                    : "Updated · "}
                  {observedAt(account.mastery.fetchedAt)}
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {account.mastery.champions.map((champion) => (
                    <li
                      key={champion.championId}
                      className="flex justify-between border-b py-2"
                    >
                      <span>{champion.championName}</span>
                      <span className="text-scout-subtle">
                        M{champion.level} · {masteryPoints(champion.points)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </TabsContent>
        <TabsContent value="accounts" className="grid gap-3 lg:grid-cols-2">
          {summary.accounts.map((account, index) => (
            <Card
              key={`${account.region}:${account.gameName ?? "pending"}:${account.tagLine ?? "pending"}:${index.toString()}`}
            >
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-lg">
                    {formatRiotId(account, "Riot ID pending")}
                  </CardTitle>
                  <Badge variant="outline">{regionName(account.region)}</Badge>
                </div>
                <CardDescription className="text-xs">
                  Last match: {observedAt(account.lastMatchTime)}
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
        </TabsContent>

        <TabsContent value="progress" className="space-y-6">
          <ConsumerPlayerChallengeRuns playerId={playerId} />

          <PlayerRankHistoryPanel
            status={
              rankHistoryQuery.isPending
                ? "loading"
                : rankHistoryQuery.isError
                  ? "error"
                  : "ready"
            }
            history={rankHistoryQuery.data}
            onRetry={() => {
              void rankHistoryQuery.refetch();
            }}
          />
          <PlayerBehavior behavior={summary.behavior} />
        </TabsContent>
        <TabsContent value="community">
          <ConsumerPlayerCommunity
            guildId={summary.guild.id}
            playerId={playerId}
          />
        </TabsContent>
        <TabsContent value="overview" className="space-y-6">
          <CombinedPerformance
            onClearFilters={() => {
              setParams({ queue: "all", tab: "overview" }, { replace: true });
            }}
            filters={props.filters}
            onFiltersChange={props.onFiltersChange}
            championPool={summary.championPool}
            minGamesForRate={summary.minGamesForRate}
            ranks={summary.ranks}
            recentForm={summary.recentForm}
            history={history}
            historyFetching={historyQuery.isFetching}
            historyRefetching={historyQuery.isRefetching}
            entries={entries}
            nextCursor={nextCursor}
            historyPage={historyPage}
            championSearch={championSearch}
            onChampionSearchChange={historyState.setChampionSearch}
            playerId={playerId}
            profileSearch={profileSearch}
            onRetryHistory={() => {
              void historyQuery.refetch();
            }}
            onPreviousHistory={historyState.previous}
            onNextHistory={historyState.next}
          />
        </TabsContent>
      </Tabs>
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
