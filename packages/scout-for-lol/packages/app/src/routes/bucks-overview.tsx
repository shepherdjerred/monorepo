import { Loaded } from "@shepherdjerred/loaded";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInteger } from "@scout-for-lol/data";
import {
  ErrorState,
  LoadingState,
  StaleState,
} from "@scout-for-lol/design-system/domain/states";
import { BucksCancelDialog } from "#src/components/bucks-cancel-dialog.tsx";
import {
  BucksMarketSections,
  MarketsStatusBanner,
  type MarketErrorMap,
} from "#src/components/bucks-market-sections.tsx";
import { BucksPendingPositions } from "#src/components/bucks-pending-positions.tsx";
import { BucksWalletCard } from "#src/components/bucks-wallet-card.tsx";
import type { BucksBetSubmission } from "#src/components/bucks-bet-form.tsx";
import { useDiscordNames } from "#src/hooks/use-discord-names.ts";
import { useNow } from "#src/hooks/use-now.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { computeClockSkewMs } from "#src/lib/bucks-countdown.ts";
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

/** Everything a bet-placing hook needs to answer a mutation uniformly. */
type BetPlacementSink = {
  settleResult: (
    key: string,
    result: { kind: string } & Record<string, unknown>,
  ) => void;
  fail: (key: string, error: unknown) => void;
};

/**
 * Wallet + pending positions, gated on their own query state. A failed or
 * still-loading wallet must not be read as "not eligible" — that misleads an
 * eligible member and hides every bet form with no way to retry.
 */
export type WalletData = {
  wallet: {
    balance: number;
    totalAtRisk: number;
    pendingPositionCount: number;
    pendingPositions?: Parameters<typeof BucksPendingPositions>[0]["positions"];
  } | null;
  eligible: boolean;
};

export function WalletPanel(props: {
  /**
   * One value instead of the `isPending` / `isError` / `wallet` / `eligible` /
   * `pendingPositions` set this took before. Those five described one query
   * result, and the combination that mattered — an error arriving while a
   * wallet was already in hand — had no agreed meaning: the old order checked
   * `isError` first and replaced a usable balance with a retry card.
   */
  wallet: Loaded<WalletData>;
  onRetry: () => void;
  onCancelOutcome: (matchId: string) => void;
}) {
  return Loaded.match(props.wallet, {
    loading: () => <LoadingState label="Loading your wallet…" />,
    error: () => (
      <ErrorState
        message="Scout couldn't load your Bryan Bucks wallet."
        onRetry={props.onRetry}
      />
    ),
    available: (data, meta) => (
      <>
        <StaleState errors={meta.errors} />
        <BucksWalletCard
          wallet={data.wallet ?? null}
          eligible={data.eligible}
        />
        <BucksPendingPositions
          positions={data.wallet?.pendingPositions ?? []}
          onCancelOutcome={props.onCancelOutcome}
        />
      </>
    ),
  });
}

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

  const placeOutcomeMutation = useMutation(
    trpc.bucks.placeOutcomeBet.mutationOptions({
      meta: analyticsMeta("bucks_bet_placed"),
    }),
  );
  const cancelOutcome = useMutation(
    trpc.bucks.cancelOutcomeBet.mutationOptions({
      meta: analyticsMeta("bucks_bet_cancelled"),
    }),
  );
  const placeParlayMutation = useMutation(
    trpc.bucks.placeParlayBet.mutationOptions({
      meta: analyticsMeta("bucks_parlay_bet_placed"),
    }),
  );
  const placeWeeklyMutation = useMutation(
    trpc.bucks.placeWeeklyParlayBet.mutationOptions({
      meta: analyticsMeta("bucks_weekly_parlay_bet_placed"),
    }),
  );

  const placeOutcome = (matchId: string, submission: BucksBetSubmission) => {
    const key = `outcome:${matchId}`;
    placeOutcomeMutation.mutate(
      {
        guildId,
        matchId,
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
  const placeParlay = (matchId: string, submission: BucksBetSubmission) => {
    const key = `parlay:${matchId}`;
    placeParlayMutation.mutate(
      {
        guildId,
        matchId,
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
  };
  const placeWeekly = (marketId: number, submission: BucksBetSubmission) => {
    const key = `weekly:${marketId.toString()}`;
    placeWeeklyMutation.mutate(
      {
        guildId,
        marketId,
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
  };

  const balance = walletQuery.data?.wallet?.balance ?? null;
  // `eligible: false` means bucks.wallet answers `{ wallet: null }` forever
  // for this member — every submission would return `not_eligible`, so the
  // market cards must not offer a form for it. Default closed (no bet
  // forms) while the wallet answer is still loading or failed, since an
  // impossible mutation is worse than a brief false negative.
  const canBet = walletQuery.data?.eligible === true;
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
      <WalletPanel
        wallet={Loaded.fromQuery(walletQuery, ["bucks.wallet"])}
        onRetry={() => {
          void walletQuery.refetch();
        }}
        onCancelOutcome={requestCancel}
      />
      <MarketsStatusBanner
        status={Loaded.fromQuery(marketsQuery, ["bucks.openMarkets"])}
        onRetry={() => {
          void marketsQuery.refetch();
        }}
        isEmpty={noMarkets}
      />
      <BucksMarketSections
        markets={markets}
        nowMs={nowMs}
        skewMs={skewMs}
        balance={balance}
        canBet={canBet}
        nameOf={nameOf}
        marketErrors={marketErrors}
        placeOutcome={placeOutcome}
        placeOutcomePending={placeOutcomeMutation.isPending}
        placeParlay={placeParlay}
        placeParlayPending={placeParlayMutation.isPending}
        placeWeekly={placeWeekly}
        placeWeeklyPending={placeWeeklyMutation.isPending}
        onCancelRequest={requestCancel}
      />
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
