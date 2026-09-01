import { describe, expect, test } from "vitest";
import {
  dareAcceptAckContent,
  dareAchievedContent,
  dareCalloutContent,
  dareChickenContent,
  dareConfirmationContent,
  dareConfirmedPostedContent,
  dareContributionAckContent,
  dareExpiredContent,
  dareLeafProgress,
  dareLeafProgressLabel,
  dareProgressLine,
  dareResultMessage,
  dareUnachievedContent,
  dareVoidedContent,
  type DareCalloutView,
} from "#src/betting/dare-copy.ts";
import type { DareLeaf } from "#src/betting/dare-criteria.ts";
import type { DareSettlementSummary } from "#src/betting/dare-settle-shared.ts";

const DEADLINE = new Date("2026-09-01T12:00:00.000Z");
const WINDOW_END = new Date("2026-09-08T12:00:00.000Z");
const rel = (date: Date): string =>
  `<t:${Math.floor(date.getTime() / 1000).toString()}:R>`;

const WIN_LEAF: DareLeaf = {
  kind: "condition",
  requiredGames: 7,
  predicate: { kind: "participant_boolean", field: "win", expected: true },
  champion: null,
};

const SUMMARY_TEXT = "at least 7 games where Virmel wins on Warwick";

function summaryFixture(
  overrides: Partial<DareSettlementSummary>,
): DareSettlementSummary {
  return {
    dareId: 7,
    serverId: "1337623164146155593",
    channelId: "1337623164146155594",
    messageRef: null,
    matchId: undefined,
    resolution: "captured",
    horizonKind: "window",
    challengerDiscordId: "100",
    targetAliases: ["Virmel"],
    conditionSummary: SUMMARY_TEXT,
    potTotal: 25,
    payouts: [],
    refunds: [],
    voidReason: undefined,
    leafCounts: undefined,
    ...overrides,
  };
}

describe("dare confirmation copy", () => {
  test("pins the confirmation content", () => {
    expect(
      dareConfirmationContent({
        amount: 1000,
        targetAliases: ["Virmel", "Bryan"],
        conditionSummary: SUMMARY_TEXT,
        horizonKind: "window",
        windowDays: 7,
        proposalExpiresAt: DEADLINE,
      }),
    ).toBe(
      [
        "**The dare:**",
        SUMMARY_TEXT,
        "",
        "**Horizon:** **7 days** from the moment every target accepts",
        "**Opening pot:** **1,000 BB** — debited from your wallet when you confirm.",
        "**Targets:** Virmel, Bryan — they risk nothing and must all accept before it goes live.",
        `Confirm before ${rel(DEADLINE)}. \`/bb rules\``,
      ].join("\n"),
    );
  });

  test("phrases a next-game horizon without a window", () => {
    const content = dareConfirmationContent({
      amount: 5,
      targetAliases: ["Virmel"],
      conditionSummary: SUMMARY_TEXT,
      horizonKind: "next_game",
      windowDays: null,
      proposalExpiresAt: DEADLINE,
    });
    expect(content).toContain("**Horizon:** their next eligible game");
    expect(content).not.toContain("days");
  });

  test("pins the posted acknowledgement", () => {
    expect(
      dareConfirmedPostedContent({ potTotal: 25, acceptDeadline: DEADLINE }),
    ).toBe(
      `✅ Dare confirmed — **25 BB** in the pot. Callout posted; every target must accept ${rel(DEADLINE)}.`,
    );
  });
});

