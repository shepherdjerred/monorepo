import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BucksCountdown } from "#src/components/bucks-countdown.tsx";
import { BucksLedgerList } from "#src/components/bucks-ledger-list.tsx";
import { BucksMarketCard } from "#src/components/bucks-market-card.tsx";
import { BucksParlayCard } from "#src/components/bucks-parlay-card.tsx";
import { BucksPendingPositions } from "#src/components/bucks-pending-positions.tsx";
import { BucksWalletCard } from "#src/components/bucks-wallet-card.tsx";

const noop = () => {
  /* render-only tests never submit */
};

describe("BucksWalletCard", () => {
  test("groups every user-visible number and links the rules", () => {
    const html = renderToStaticMarkup(
      <BucksWalletCard
        wallet={{ balance: 3000, totalAtRisk: 1250, pendingPositionCount: 3 }}
        eligible={true}
      />,
    );
    expect(html).toContain("3,000");
    expect(html).toContain("1,250");
    expect(html).toContain("/docs/reference/bryan-bucks-rules/");
    // Rule numbers are stated only by /bb rules and the docs.
    expect(html).not.toContain("%");
  });

  test("renders the no-wallet-yet state for an eligible member", () => {
    const html = renderToStaticMarkup(
      <BucksWalletCard wallet={null} eligible={true} />,
    );
    expect(html).toContain("No wallet yet");
  });

  test("renders the never-eligible state distinctly for an untracked member", () => {
    const html = renderToStaticMarkup(
      <BucksWalletCard wallet={null} eligible={false} />,
    );
    expect(html).not.toContain("No wallet yet");
    expect(html).toContain("tracked");
  });
});

describe("BucksMarketCard", () => {
  const market = {
    matchId: "NA1_123",
    sides: [
      {
        teamId: 100,
        label: "WIN",
        trackedPlayers: ["jerred"],
        totalStake: 1200,
        betCount: 2,
        positions: [{ discordId: "111", stake: 1000 }],
      },
      {
        teamId: 200,
        label: "LOSE",
        trackedPlayers: [],
        totalStake: 0,
        betCount: 0,
        positions: [],
      },
    ],
    yourPosition: null,
  };

  test("renders server-provided side labels and named positions verbatim", () => {
    const html = renderToStaticMarkup(
      <BucksMarketCard
        market={market}
        remainingMs={90_000}
        balance={25}
        canBet={true}
        nameOf={(id) => `user-${id}`}
        pending={false}
        serverError={null}
        onPlace={noop}
        onCancelRequest={noop}
      />,
    );
    expect(html).toContain("WIN");
    expect(html).toContain("LOSE");
    expect(html).toContain("user-111");
    expect(html).toContain("1,000");
    expect(html).toContain("Closes in 01:30");
    expect(html).not.toContain("%");
  });

  test("hides the bet form once the window has closed", () => {
    const html = renderToStaticMarkup(
      <BucksMarketCard
        market={market}
        remainingMs={0}
        balance={25}
        canBet={true}
        nameOf={(id) => id}
        pending={false}
        serverError={null}
        onPlace={noop}
        onCancelRequest={noop}
      />,
    );
    expect(html).toContain("Betting closed");
    expect(html).not.toContain("Place bet");
  });

  test("suppresses the bet form for an ineligible member instead of inviting an impossible submission", () => {
    const html = renderToStaticMarkup(
      <BucksMarketCard
        market={market}
        remainingMs={90_000}
        balance={null}
        canBet={false}
        nameOf={(id) => id}
        pending={false}
        serverError={null}
        onPlace={noop}
        onCancelRequest={noop}
      />,
    );
    expect(html).not.toContain("Place bet");
    expect(html).toContain("Only players tracked in this server can bet.");
  });
});

describe("BucksParlayCard", () => {
  test("suppresses the bet form for an ineligible member", () => {
    const html = renderToStaticMarkup(
      <BucksParlayCard
        idPrefix="parlay-test"
        market={{
          title: "Match parlay",
          subtitle: "jerred · NA1_123",
          legs: ["jerred gets at least 7 kills"],
          yesOdds: "2.50",
          noOdds: "1.67",
          yourPosition: null,
        }}
        remainingMs={90_000}
        balance={null}
        canBet={false}
        nameOf={(id) => id}
        pending={false}
        serverError={null}
        onPlace={noop}
      />,
    );
    expect(html).not.toContain("Place bet");
    expect(html).toContain("Only players tracked in this server can bet.");
  });
});

describe("BucksPendingPositions", () => {
  test("offers cancel only while the pool is open", () => {
    const html = renderToStaticMarkup(
      <BucksPendingPositions
        positions={[
          {
            marketType: "outcome",
            matchId: "NA1_1",
            gameAlias: "jerred",
            sideLabel: "WIN",
            offeredStake: 10,
            matchedStake: null,
            poolState: "open",
            cancellationFee: 2,
          },
          {
            marketType: "outcome",
            matchId: "NA1_2",
            gameAlias: "bryan",
            sideLabel: "LOSE",
            offeredStake: 5,
            matchedStake: 5,
            poolState: "closed",
            cancellationFee: null,
          },
        ]}
        onCancelOutcome={noop}
      />,
    );
    expect(html.split("Cancel").length - 1).toBe(1);
  });
});

describe("BucksLedgerList", () => {
  test("shows signed grouped deltas and disables paging at the bounds", () => {
    const html = renderToStaticMarkup(
      <BucksLedgerList
        entries={[
          {
            id: 2,
            delta: 1500,
            balanceAfter: 1525,
            label: "Bet settled",
            matchId: "NA1_9",
            createdAt: "2026-08-28T12:00:00.000Z",
          },
          {
            id: 1,
            delta: -25,
            balanceAfter: 25,
            label: "Bet placed",
            matchId: null,
            createdAt: "2026-08-27T12:00:00.000Z",
          },
        ]}
        page={0}
        totalPages={1}
        onPreviousPage={noop}
        onNextPage={noop}
        onRefresh={noop}
      />,
    );
    expect(html).toContain("+1,500 BB");
    expect(html).toContain("-25 BB");
    expect(html).toContain("Page 1 of 1");
  });
});

describe("BucksCountdown", () => {
  test("flips to closed at zero", () => {
    expect(
      renderToStaticMarkup(<BucksCountdown remainingMs={1000} />),
    ).toContain("Closes in 00:01");
    expect(renderToStaticMarkup(<BucksCountdown remainingMs={0} />)).toContain(
      "Betting closed",
    );
  });
});
