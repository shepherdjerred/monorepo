import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Loaded } from "@shepherdjerred/loaded";
import { BucksCountdown } from "./bucks-countdown.tsx";
import { BucksLedgerList } from "./bucks-ledger-list.tsx";
import {
  BucksMarketCard,
  type OutcomeMarketView,
} from "./bucks-market-card.tsx";
import {
  BucksMarketSections,
  MarketsStatusBanner,
  type BucksOpenMarkets,
} from "./bucks-market-sections.tsx";
import { BucksParlayCard } from "./bucks-parlay-card.tsx";
import { BucksPendingPositions } from "./bucks-pending-positions.tsx";
import { BucksWalletCard } from "./bucks-wallet-card.tsx";

/** Stories never submit; the server is the authority for every Bucks write. */
const noop = () => {
  // Intentionally inert.
};

const DISCORD_NAMES: Record<string, string> = {
  "111": "jerred",
  "222": "bryan",
  "333": "hunter",
};

function nameOf(discordId: string): string {
  return DISCORD_NAMES[discordId] ?? discordId;
}

const OUTCOME_MARKET: OutcomeMarketView = {
  matchId: "NA1_5021846713",
  sides: [
    {
      teamId: 100,
      label: "Blue side (jerred on Ahri)",
      trackedPlayers: ["jerred"],
      totalStake: 1200,
      betCount: 2,
      positions: [
        { discordId: "111", stake: 1000 },
        { discordId: "222", stake: 200 },
      ],
    },
    {
      teamId: 200,
      label: "Red side",
      trackedPlayers: [],
      totalStake: 350,
      betCount: 1,
      positions: [{ discordId: "333", stake: 350 }],
    },
  ],
  yourPosition: null,
};

const SERVER_NOW = "2026-09-13T18:00:00.000Z";
const NOW_MS = Date.parse(SERVER_NOW);

const OPEN_MARKETS: BucksOpenMarkets = {
  serverNow: SERVER_NOW,
  outcome: [{ ...OUTCOME_MARKET, closesAt: "2026-09-13T18:02:30.000Z" }],
  parlays: [
    {
      matchId: "NA1_5021846713",
      closesAt: "2026-09-13T18:02:30.000Z",
      subjects: ["jerred"],
      legs: [
        "jerred finishes with at least 7 kills",
        "jerred's team takes the first tower",
      ],
      yesOdds: "2.50",
      noOdds: "1.67",
      yourPosition: null,
      positions: [{ discordId: "222", side: "YES", stake: 120 }],
    },
  ],
  weeklyParlays: [
    {
      marketId: 42,
      periodKey: "2026-W37",
      bettingClosesAt: "2026-09-13T18:05:00.000Z",
      legs: [
        "bryan plays at least 10 Ranked Solo/Duo games",
        "bryan finishes the week above 55% win rate",
      ],
      qualification: "Only Ranked Solo/Duo games on the NA1 ladder count.",
      yesOdds: "3.20",
      noOdds: "1.35",
      yourPosition: null,
      bettorCount: 6,
      totalStaked: 2400,
      subjects: ["bryan"],
    },
  ],
};

const BASE_ARGS = {
  market: OUTCOME_MARKET,
  remainingMs: 150_000,
  balance: 3000,
  canBet: true,
  nameOf,
  pending: false,
  serverError: null,
  onPlace: noop,
  onCancelRequest: noop,
} satisfies ComponentProps<typeof BucksMarketCard>;

const meta = {
  title: "Bucks/Cards",
  component: BucksMarketCard,
  tags: ["autodocs"],
} satisfies Meta<typeof BucksMarketCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OutcomeMarketOpen: Story = { args: BASE_ARGS };

export const OutcomeMarketWithYourBet: Story = {
  args: {
    market: {
      ...OUTCOME_MARKET,
      yourPosition: { teamId: 100, offeredStake: 1000, cancellationFee: 50 },
    },
    remainingMs: 45_000,
    balance: 2000,
    canBet: true,
    nameOf,
    pending: false,
    serverError: "Not enough Bryan Bucks for that stake.",
    onPlace: noop,
    onCancelRequest: noop,
  },
};

export const OutcomeMarketClosed: Story = {
  args: {
    market: OUTCOME_MARKET,
    remainingMs: 0,
    balance: 3000,
    canBet: false,
    nameOf,
    pending: false,
    serverError: null,
    onPlace: noop,
    onCancelRequest: noop,
  },
};

