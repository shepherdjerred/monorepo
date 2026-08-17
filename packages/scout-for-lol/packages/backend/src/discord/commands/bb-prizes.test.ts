import { describe, expect, test } from "bun:test";
import { bbCommand } from "#src/discord/commands/bb.ts";
import {
  BB_PRIZES,
  buildBbPrizesEmbed,
} from "#src/discord/commands/bb-prizes.ts";

describe("/bb prizes", () => {
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