describe("dare callout copy", () => {
  const baseView: DareCalloutView = {
    dareState: "pending_accept",
    challengerDiscordId: "100",
    potTotal: 25,
    conditionSummary: SUMMARY_TEXT,
    horizonKind: "window",
    targets: [
      { discordId: "200", alias: "Virmel", accepted: true, declined: false },
      { discordId: "300", alias: "Bryan", accepted: false, declined: false },
    ],
    acceptDeadline: DEADLINE,
    windowEndsAt: null,
    progress: [],
  };

  test("pins the pending-accept callout with checklist and mentions", () => {
    expect(dareCalloutContent(baseView)).toBe(
      [
        "🎯 **Bryan Bucks dare** — <@100> put **25 BB** on it",
        "**The dare:**",
        SUMMARY_TEXT,
        `**Accept checklist** — every target must accept ${rel(DEADLINE)}:`,
        "• ✅ <@200> — accepted",
        "• ⏳ <@300>",
        "Targets risk nothing. Anyone else can pile onto the pot below — contributions are final. `/bb rules`",
      ].join("\n"),
    );
  });

  test("pins the LIVE callout with window end and progress", () => {
    const view: DareCalloutView = {
      ...baseView,
      dareState: "active",
      windowEndsAt: WINDOW_END,
      progress: dareLeafProgress([WIN_LEAF], [3]),
    };
    expect(dareCalloutContent(view)).toBe(
      [
        `🔴 **Bryan Bucks dare: LIVE** — **25 BB** on the line, ends ${rel(WINDOW_END)}`,
        "**The dare:**",
        SUMMARY_TEXT,
        "**Progress:**",
        "• Wins: 3/7",
        "Pile onto the pot below — contributions are final. `/bb rules`",
      ].join("\n"),
    );
  });

  test("renders the next-game LIVE callout as a backstop, not a deadline", () => {
    const view: DareCalloutView = {
      ...baseView,
      dareState: "active",
      horizonKind: "next_game",
      windowEndsAt: WINDOW_END,
      progress: dareLeafProgress([WIN_LEAF], [0]),
    };
    expect(dareCalloutContent(view)).toBe(
      [
        `🔴 **Bryan Bucks dare: LIVE** — **25 BB** on the line, settles on the next eligible game (expires ${rel(WINDOW_END)} if none is played)`,
        "**The dare:**",
        SUMMARY_TEXT,
        "**Progress:**",
        "• Wins: 0/7",
        "Pile onto the pot below — contributions are final. `/bb rules`",
      ].join("\n"),
    );
  });

  test("next-game and window LIVE callouts differ on the same clock", () => {
    const base: DareCalloutView = {
      ...baseView,
      dareState: "active",
      windowEndsAt: WINDOW_END,
      progress: dareLeafProgress([WIN_LEAF], [0]),
    };
    const nextGame = dareCalloutContent({ ...base, horizonKind: "next_game" });
    const window = dareCalloutContent({ ...base, horizonKind: "window" });
    expect(nextGame).not.toBe(window);
    // The backstop must never be phrased as the dare simply "ending".
    expect(nextGame).not.toContain(`, ends ${rel(WINDOW_END)}`);
    expect(nextGame).toContain("settles on the next eligible game");
    expect(window).toContain(`, ends ${rel(WINDOW_END)}`);
    expect(window).not.toContain("settles on the next eligible game");
  });

  test("renders the declined final state naming the decliner", () => {
    const view: DareCalloutView = {
      ...baseView,
      dareState: "declined",
      targets: [
        { discordId: "200", alias: "Virmel", accepted: false, declined: true },
      ],
    };
    expect(dareCalloutContent(view)).toBe(
      [
        "🐔 **Bryan Bucks dare: CHICKENED OUT**",
        "**The dare was:**",
        SUMMARY_TEXT,
        "Pot: **25 BB** — <@200> declined.",
      ].join("\n"),
    );
  });

  test("renders the achieved final state with no components context", () => {
    const view: DareCalloutView = { ...baseView, dareState: "achieved" };
    expect(dareCalloutContent(view)).toContain(
      "✅ **Bryan Bucks dare: ACHIEVED**",
    );
  });
});

