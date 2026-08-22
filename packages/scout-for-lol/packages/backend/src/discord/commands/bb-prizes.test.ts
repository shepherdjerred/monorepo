import { describe, expect, test } from "bun:test";
import {
  buildPersonalBucksEmbed,
  buildBbRulesEmbed,
  isPublicBbSubcommand,
} from "#src/discord/commands/bb.ts";
import { bbCommand } from "#src/discord/commands/bb-definition.ts";
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

  test("registers uncapped outcome and parlay stake options", () => {
    const command = bbCommand.toJSON();
    for (const name of ["bet", "parlay"]) {
      const subcommand = command.options?.find(
        (option) => option.name === name,
      );
      if (subcommand === undefined || !("options" in subcommand)) {
        throw new Error(`${name} subcommand is missing its options`);
      }
      const amount = subcommand.options?.find(
        (option) => option.name === "amount",
      );
      expect(amount).toEqual(
        expect.objectContaining({ type: 4, required: true, min_value: 1 }),
      );
      expect(JSON.stringify(amount)).not.toContain("max_value");
    }
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
    expect(isPublicBbSubcommand("pass")).toBe(false);
    expect(isPublicBbSubcommand("peek")).toBe(false);
    expect(isPublicBbSubcommand("rules")).toBe(true);
    expect(isPublicBbSubcommand("prizes")).toBe(true);
  });

  test("registers a private pass quote and required tracked-game peek", () => {
    const command = bbCommand.toJSON();
    const pass = command.options?.find((option) => option.name === "pass");
    const peek = command.options?.find((option) => option.name === "peek");
    expect(pass).toEqual(
      expect.objectContaining({ type: 1, name: "pass", options: [] }),
    );
    if (peek === undefined || !("options" in peek)) {
      throw new Error("expected /bb peek");
    }
    expect(peek.options).toEqual([
      expect.objectContaining({ name: "game", required: true }),
    ]);
    // The two-minute delay is a rule, so it lives in /bb rules only.
    expect(JSON.stringify(buildBbRulesEmbed().toJSON())).toContain(
      "**2 minutes**",
    );
  });

  test("keeps long pending-position aliases inside Discord's field limit", () => {
    const view: PersonalBucksView = {
      balance: 25,
      totalAtRisk: 10,
      pendingPositionCount: 10,
      pendingPositions: Array.from({ length: 10 }, (_, index) => ({
        marketType: "outcome" as const,
        matchId: `NA1_${index.toString()}`,
        gameAlias: `player-${index.toString()}-${"x".repeat(500)}`,
        teamId: 100,
        sideLabel: "WIN",
        offeredStake: 1,
        matchedStake: null,
        unmatchedStake: null,
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

  test("renders pending positions with the game's own framing", () => {
    const view: PersonalBucksView = {
      balance: 20,
      totalAtRisk: 5,
      pendingPositionCount: 1,
      pendingPositions: [
        {
          marketType: "outcome",
          matchId: "NA1_1",
          gameAlias: "bryan",
          teamId: 200,
          sideLabel: "LOSE",
          offeredStake: 5,
          matchedStake: null,
          unmatchedStake: null,
          closesAt: new Date(60_000),
          poolState: "open",
        },
      ],
    };

    const rendered = JSON.stringify(buildPersonalBucksEmbed(view, 0).toJSON());
    // The label is resolved where the roster is already parsed, so the view
    // renders it verbatim rather than re-deriving Blue/Red here.
    expect(rendered).toContain("bryan LOSE");
    expect(rendered).toContain("offered up to 5 BB");
    expect(rendered).not.toContain("Red Team");
  });

  test("renders pending parlays independently from direct team picks", () => {
    const view: PersonalBucksView = {
      balance: 20,
      totalAtRisk: 5,
      pendingPositionCount: 1,
      pendingPositions: [
        {
          marketType: "parlay",
          matchId: "NA1_1",
          subjectAlias: "Parlay (bryan)",
          side: "YES",
          stake: 5,
          closesAt: new Date(60_000),
          poolState: "open",
        },
      ],
    };

    const rendered = JSON.stringify(buildPersonalBucksEmbed(view, 0).toJSON());
    expect(rendered).toContain("Parlay (bryan) YES");
    expect(rendered).not.toContain("Blue Team");
    expect(rendered).not.toContain("Red Team");
  });

  test("rules explain the complete economy", () => {
    const rendered = JSON.stringify(buildBbRulesEmbed().toJSON());
    for (const phrase of [
      "tracked League players",
      "25 BB",
      "+1 BB",
      "maximum offer",
      "10 minutes",
      "5 minutes",
      "match first at even money",
      "house then fills up to **5 BB**",
      "Unmatched BB are refunded at close, free",
      "return every matched stake with no fee",
    ]) {
      expect(rendered).toContain(phrase);
    }
    expect(rendered).toContain(
      "Cancelling before close costs **20%** of the offer, rounded to the nearest BB",
    );
    expect(rendered).toContain("Cancelling a parlay is free");
  });

  // Gaps that existed while these facts lived only on market messages, or not
  // at all. /bb rules is now the only explainer, so it has to be complete.
  test("rules cover what only the market message used to say", () => {
    const rendered = JSON.stringify(buildBbRulesEmbed().toJSON());
    expect(rendered).toContain("Every leg must hit for YES");
    expect(rendered).toContain("live in-play market");
    // The Clash bonus is the largest single award and was documented nowhere.
    expect(rendered).toContain("Clash adds **+10 BB**");
    // The queue list is derived from BUCKS_EARNING_QUEUES rather than typed,
    // and League Classic's split behaviour (played point, no market) is
    // stated rather than left for a player to discover.
    expect(rendered).toContain("Eligible queues:");
    expect(rendered).toContain(
      "League Classic pays the played point but carries no market",
    );
    expect(rendered).not.toContain("Eligible ranked games");
    // WIN/LOSE with the documented Blue/Red fallback.
    expect(rendered).toContain("**WIN** or **LOSE**");
    expect(rendered).toContain("both teams have a tracked player");
  });

  // /bb rules used to say "no cash value" while /bb prizes printed CAD figures
  // up to $1,000,000 with no cross-reference.
  test("rules and prizes agree that the exchange rate is a joke", () => {
    const rules = JSON.stringify(buildBbRulesEmbed().toJSON());
    expect(rules).toContain("a joke");
    expect(rules).toContain("nothing can actually be redeemed");
    expect(rules).toContain("`/bb prizes`");
  });

  // Every number is interpolated from the constant that implements it. The
  // rules embed and the market copy once stated two different winner fees at
  // the same time because both were hand-typed.
  test("rules derive their numbers from the implementing constants", async () => {
    const [{ HOUSE_CUT_PERCENT }, constants, { MINIMUM_PRICE }] =
      await Promise.all([
        import("#src/betting/house-cut.ts"),
        import("#src/betting/constants.ts"),
        import("#src/betting/peek-pass.ts"),
      ]);
    const rendered = JSON.stringify(buildBbRulesEmbed().toJSON());

    expect(rendered).toContain(`**${HOUSE_CUT_PERCENT.toString()}%**`);
    expect(rendered).toContain(`**${constants.SEED_GRANT.toString()} BB**`);
    expect(rendered).toContain(
      `**${constants.HOUSE_MATCH_LIMIT.toString()} BB** per game`,
    );
    expect(rendered).toContain(`minimum **${MINIMUM_PRICE.toString()} BB**`);
    expect(rendered).toContain(
      `${Math.floor(constants.BETTING_WINDOW_MS / 60_000).toString()} minutes`,
    );
    expect(rendered).toContain(
      `${Math.floor(constants.PARLAY_BETTING_WINDOW_MS / 60_000).toString()} minutes`,
    );
  });
});
