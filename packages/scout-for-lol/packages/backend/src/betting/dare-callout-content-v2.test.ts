import { describe, expect, test } from "vitest";
import { dareV2CalloutContent } from "#src/betting/dare-callout-content-v2.ts";

const ACCEPT_DEADLINE = new Date("2026-09-02T12:00:00.000Z");

function content(input: {
  openingStake: number;
  potTotal: number;
  contributions: readonly { discordId: string; amount: number }[];
}) {
  return dareV2CalloutContent({
    id: 1,
    challengerDiscordId: "100",
    openingStake: input.openingStake,
    potTotal: input.potTotal,
    contributions: input.contributions,
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

describe("dareV2CalloutContent", () => {
  test("shows no pile-ons when only the opening contribution exists", () => {
    const rendered = content({
      openingStake: 10,
      potTotal: 10,
      contributions: [{ discordId: "100", amount: 10 }],
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
      contributions: [
        { discordId: "100", amount: 10 },
        { discordId: "200", amount: 5 },
      ],
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
      contributions: [
        { discordId: "100", amount: 10 },
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
      contributions: [
        { discordId: "100", amount: 10 },
        { discordId: "200", amount: 10 },
      ],
    });

    expect(rendered).toContain("put **10 BB**");
    expect(rendered).toContain("Pot: **20 BB**");
  });

  test("summarizes deterministic overflow contributors", () => {
    const rendered = content({
      openingStake: 10,
      potTotal: 211,
      contributions: [
        { discordId: "100", amount: 10 },
        ...Array.from({ length: 200 }, (_, index) => ({
          discordId: (index + 200).toString(),
          amount: 1,
        })),
      ],
    });

    expect(rendered.length).toBeLessThanOrEqual(2000);
    expect(rendered).toContain("…and");
    expect(rendered).toContain("more contributor(s).");
  });
});