describe("dare progress labels", () => {
  test("labels a win leaf as Wins", () => {
    expect(dareLeafProgressLabel(WIN_LEAF)).toBe("Wins");
  });

  test("labels a numeric leaf with operator and catalog label", () => {
    expect(
      dareLeafProgressLabel({
        kind: "condition",
        requiredGames: 3,
        predicate: {
          kind: "participant_numeric",
          field: "kills",
          operator: "gte",
          threshold: 10,
        },
        champion: null,
      }),
    ).toBe("Games with ≥ 10 kills");
  });

  test("labels a rate leaf with a champion filter", () => {
    expect(
      dareLeafProgressLabel({
        kind: "condition",
        requiredGames: 2,
        predicate: {
          kind: "participant_rate",
          field: "cs_per_minute",
          operator: "gte",
          thresholdScaled: 750,
        },
        champion: "Warwick",
      }),
    ).toBe("Games with ≥ 7.5 CS per minute on Warwick");
  });

  test("formats the progress line with grouped integers", () => {
    expect(
      dareProgressLine({ label: "Wins", count: 1000, requiredGames: 1200 }),
    ).toBe("• Wins: 1,000/1,200");
  });
});

describe("dare result copy", () => {
  test("pins the chicken message", () => {
    expect(dareChickenContent({ declinerDiscordId: "200", potTotal: 25 })).toBe(
      [
        "🐔 **Bryan Bucks dare: CHICKENED OUT**",
        "<@200> declined the dare. The pot's **25 BB** went back to the contributors in full.",
      ].join("\n"),
    );
  });

  test("pins the expired message", () => {
    expect(dareExpiredContent({ potTotal: 25 })).toBe(
      [
        "⌛ **Bryan Bucks dare: EXPIRED**",
        "Not every target accepted in time. The pot's **25 BB** went back to the contributors in full.",
      ].join("\n"),
    );
  });

  test("pins the achieved message, mentions the challenger, and hides zero fees", () => {
    expect(
      dareAchievedContent({
        challengerDiscordId: "100",
        conditionSummary: SUMMARY_TEXT,
        potTotal: 2001,
        payouts: [
          {
            bucksAccountId: 1,
            discordId: "200",
            alias: "Virmel",
            grossShare: 1000,
            fee: 200,
            net: 800,
          },
          {
            bucksAccountId: 2,
            discordId: "300",
            alias: "Bryan",
            grossShare: 1,
            fee: 0,
            net: 1,
          },
        ],
      }),
    ).toBe(
      [
        "✅ **Bryan Bucks dare: ACHIEVED**",
        SUMMARY_TEXT,
        "Funded by <@100>. The **2,001 BB** pot pays out:",
        "• **Virmel** <@200> — +**800 BB** · **200 BB** fee",
        "• **Bryan** <@300> — +**1 BB**",
      ].join("\n"),
    );
  });

  test("pins the unachieved message with per-contributor refunds", () => {
    expect(
      dareUnachievedContent({
        conditionSummary: SUMMARY_TEXT,
        refunds: [
          {
            bucksAccountId: 1,
            discordId: "100",
            contributed: 20,
            fee: 4,
            refunded: 16,
          },
          {
            bucksAccountId: 2,
            discordId: "400",
            contributed: 1,
            fee: 0,
            refunded: 1,
          },
        ],
      }),
    ).toBe(
      [
        "🛡️ **Bryan Bucks dare: THE DARE SURVIVED**",
        SUMMARY_TEXT,
        "Contributors got their BB back:",
        "• <@100> — **16 BB** back · **4 BB** fee",
        "• <@400> — **1 BB** back",
      ].join("\n"),
    );
  });

  test("pins the voided message with its reason", () => {
    expect(
      dareVoidedContent({
        voidReason: "unknown_evaluator",
        refunds: [
          {
            bucksAccountId: 1,
            discordId: "100",
            contributed: 25,
            fee: 0,
            refunded: 25,
          },
        ],
      }),
    ).toBe(
      [
        "↩️ **Bryan Bucks dare: VOIDED**",
        "Scout can no longer evaluate this dare's stored conditions.",
        "Contributions returned in full:",
        "• <@100> — **25 BB** back",
      ].join("\n"),
    );
  });

  test("explains when a frozen target account becomes unavailable", () => {
    expect(
      dareVoidedContent({
        voidReason: "target_unavailable",
        refunds: [],
      }),
    ).toContain("A frozen target account is no longer available to evaluate.");
  });

  test("pins the private acknowledgements", () => {
    expect(
      dareAcceptAckContent({
        activated: true,
        acceptedCount: 2,
        targetCount: 2,
        horizonKind: "window",
        windowEndsAt: WINDOW_END,
      }),
    ).toBe(`🔥 You're all in. The dare is LIVE — it ends ${rel(WINDOW_END)}.`);
    expect(
      dareAcceptAckContent({
        activated: false,
        acceptedCount: 1,
        targetCount: 2,
        horizonKind: "window",
        windowEndsAt: undefined,
      }),
    ).toBe("✅ Accepted (1/2). Waiting on the rest.");
    expect(
      dareContributionAckContent({ amount: 5, potTotal: 30, balanceAfter: 95 }),
    ).toBe("💰 +**5 BB** onto the pot — now **30 BB**. Balance **95 BB**.");
  });

  test("the next-game accept ack settles on the next game, not the backstop", () => {
    const nextGame = dareAcceptAckContent({
      activated: true,
      acceptedCount: 2,
      targetCount: 2,
      horizonKind: "next_game",
      windowEndsAt: WINDOW_END,
    });
    expect(nextGame).toBe(
      `🔥 You're all in. The dare is LIVE — it settles on your next eligible game (expires ${rel(WINDOW_END)} if no game is played).`,
    );
    // Same clock, different horizon ⇒ different copy; the backstop is never
    // presented as the dare's ordinary end date.
    expect(nextGame).not.toBe(
      dareAcceptAckContent({
        activated: true,
        acceptedCount: 2,
        targetCount: 2,
        horizonKind: "window",
        windowEndsAt: WINDOW_END,
      }),
    );
    expect(nextGame).not.toContain(`it ends ${rel(WINDOW_END)}`);
  });

  test("a next-game ack with no backstop omits the expiry clause", () => {
    expect(
      dareAcceptAckContent({
        activated: true,
        acceptedCount: 1,
        targetCount: 1,
        horizonKind: "next_game",
        windowEndsAt: undefined,
      }),
    ).toBe(
      "🔥 You're all in. The dare is LIVE — it settles on your next eligible game.",
    );
  });
});

