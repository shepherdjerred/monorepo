import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import {
  BucksMarketCard,
  type OutcomeMarketView,
} from "#src/components/bucks/bucks-market-card.tsx";
import { BucksParlayCard } from "#src/components/bucks/bucks-parlay-card.tsx";
import type { BucksBetSubmission } from "#src/components/bucks/bucks-bet-form.tsx";
import { remainingMs } from "#src/lib/bucks/bucks-countdown.ts";

export type BucksMatchParlayRow = {
  matchId: string;
  closesAt: string;
  subjects: string[];
  legs: string[];
  yesOdds: string;
  noOdds: string;
  yourPosition: { side: "YES" | "NO"; stake: number } | null;
  positions: { discordId: string; side: "YES" | "NO"; stake: number }[];
};

export type BucksWeeklyParlayRow = {
  marketId: number;
  periodKey: string;
  bettingClosesAt: string;
  legs: string[];
  qualification?: string | undefined;
  yesOdds: string;
  noOdds: string;
  yourPosition: { side: "YES" | "NO"; stake: number } | null;
  bettorCount: number;
  totalStaked: number;
  subjects: string[];
};

/** The `bucks.openMarkets` payload, structurally — the minimal shape this route consumes. */
export type BucksOpenMarkets = {
  serverNow: string;
  outcome: (OutcomeMarketView & { closesAt: string })[];
  parlays: BucksMatchParlayRow[];
  weeklyParlays: BucksWeeklyParlayRow[];
};

export type MarketErrorMap = Record<string, string>;

/** Loading / error / empty banner above the market list; renders nothing once markets are showing. */
export function MarketsStatusBanner(props: {
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  isEmpty: boolean;
}) {
  if (props.isPending) {
    return <LoadingState label="Loading open markets…" />;
  }
  if (props.isError) {
    return (
      <ErrorState
        message="Scout couldn't load open Bryan Bucks markets."
        onRetry={props.onRetry}
      />
    );
  }
  if (props.isEmpty) {
    return (
      <EmptyState>
        <p>
          No open markets right now. Markets open when an eligible game starts.
        </p>
      </EmptyState>
    );
  }
  return null;
}

/**
 * The three market-list sections. Pulled out of `BucksOverview` so that
 * component owns exactly one guard for "markets not loaded yet" instead of
 * scattering it as optional chaining across three independent lists.
 */
export function BucksMarketSections(props: {
  markets: BucksOpenMarkets | undefined;
  nowMs: number;
  skewMs: number;
  balance: number | null;
  canBet: boolean;
  nameOf: (discordId: string) => string;
  marketErrors: MarketErrorMap;
  placeOutcome: (matchId: string, submission: BucksBetSubmission) => void;
  placeOutcomePending: boolean;
  placeParlay: (matchId: string, submission: BucksBetSubmission) => void;
  placeParlayPending: boolean;
  placeWeekly: (marketId: number, submission: BucksBetSubmission) => void;
  placeWeeklyPending: boolean;
  onCancelRequest: (matchId: string) => void;
}) {
  const { markets } = props;
  if (markets === undefined) {
    return null;
  }
  return (
    <>
      {markets.outcome.map((market) => {
        const key = `outcome:${market.matchId}`;
        return (
          <BucksMarketCard
            key={key}
            market={market}
            remainingMs={remainingMs(
              market.closesAt,
              props.nowMs,
              props.skewMs,
            )}
            balance={props.balance}
            canBet={props.canBet}
            nameOf={props.nameOf}
            pending={props.placeOutcomePending}
            serverError={props.marketErrors[key] ?? null}
            onPlace={(submission) => {
              props.placeOutcome(market.matchId, submission);
            }}
            onCancelRequest={() => {
              props.onCancelRequest(market.matchId);
            }}
          />
        );
      })}
      {markets.parlays.map((market) => {
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
            remainingMs={remainingMs(
              market.closesAt,
              props.nowMs,
              props.skewMs,
            )}
            balance={props.balance}
            canBet={props.canBet}
            nameOf={props.nameOf}
            pending={props.placeParlayPending}
            serverError={props.marketErrors[key] ?? null}
            onPlace={(submission) => {
              props.placeParlay(market.matchId, submission);
            }}
          />
        );
      })}
      {markets.weeklyParlays.map((market) => {
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
            remainingMs={remainingMs(
              market.bettingClosesAt,
              props.nowMs,
              props.skewMs,
            )}
            balance={props.balance}
            canBet={props.canBet}
            nameOf={props.nameOf}
            pending={props.placeWeeklyPending}
            serverError={props.marketErrors[key] ?? null}
            onPlace={(submission) => {
              props.placeWeekly(market.marketId, submission);
            }}
          />
        );
      })}
    </>
  );
}
