import { Loaded } from "@shepherdjerred/loaded";
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
import { ConsumerPlayerChallengeRuns } from "#src/components/challenge/player-challenge-runs.tsx";
import { CombinedPerformance } from "#src/components/player/player-combined-performance.tsx";
import { RankValue } from "#src/components/player/player-profile-sections.tsx";
import type { HistoryCursor } from "#src/components/player/recorded-match-history.tsx";
import { track } from "#src/lib/analytics.ts";
import { formatRiotId } from "#src/lib/riot-id-format.ts";
import { useConsumerPlayerParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";
import {
  filterKey,
  playerProfileSearch,
  type PlayerProfileFilters,
} from "#src/lib/player/player-profile-filters.ts";
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
  // Deliberately NOT migrated: `accessQuery` and the summary gate above.
  // They block on `isFetching` as well as `isPending` because the access
  // decision must be freshly fetched (`staleTime: 0`,
  // `refetchOnMount: "always"`), and `Loaded`'s `degraded` says the exact
  // opposite — keep rendering the last known answer when the refresh fails.
  // That is right for a match list and wrong for an authorization check.
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
  // Consumer-scoped, so `strict`. Its PROTECTED options set `gcTime: 0`, which
  // means there is no cache to go stale today — this states the requirement
  // rather than depending on that option staying put.
  const history = Loaded.strict(
    Loaded.fromQuery(historyQuery, ["matchHistory"]),
  );
  // One fallback instead of two optional chains and two `??`s: the component
  // was already at the cyclomatic limit, and "absent history" has one shape.
  const { entries, nextCursor } = Loaded.getOrElse(history, EMPTY_HISTORY);
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

      <ConsumerPlayerChallengeRuns playerId={playerId} />

      <CombinedPerformance
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
        playerId={playerId}
        profileSearch={profileSearch}
        onRetryHistory={() => {
          void historyQuery.refetch();
        }}
        onPreviousHistory={() => {
          setHistoryPage((page) => page - 1);
        }}
        onNextHistory={(cursor) => {
          setHistoryCursors((cursors) => [
            ...cursors.slice(0, historyPage + 1),
            cursor,
          ]);
          setHistoryPage((page) => page + 1);
        }}
      />
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
