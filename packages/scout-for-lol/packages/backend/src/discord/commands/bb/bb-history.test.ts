import { describe, expect, test } from "vitest";
import { BucksLedgerKindSchema } from "@scout-for-lol/data/index.ts";
import {
  ledgerKindLabel,
  renderBucksHistory,
} from "#src/betting/navigation.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

describe("/bb history labels", () => {
  test("renders current and legacy house transfers readably", () => {
    expect(ledgerKindLabel(BucksLedgerKindSchema.parse("house_rake"))).toBe(
      "house cut on payout",
    );
    expect(ledgerKindLabel(BucksLedgerKindSchema.parse("cancel_fee"))).toBe(
      "cancellation fee",
    );
    expect(ledgerKindLabel(BucksLedgerKindSchema.parse("winner_fee"))).toBe(
      "winner fee",
    );
    expect(ledgerKindLabel(BucksLedgerKindSchema.parse("peek_pass"))).toBe(
      "24-hour peek pass",
    );
    expect(ledgerKindLabel(BucksLedgerKindSchema.parse("transfer_sent"))).toBe(
      "transfer sent",
    );
    expect(
      ledgerKindLabel(BucksLedgerKindSchema.parse("transfer_received")),
    ).toBe("transfer received");
    expect(ledgerKindLabel(BucksLedgerKindSchema.parse("transfer_fee"))).toBe(
      "transfer fee",
    );

    const rendered = renderBucksHistory(bucksTestDiscordId(1), {
      entries: [
        {
          id: 2,
          delta: -3000,
          balanceAfter: 12_345,
          kind: BucksLedgerKindSchema.parse("cancel_fee"),
          matchId: "NA1_1",
          context: "{}",
          createdAt: new Date(0),
        },
        {
          id: 1,
          delta: -2,
          balanceAfter: 10,
          kind: BucksLedgerKindSchema.parse("house_rake"),
          matchId: "NA1_1",
          context: "{}",
          createdAt: new Date(0),
        },
      ],
      page: 0,
      pageSize: 10,
      totalEntries: 2,
      totalPages: 1,
      snapshotId: 2,
    });
    expect(rendered.content).toContain("house cut on payout");
    expect(rendered.content).toContain("cancellation fee");
    expect(rendered.content).toContain("`-3,000`");
    expect(rendered.content).toContain("12,345 BB");
    expect(rendered.content).toContain("NA1_1");
    // History is an audit trail, not a place to re-explain the fee schedule.
    expect(rendered.content).not.toContain("20%");
    expect(rendered.content).not.toContain("legacy");
    expect(rendered.content).not.toContain("house_rake");
    expect(rendered.content).not.toContain("cancel_fee");
  });

  test("shows tracked players instead of the match ID when resolved", () => {
    const rendered = renderBucksHistory(
      bucksTestDiscordId(1),
      {
        entries: [
          {
            id: 7,
            delta: 5,
            balanceAfter: 30,
            kind: BucksLedgerKindSchema.parse("bet_payout"),
            matchId: "NA1_777",
            context: "{}",
            createdAt: new Date(0),
          },
          {
            id: 6,
            delta: 1,
            balanceAfter: 25,
            kind: BucksLedgerKindSchema.parse("earn_game"),
            matchId: "NA1_778",
            context: "{}",
            createdAt: new Date(0),
          },
        ],
        page: 0,
        pageSize: 10,
        totalEntries: 2,
        totalPages: 1,
        snapshotId: 7,
      },
      new Map([[7, "jerred, bryan"]]),
    );
    expect(rendered.content).toContain("gross bet payout · jerred, bryan");
    expect(rendered.content).not.toContain("NA1_777");
    // A row with no resolved label keeps the match ID — a worse label beats
    // a missing audit line.
    expect(rendered.content).toContain("game played · NA1_778");
  });

  // Regression backstop: even a resolver that failed to bound its own labels
  // (the real resolver is covered separately in
  // navigation.integration.test.ts) must not produce a page over Discord's
  // 2000-character content limit.
  test("bounds the whole page even when a resolved label is unexpectedly long", () => {
    const longAlias = "x".repeat(100);
    const entries = Array.from({ length: 10 }, (_unused, index) => ({
      id: index + 1,
      delta: 1,
      balanceAfter: index + 1,
      kind: BucksLedgerKindSchema.parse("earn_game"),
      matchId: `NA1_${index.toString()}`,
      context: "{}",
      createdAt: new Date(0),
    }));
    const gameLabels = new Map(
      entries.map((entry) => [
        entry.id,
        `${longAlias}, ${longAlias}, ${longAlias}`,
      ]),
    );

    const rendered = renderBucksHistory(
      bucksTestDiscordId(1),
      {
        entries,
        page: 0,
        pageSize: 10,
        totalEntries: 10,
        totalPages: 1,
        snapshotId: 10,
      },
      gameLabels,
    );

    expect(rendered.content.length).toBeLessThanOrEqual(2000);
    expect(rendered.content.endsWith("...")).toBe(true);
  });
});
