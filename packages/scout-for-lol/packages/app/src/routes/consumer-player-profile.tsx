import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { rankToString, type Rank } from "@scout-for-lol/data";
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
} from "#src/components/player-profile-sections.tsx";
import { LoadMore } from "#src/components/load-more.tsx";
import { track } from "#src/lib/analytics.ts";
import { formatRiotId } from "#src/lib/riot-id-format.ts";
import { useConsumerPlayerParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

const EntryStateSchema = z.object({
  entrySurface: z.enum(["search_results", "direct_link"]),
});

type QueueFilter = "all" | "solo" | "flex";

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

export function queueValue(queue: QueueFilter): string | undefined {
  if (queue === "solo") return "solo";
  if (queue === "flex") return "flex";
  return undefined;
}

function queueLabel(queue: QueueFilter): string {
  if (queue === "solo") return "Solo / duo";
  if (queue === "flex") return "Flex";
  return "All queues";
}

function observedAt(value: Date | string | null): string {
  if (value === null) return "Not observed yet";
  return new Date(value).toLocaleString();
}

function rankLabel(rank: Rank | undefined): string {
  return rank === undefined ? "Unranked" : rankToString(rank);
}

export function ConsumerPlayerProfile() {
  const { playerId } = useConsumerPlayerParams();
  const trpc = useTRPC();
  const location = useLocation();
  const parsedEntry = EntryStateSchema.safeParse(location.state);
  const entrySurface = parsedEntry.success
    ? parsedEntry.data.entrySurface
    : "direct_link";
  const [queue, setQueue] = useState<QueueFilter>("all");
  const selectedQueue = queueValue(queue);
  const queueInput =
    selectedQueue === undefined ? {} : { queue: selectedQueue };
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
  const summaryQuery = useQuery(
    trpc.consumerPlayer.profileSummary.queryOptions(
      {
        playerId,
        ...queueInput,
      },
      {
        enabled: accessIsFresh,
        ...PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS,
      },
    ),
  );
  const historyQuery = useInfiniteQuery(
    trpc.consumerPlayer.matchHistory.infiniteQueryOptions(
      { playerId, limit: 20, ...queueInput },
      {
        enabled:
          accessIsFresh && summaryQuery.isSuccess && !summaryQuery.isFetching,
        ...PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  useEffect(() => {
    trackedOutcome.current = null;
  }, [playerId]);

  useEffect(() => {
    const outcome = summaryQuery.isSuccess
      ? "succeeded"
      : summaryQuery.isError ||
          accessQuery.isError ||
          (accessQuery.isSuccess && accessQuery.data.state !== "available")
        ? "failed"
        : null;
    if (outcome === null || trackedOutcome.current === outcome) return;
    trackedOutcome.current = outcome;
    track("player_profile_opened", {
      outcome,
      surface: entrySurface,
    });
  }, [
    accessQuery.data,
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
    accessQuery.isError ||
    accessQuery.data.state !== "available" ||
    summaryQuery.isError
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
                if (
                  accessQuery.isError ||
                  accessQuery.data.state !== "available"
                ) {
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
  const entries =
    historyQuery.data?.pages.flatMap((page) => page.entries) ?? [];

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
        {summary.accounts.map((account) => (
          <Card key={`${account.region}:${account.gameName ?? "pending"}`}>
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
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-scout-subtle">Solo / duo</p>
                <p className="font-medium">{rankLabel(account.ranks.solo)}</p>
              </div>
              <div>
                <p className="text-scout-subtle">Flex</p>
                <p className="font-medium">{rankLabel(account.ranks.flex)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Combined performance</h2>
          <p className="text-sm text-scout-subtle">
            Accounts are combined only because this guild configured them as one
            Scout player.
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Queue filter">
          {(["all", "solo", "flex"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={queue === value ? "default" : "outline"}
              onClick={() => {
                setQueue(value);
              }}
            >
              {queueLabel(value)}
            </Button>
          ))}
        </div>
      </div>

      <PlayerSummaryCards
        ranks={summary.ranks}
        recentForm={summary.recentForm}
      />

      <Section title="Champion performance">
        <ChampionPoolTable
          rows={summary.championPool}
          minGamesForRate={summary.minGamesForRate}
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
            <MatchHistoryList entries={entries} />
            <LoadMore
              hasNextPage={historyQuery.hasNextPage}
              isFetchingNextPage={historyQuery.isFetchingNextPage}
              onLoadMore={() => {
                void historyQuery.fetchNextPage();
              }}
            />
          </div>
        )}
      </Section>
    </ProfileShell>
  );
}

function ProfileShell(props: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
      {props.children}
    </div>
  );
}
