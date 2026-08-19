import { describe, expect, test } from "bun:test";
import {
  bbCommand,
  buildPersonalBucksEmbed,
  buildBbRulesEmbed,
  isPublicBbSubcommand,
} from "#src/discord/commands/bb.ts";
import type { PersonalBucksView } from "#src/betting/accounts.ts";
import {
  BB_PRIZES,
  buildBbPrizesEmbed,
} from "#src/discord/commands/bb-prizes.ts";

describe("/bb prizes", () => {
  test("offers no redemption, donation, burn, or claim command", () => {
    const command = bbCommand.toJSON();
    const names = command.options?.map((option) => option.name) ?? [];

    for (const absent of ["redeem", "redemption", "donate", "burn", "claim"]) {
      expect(names).not.toContain(absent);
    }
  });

  test("registers a no-option prizes subcommand", () => {
    const command = bbCommand.toJSON();
    const prizes = command.options?.find((option) => option.name === "prizes");

    expect(prizes).toEqual(
      expect.objectContaining({
        type: 1,
        name: "prizes",
        description: "See what your Bryan Bucks can buy",
        options: [],
      }),
    );
  });

  test("renders the approved catalog at the joke exchange rate", () => {
    const embed = buildBbPrizesEmbed().toJSON();
    const rendered = JSON.stringify(embed);

    expect(BB_PRIZES).toHaveLength(13);
    expect(rendered).toContain("Exchange rate: **1 BB = CAD $10**");
    expect(rendered).toContain("RED Jeep Wrangler");
    expect(rendered).toContain("RED Jeep Grand Cherokee");
    expect(rendered).toContain("Subaru Jimmy");
    expect(rendered).toContain("Bryan plays one game of League");
    expect(rendered).toContain("Jerred says “what’s up guys”");
    expect(rendered).toContain("15,000 BB** / CAD $150,000");
    expect(rendered).toContain("100 BB** / CAD $1,000");
    expect(embed.footer?.text).toBe(
      "Prizes can be redeemed in person with Bryan.",
    );

    for (const prize of BB_PRIZES) {
      expect(rendered).toContain(
        `${prize.bbCost.toLocaleString("en-CA")} BB** / CAD $${(prize.bbCost * 10).toLocaleString("en-CA")}`,
      );
    }

    for (const removed of [
      "Toyota Corolla",
      "Tesla Model 3",
      "Porsche 911",
      "High-end gaming PC",
      "Full streaming setup",
      "NHL playoff tickets",
      "Courtside NBA ticket",
      "Super Bowl ticket",
      "Week in Paris",
      "Hot tub",
      "Private island weekend",
      "UFC pay-per-view night",
      "Introductory MMA lesson",
      "Cage-side regional fight ticket",
      "Bryan’s fight-night commentary",
      "Bryan buys customs-lobby pizza",
    ]) {
      expect(rendered).not.toContain(removed);
    }

    expect(rendered).not.toMatch(/one server|single-server|rural canada/iu);
  });
});

describe("/bb command contract", () => {
  test("removes the on-demand leaderboard and adds no-option rules/history", () => {
    const command = bbCommand.toJSON();
    const names = command.options?.map((option) => option.name) ?? [];
    const history = command.options?.find(
      (option) => option.name === "history",
    );
    const rules = command.options?.find((option) => option.name === "rules");

    expect(names).not.toContain("leaderboard");
    expect(rules).toEqual(
      expect.objectContaining({ type: 1, name: "rules", options: [] }),
    );
    expect(history).toEqual(
      expect.objectContaining({ type: 1, name: "history", options: [] }),
    );
  });

  test("keeps personal and market views private", () => {
    expect(isPublicBbSubcommand("balance")).toBe(false);
    expect(isPublicBbSubcommand("history")).toBe(false);
    expect(isPublicBbSubcommand("open")).toBe(false);
    expect(isPublicBbSubcommand("bet")).toBe(false);
    expect(isPublicBbSubcommand("rules")).toBe(true);
    expect(isPublicBbSubcommand("prizes")).toBe(true);
  });

  test("keeps long pending-position aliases inside Discord's field limit", () => {
    const view: PersonalBucksView = {
      balance: 25,
      totalStaked: 10,
      pendingPositionCount: 10,
      pendingPositions: Array.from({ length: 10 }, (_, index) => ({
        matchId: `NA1_${index.toString()}`,
        gameAlias: `player-${index.toString()}-${"x".repeat(500)}`,
        teamId: 100,
        stake: 1,
        closesAt: new Date(60_000),
        poolState: "open",
      })),
    };

    const pendingField = buildPersonalBucksEmbed(view, 0)
      .toJSON()
      .fields?.find((field) => field.name === "Pending positions");

    expect(pendingField?.value.length).toBeLessThanOrEqual(1024);
    expect(pendingField?.value.endsWith("...")).toBe(true);
  });

  test("renders pending positions as direct team picks", () => {
    const view: PersonalBucksView = {
      balance: 20,
      totalStaked: 5,
      pendingPositionCount: 1,
      pendingPositions: [
        {
          matchId: "NA1_1",
          gameAlias: "bryan",
          teamId: 200,
          stake: 5,
          closesAt: new Date(60_000),
          poolState: "open",
        },
      ],
    };

    const rendered = JSON.stringify(buildPersonalBucksEmbed(view, 0).toJSON());
    expect(rendered).toContain("Red Team");
    expect(rendered).toContain("game: `bryan`");
    expect(rendered).not.toContain("WIN");
    expect(rendered).not.toContain("LOSE");
  });

  test("rules explain the complete economy", () => {
    const rendered = JSON.stringify(buildBbRulesEmbed().toJSON());
    for (const phrase of [
      "tracked League players",
      "25 BB",
      "+1 BB",
      "1-1000 BB",
      "10 minutes",
      "cancel",
      "split the losing side's pool",
      "house matches",
      "All stakes are returned",
    ]) {
      expect(rendered).toContain(phrase);
    }
    expect(rendered).toContain(
      "cancel it before the window closes for a 20% house cut, rounded to the nearest BB",
    );
  });
});