export const WeeklyParlay: Story = {
  args: BASE_ARGS,
  render: () => (
    <BucksParlayCard
      idPrefix="weekly-42"
      market={{
        title: "Weekly parlay",
        subtitle: "bryan · week of 2026-W37",
        legs: [
          "bryan plays at least 10 Ranked Solo/Duo games",
          "bryan finishes the week above 55% win rate",
        ],
        qualification: "Only Ranked Solo/Duo games on the NA1 ladder count.",
        yesOdds: "3.20",
        noOdds: "1.35",
        yourPosition: null,
        aggregate: { bettorCount: 6, totalStaked: 2400 },
      }}
      remainingMs={300_000}
      balance={3000}
      canBet={true}
      nameOf={nameOf}
      pending={false}
      serverError={null}
      onPlace={noop}
    />
  ),
};

export const Wallet: Story = {
  args: BASE_ARGS,
  render: () => (
    <div className="space-y-4">
      <BucksWalletCard
        wallet={{ balance: 3000, totalAtRisk: 1250, pendingPositionCount: 3 }}
        eligible={true}
      />
      <BucksWalletCard wallet={null} eligible={true} />
      <BucksWalletCard wallet={null} eligible={false} />
    </div>
  ),
};

export const PendingPositions: Story = {
  args: BASE_ARGS,
  render: () => (
    <BucksPendingPositions
      positions={[
        {
          marketType: "outcome",
          matchId: "NA1_5021846713",
          gameAlias: "jerred",
          sideLabel: "Blue side",
          offeredStake: 1000,
          matchedStake: null,
          poolState: "open",
          cancellationFee: 50,
        },
        {
          marketType: "outcome",
          matchId: "NA1_5021840022",
          gameAlias: "bryan",
          sideLabel: "Red side",
          offeredStake: 250,
          matchedStake: 250,
          poolState: "closed",
          cancellationFee: null,
        },
        {
          marketType: "parlay",
          matchId: "NA1_5021839114",
          subjectAlias: "hunter",
          side: "YES",
          stake: 120,
          poolState: "open",
        },
      ]}
      onCancelOutcome={noop}
    />
  ),
};

export const Ledger: Story = {
  args: BASE_ARGS,
  render: () => (
    <BucksLedgerList
      entries={[
        {
          id: 3,
          delta: 1500,
          balanceAfter: 3000,
          label: "Bet settled",
          matchId: "NA1_5021840022",
          createdAt: "2026-09-12T22:14:00.000Z",
        },
        {
          id: 2,
          delta: -250,
          balanceAfter: 1500,
          label: "Bet placed",
          matchId: "NA1_5021840022",
          createdAt: "2026-09-12T21:02:00.000Z",
        },
        {
          id: 1,
          delta: 1750,
          balanceAfter: 1750,
          label: "Starting balance",
          matchId: null,
          createdAt: "2026-09-10T17:45:00.000Z",
        },
      ]}
      page={0}
      totalPages={2}
      onPreviousPage={noop}
      onNextPage={noop}
      onRefresh={noop}
    />
  ),
};

export const Countdown: Story = {
  args: BASE_ARGS,
  render: () => (
    <div className="flex items-center gap-6">
      <BucksCountdown remainingMs={150_000} />
      <BucksCountdown remainingMs={1000} />
      <BucksCountdown remainingMs={0} />
    </div>
  ),
};

export const MarketSections: Story = {
  args: BASE_ARGS,
  render: () => (
    <div className="space-y-4">
      <MarketsStatusBanner
        status={Loaded.done(OPEN_MARKETS)}
        onRetry={noop}
        isEmpty={false}
      />
      <BucksMarketSections
        markets={OPEN_MARKETS}
        nowMs={NOW_MS}
        skewMs={0}
        balance={3000}
        canBet={true}
        nameOf={nameOf}
        marketErrors={{}}
        placeOutcome={noop}
        placeOutcomePending={false}
        placeParlay={noop}
        placeParlayPending={false}
        placeWeekly={noop}
        placeWeeklyPending={false}
        onCancelRequest={noop}
      />
    </div>
  ),
};

export const MarketsEmpty: Story = {
  args: BASE_ARGS,
  render: () => (
    <MarketsStatusBanner
      status={Loaded.done(undefined)}
      onRetry={noop}
      isEmpty={true}
    />
  ),
};
