import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInteger } from "@scout-for-lol/data";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import { BucksCancelDialog } from "#src/components/bucks-cancel-dialog.tsx";
import { BucksMarketCard } from "#src/components/bucks-market-card.tsx";
import { BucksParlayCard } from "#src/components/bucks-parlay-card.tsx";
import { BucksPendingPositions } from "#src/components/bucks-pending-positions.tsx";
import { BucksWalletCard } from "#src/components/bucks-wallet-card.tsx";
import type { BucksBetSubmission } from "#src/components/bucks-bet-form.tsx";
import { useDiscordNames } from "#src/hooks/use-discord-names.ts";
import { useNow } from "#src/hooks/use-now.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { computeClockSkewMs, remainingMs } from "#src/lib/bucks-countdown.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { useBucksGuild } from "#src/routes/bucks-workspace.tsx";

const LIVE_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always",
} as const;

/**
 * User-facing copy for a domain refusal. The result unions treat these as
 * ordinary answers, so they surface as inline form errors — numbers only,
 * never restated rules.
 */
function refusalCopy(
  result: { kind: string } & Record<string, unknown>,
): string {
  switch (result.kind) {
    case "window_closed":
      return "Betting has closed for this market.";
    case "no_pool":
    case "no_market":
      return "This market is no longer open.";
    case "feature_disabled":
      return "Betting is currently disabled.";
    case "not_eligible":
      return "Only tracked players in this server can bet.";
    case "invalid_stake":
      return "That stake isn't valid.";
    case "storage_limit":
      return "That stake is beyond what Bryan Bucks can store.";
    case "insufficient": {
      const balance =
        typeof result["balance"] === "number"
          ? formatInteger(result["balance"])
          : "your";
      return `Not enough BB — your balance is ${balance} BB.`;
    }
    case "house_insufficient":
    case "wallet_house_insufficient":
      return "The house can't cover that bet right now.";
    case "side_conflict":
      return "You already hold the other side of this market.";
    default:
      return "Scout couldn't place that bet.";
  }
}

function refusalCancelCopy(kind: string): string {
  switch (kind) {
    case "no_pool":
    case "no_bet":
      return "There's no open bet to cancel.";
    case "window_closed":
      return "The window closed — your bet is locked in.";
    case "already_resolved":
      return "This market already resolved.";
    default:
      return "Scout couldn't cancel that bet.";
  }
}

type MarketErrorMap = Record<string, string>;

/** Everything a bet-placing hook needs to answer a mutation uniformly. */
type BetPlacementSink = {
  settleResult: (
    key: string,
    result: { kind: string } & Record<string, unknown>,
  ) => void;
  fail: (key: string, error: unknown) => void;
};

function usePositionNames(
  markets:
    | {
        outcome: { sides: { positions: { discordId: string }[] }[] }[];
        parlays: { positions: { discordId: string }[] }[];
      }
    | undefined,
): (discordId: string) => string {
  const names = useDiscordNames([
    ...(markets?.outcome.flatMap((market) =>
      market.sides.flatMap((side) =>
        side.positions.map((position) => position.discordId),
      ),
    ) ?? []),
    ...(markets?.parlays.flatMap((market) =>
      market.positions.map((position) => position.discordId),
    ) ?? []),
  ]);
  return (discordId) => names.resolve(discordId)?.displayName ?? discordId;
}

