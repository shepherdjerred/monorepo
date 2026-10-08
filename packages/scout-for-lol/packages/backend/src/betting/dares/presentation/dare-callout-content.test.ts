import { describe, expect, test } from "vitest";
import {
  BucksAmountSchema,
  DareChallengerStakeSchema,
  DarePayoutSchema,
  DarePileOnSchema,
  DarePotTotalSchema,
  DiscordAccountIdSchema,
} from "@scout-for-lol/data";
import {
  DARE_CALLOUT_MAX_LENGTH,
  dareCalloutContent,
  renderDareResult,
} from "#src/betting/dares/presentation/dare-callout-content.ts";

const ACCEPT_DEADLINE = new Date("2026-09-02T12:00:00.000Z");

function content(input: {
  openingStake: number;
  potTotal: number;
  pileOns: readonly { discordId: string; amount: number }[];
}) {
  return dareCalloutContent({
    id: 1,
    challengerDiscordId: "100",
    openingStake: DareChallengerStakeSchema.parse(input.openingStake),
    potTotal: DarePotTotalSchema.parse(input.potTotal),
    pileOns: input.pileOns.map((pileOn) => ({
      discordId: pileOn.discordId,
      amount: DarePileOnSchema.parse(pileOn.amount),
    })),
    targetAliases: ["Virmel"],
    revision: 1,
    plainLanguage: "Virmel wins a game with at least 8 CS per minute.",
    evidenceCount: 0,
    progressSummary: "Waiting for more eligible match evidence.",
    state: "pending_accept",
    targets: [{ alias: "Virmel", acceptedAt: null, declinedAt: null }],
    acceptDeadline: ACCEPT_DEADLINE,
    deadlineAt: null,
    finalValue: null,
    voidReason: null,
  });
}

describe("dareCalloutContent", () => {
  test("shows no pile-ons when only the opening contribution exists", () => {
    const rendered = content({
      openingStake: 10,
      potTotal: 10,
      pileOns: [],
    });

    expect(rendered).toContain("<@100> put **10 BB** on Virmel.");
    expect(rendered).toContain("Pot: **10 BB**");
    expect(rendered).toContain("**Pile-ons:**\nNone yet.");
    expect(rendered).toContain(
      "**Progress** · Waiting for more eligible match evidence. (0 evidence games)",
    );
  });

  test("shows a later contributor separately from the opening stake", () => {
    const rendered = content({
      openingStake: 10,
      potTotal: 15,
      pileOns: [{ discordId: "200", amount: 5 }],
    });

    expect(rendered).toContain("<@100> put **10 BB** on Virmel.");
    expect(rendered).toContain("Pot: **15 BB**");
    expect(rendered).toContain("<@200> — **5 BB**");
    expect(rendered).not.toContain("<@100> — **10 BB**");
  });

  test("aggregates repeated contributions in first-contribution order", () => {
    const rendered = content({
      openingStake: 10,
      potTotal: 25,
      pileOns: [
        { discordId: "200", amount: 5 },
        { discordId: "300", amount: 2 },
        { discordId: "200", amount: 5 },
      ],
    });

    expect(rendered).toContain("<@200> — **10 BB**");
    expect(rendered).toContain("<@300> — **2 BB**");
    expect(rendered.indexOf("<@200> — **10 BB**")).toBeLessThan(
      rendered.indexOf("<@300> — **2 BB**"),
    );
    expect(rendered).not.toContain("<@200> — **5 BB**");
  });

  test("keeps the opening stake separate from the current pot", () => {
    const rendered = content({
      openingStake: 10,
      potTotal: 20,
      pileOns: [{ discordId: "200", amount: 10 }],
    });

    expect(rendered).toContain("put **10 BB**");
    expect(rendered).toContain("Pot: **20 BB**");
  });

  test("summarizes deterministic overflow contributors", () => {
    const rendered = content({
      openingStake: 10,
      potTotal: 211,
      pileOns: Array.from({ length: 200 }, (_, index) => ({
        discordId: (index + 200).toString(),
        amount: 1,
      })),
    });

    expect(rendered.length).toBeLessThanOrEqual(2000);
    expect(rendered).toContain("…and");
    expect(rendered).toContain("more contributor(s).");
  });
});

describe("renderDareResult", () => {
  // A Dare drafted before the draft-length check can carry plain-language
  // text up to the old 4,000-character ceiling, and that text sits in the
  // header the trimming loop cannot drop.
  const longPlainLanguage = "Virmel wins a game. ".repeat(200);
  const challenger = DiscordAccountIdSchema.parse("100000000000000001");
  const payouts = Array.from({ length: 30 }, (_, index) => ({
    discordId: DiscordAccountIdSchema.parse(
      (200_000_000_000_000_000n + BigInt(index)).toString(),
    ),
    alias: `Target ${index.toString()}`,
    net: DarePayoutSchema.parse(16),
    fee: BucksAmountSchema.parse(4),
  }));

  test("truncates overlong plain-language text and still names a payout", () => {
    expect(longPlainLanguage).toHaveLength(4000);
    const rendered = renderDareResult(7, {
      resolution: "achieved",
      challengerDiscordId: challenger,
      plainLanguage: longPlainLanguage,
      potTotal: DarePotTotalSchema.parse(600),
      payouts,
      refunds: [],
      voidReason: null,
    });

    expect(rendered.content.length).toBeLessThanOrEqual(
      DARE_CALLOUT_MAX_LENGTH,
    );
    const [, plainLine] = rendered.content.split("\n");
    expect(plainLine?.startsWith("Virmel wins a game.")).toBe(true);
    expect(plainLine?.endsWith("…")).toBe(true);
    const first = payouts[0];
    if (first === undefined) throw new Error("No payout fixture");
    expect(rendered.content).toContain(
      `• **Target 0** <@${first.discordId}> — +**16 BB** · **4 BB** fee`,
    );
    expect(rendered.content).toContain("…and 29 more.");
    expect(rendered.mentionUserIds).toContain(first.discordId);
  });

  test("keeps short plain-language text whole", () => {
    const rendered = renderDareResult(8, {
      resolution: "unachieved",
      challengerDiscordId: challenger,
      plainLanguage: "Virmel wins a game.",
      potTotal: DarePotTotalSchema.parse(20),
      payouts: [],
      refunds: [
        {
          discordId: challenger,
          refunded: BucksAmountSchema.parse(20),
          fee: BucksAmountSchema.parse(0),
        },
      ],
      voidReason: null,
    });

    expect(rendered.content.split("\n")[1]).toBe("Virmel wins a game.");
  });
});
