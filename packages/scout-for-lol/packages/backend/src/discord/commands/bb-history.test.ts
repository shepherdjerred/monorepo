import { describe, expect, test } from "vitest";
import { BucksLedgerKindSchema } from "@scout-for-lol/data/index.ts";
import {
  ledgerKindLabel,
  renderBucksHistory,
} from "#src/betting/navigation.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

describe("/bb history labels", () => {
  test("renders current and legacy house transfers readably", () => {
    expect(ledgerKindLabel(BucksLedgerKindSchema.parse("house_rake"))).toBe(
      "legacy house cut on payout",
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

    const rendered = renderBucksHistory(bucksTestDiscordId(1), {
      entries: [
        {
          id: 2,
          delta: -1,
          balanceAfter: 9,
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
    expect(rendered.content).toContain("legacy house cut on payout");
    expect(rendered.content).toContain("cancellation fee");
    expect(rendered.content).toContain(HOUSE_CUT_TERMS);
    expect(rendered.content).not.toContain("house_rake");
    expect(rendered.content).not.toContain("cancel_fee");
  });
});