export function BucksOverview() {
  const { guildId } = useBucksGuild();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const nowMs = useNow();
  const [marketErrors, setMarketErrors] = useState<MarketErrorMap>({});
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const walletQuery = useQuery(
    trpc.bucks.wallet.queryOptions({ guildId }, LIVE_QUERY_OPTIONS),
  );
  const marketsQuery = useQuery(
    trpc.bucks.openMarkets.queryOptions(
      { guildId },
      { ...LIVE_QUERY_OPTIONS, refetchInterval: 60_000 },
    ),
  );
  const markets = marketsQuery.data;
  const skewMs =
    markets === undefined
      ? 0
      : computeClockSkewMs(markets.serverNow, marketsQuery.dataUpdatedAt);
  const nameOf = usePositionNames(markets);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.bucks.wallet.queryKey({ guildId }),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.bucks.openMarkets.queryKey({ guildId }),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.bucks.ledger.pathKey(),
    });
  };
  const sink: BetPlacementSink = {
    settleResult: (key, result) => {
      setMarketErrors((current) => {
        if (result.kind === "placed") {
          const { [key]: _cleared, ...rest } = current;
          return rest;
        }
        return { ...current, [key]: refusalCopy(result) };
      });
      invalidate();
    },
    fail: (key, error) => {
      setMarketErrors((current) => ({
        ...current,
        [key]:
          error instanceof Error
            ? error.message
            : "Scout couldn't reach Bryan Bucks.",
      }));
    },
  };

  const placeOutcome = useMutation(
    trpc.bucks.placeOutcomeBet.mutationOptions({
      meta: analyticsMeta("bucks_bet_placed"),
    }),
  );
  const cancelOutcome = useMutation(
    trpc.bucks.cancelOutcomeBet.mutationOptions({
      meta: analyticsMeta("bucks_bet_cancelled"),
    }),
  );
  const placeParlay = useMutation(
    trpc.bucks.placeParlayBet.mutationOptions({
      meta: analyticsMeta("bucks_parlay_bet_placed"),
    }),
  );
  const placeWeekly = useMutation(
    trpc.bucks.placeWeeklyParlayBet.mutationOptions({
      meta: analyticsMeta("bucks_weekly_parlay_bet_placed"),
    }),
  );

  const balance = walletQuery.data?.wallet?.balance ?? null;
  const requestCancel = (matchId: string) => {
    setCancelError(null);
    setCancelTarget(matchId);
  };
  const cancelPosition =
    markets?.outcome.find((market) => market.matchId === cancelTarget)
      ?.yourPosition ?? null;
  const noMarkets =
    markets?.outcome.length === 0 &&
    markets.parlays.length === 0 &&
    markets.weeklyParlays.length === 0;

  return (
    <div className="space-y-4">
      <BucksWalletCard wallet={walletQuery.data?.wallet ?? null} />
      <BucksPendingPositions
        positions={walletQuery.data?.wallet?.pendingPositions ?? []}
        onCancelOutcome={requestCancel}
      />
      {noMarkets ? (
        <EmptyState>
          <p>
            No open markets right now. Markets open when an eligible game
            starts.
          </p>
        </EmptyState>
      ) : null}
      {markets?.outcome.map((market) => {
        const key = `outcome:${market.matchId}`;
        const place = (submission: BucksBetSubmission) => {
          placeOutcome.mutate(
            {
              guildId,
              matchId: market.matchId,
              teamId: Number(submission.side) === 200 ? 200 : 100,
              stake: submission.stake,
            },
            {
              onSuccess: (result) => {
                sink.settleResult(key, result);
              },
              onError: (error) => {
                sink.fail(key, error);
              },
            },
          );
        };
        return (
          <BucksMarketCard
            key={key}
            market={market}
            remainingMs={remainingMs(market.closesAt, nowMs, skewMs)}
            balance={balance}
            nameOf={nameOf}
            pending={placeOutcome.isPending}
            serverError={marketErrors[key] ?? null}
            onPlace={place}
            onCancelRequest={() => {
              requestCancel(market.matchId);
            }}
          />
        );
      })}
      {markets?.parlays.map((market) => {
        const key = `parlay:${market.matchId}`;
        return (
          <BucksParlayCard
            key={key}
            idPrefix={key}
            market={{
              title: "Match parlay",
              subtitle: `${market.subjects.join(", ")} · ${market.matchId}`,
              legs: market.legs,
              yesOdds: market.yesOdds,
              noOdds: market.noOdds,
              yourPosition: market.yourPosition,
              positions: market.positions,
            }}
            remainingMs={remainingMs(market.closesAt, nowMs, skewMs)}
            balance={balance}
            nameOf={nameOf}
            pending={placeParlay.isPending}
            serverError={marketErrors[key] ?? null}
            onPlace={(submission) => {
              placeParlay.mutate(
                {
                  guildId,
                  matchId: market.matchId,
                  side: submission.side === "NO" ? "NO" : "YES",
                  stake: submission.stake,
                },
                {
                  onSuccess: (result) => {
                    sink.settleResult(key, result);
                  },
                  onError: (error) => {
                    sink.fail(key, error);
                  },
                },
              );
            }}
          />
        );
      })}
      {markets?.weeklyParlays.map((market) => {
        const key = `weekly:${market.marketId.toString()}`;
        return (
          <BucksParlayCard
            key={key}
            idPrefix={key}
            market={{
              title: "Weekly parlay",
              subtitle: `${market.subjects.join(", ")} · week of ${market.periodKey}`,
              legs: market.legs,
              qualification: market.qualification,
              yesOdds: market.yesOdds,
              noOdds: market.noOdds,
              yourPosition: market.yourPosition,
              aggregate: {
                bettorCount: market.bettorCount,
                totalStaked: market.totalStaked,
              },
            }}
            remainingMs={remainingMs(market.bettingClosesAt, nowMs, skewMs)}
            balance={balance}
            nameOf={nameOf}
            pending={placeWeekly.isPending}
            serverError={marketErrors[key] ?? null}
            onPlace={(submission) => {
              placeWeekly.mutate(
                {
                  guildId,
                  marketId: market.marketId,
                  side: submission.side === "NO" ? "NO" : "YES",
                  stake: submission.stake,
                },
                {
                  onSuccess: (result) => {
                    sink.settleResult(key, result);
                  },
                  onError: (error) => {
                    sink.fail(key, error);
                  },
                },
              );
            }}
          />
        );
      })}
      <BucksCancelDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
            setCancelError(null);
          }
        }}
        position={cancelPosition}
        pending={cancelOutcome.isPending}
        error={cancelError}
        onConfirm={() => {
          if (cancelTarget === null) return;
          cancelOutcome.mutate(
            { guildId, matchId: cancelTarget },
            {
              onSuccess: (result) => {
                invalidate();
                if (result.kind === "cancelled") {
                  setCancelTarget(null);
                  setCancelError(null);
                } else {
                  setCancelError(refusalCancelCopy(result.kind));
                }
              },
              onError: (error) => {
                setCancelError(
                  error instanceof Error
                    ? error.message
                    : "Scout couldn't cancel that bet.",
                );
              },
            },
          );
        }}
      />
    </div>
  );
}