describe("dareResultMessage", () => {
  test("returns nothing for captures and abandons", () => {
    expect(dareResultMessage(summaryFixture({}))).toBeUndefined();
    expect(
      dareResultMessage(summaryFixture({ resolution: "abandoned" })),
    ).toBeUndefined();
  });

  test("mentions payees and the challenger once on achieved", () => {
    const message = dareResultMessage(
      summaryFixture({
        resolution: "achieved",
        payouts: [
          {
            bucksAccountId: 1,
            discordId: "100",
            alias: "Self",
            grossShare: 10,
            fee: 2,
            net: 8,
          },
        ],
      }),
    );
    expect(message?.mentionUserIds).toEqual(["100"]);
    expect(message?.content).toContain("ACHIEVED");
  });

  test("mentions only refunded contributors on unachieved", () => {
    const message = dareResultMessage(
      summaryFixture({
        resolution: "unachieved",
        refunds: [
          {
            bucksAccountId: 1,
            discordId: "100",
            contributed: 20,
            fee: 4,
            refunded: 16,
          },
          {
            bucksAccountId: 2,
            discordId: "100",
            contributed: 5,
            fee: 1,
            refunded: 4,
          },
        ],
      }),
    );
    expect(message?.mentionUserIds).toEqual(["100"]);
    expect(message?.content).toContain("THE DARE SURVIVED");
  });

  test("uses the expired copy for lapsed accept windows", () => {
    const message = dareResultMessage(
      summaryFixture({
        resolution: "expired",
        refunds: [
          {
            bucksAccountId: 1,
            discordId: "100",
            contributed: 25,
            fee: 0,
            refunded: 25,
          },
        ],
      }),
    );
    expect(message?.content).toContain("EXPIRED");
    expect(message?.mentionUserIds).toEqual(["100"]);
  });
});
