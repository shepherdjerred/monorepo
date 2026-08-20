import { EmbedBuilder } from "discord.js";
import {
  BETTING_WINDOW_MS,
  PARLAY_BETTING_WINDOW_MS,
  SEED_GRANT,
} from "#src/betting/constants.ts";

const BUCKS_COLOR = 0x2e_cc_71;

export function buildBbRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("📜 Bryan Bucks rules")
    .setColor(BUCKS_COLOR)
    .setDescription(
      "Bryan Bucks are friendly points for tracked League players. They have no cash value.",
    )
    .addFields(
      {
        name: "Eligibility & earnings",
        value:
          `Your Discord account must be linked to a tracked player. A new wallet starts with **${SEED_GRANT.toString()} BB**. ` +
          "Eligible ranked games award **+1 BB** for playing, **+1 BB** for winning, and **+1 BB** for MVP.",
      },
      {
        name: "Placing a bet",
        value:
          `Offer any positive whole-BB amount your wallet can cover on the Blue or Red Team in a tracked player's game; that market stays open for ${Math.floor(BETTING_WINDOW_MS / 60_000).toString()} minutes. Only the final matched amount is at risk. ` +
          `A separate YES/NO parlay may open for ${Math.floor(PARLAY_BETTING_WINDOW_MS / 60_000).toString()} minutes, with its full house liability reserved when you bet. ` +
          "You can add to a position before its window closes. Cancelling an outcome offer costs 20% of the submitted amount, rounded to the nearest BB; cancelling a parlay returns its full stake and releases the house reserve.",
      },
      {
        name: "Outcome matching & settlement",
        value:
          "Human offers match first at even money. The house then fills up to 5 BB of the remaining gap for the whole game, subject to its balance. Oversubscribed offers are matched proportionally, and all unmatched BB are refunded at close. " +
          "A winner receives twice their matched stake before a fee of 20% of matched profit, rounded down.",
      },
      {
        name: "Peek passes",
        value:
          "Use `/bb pass` to buy unlimited private peeks for 24 hours. The price depends on your current balance and how long you have held it, with a 5 BB minimum. " +
          "Use `/bb peek game:<tracked player>` after the game has been live for two minutes. Estimates are experimental, frozen before the game, and disappear when the market resolves.",
      },
      {
        name: "Settlement",
        value:
          "Outcome BB that do not match are refunded automatically with no fee. Matched outcome stakes are returned with no fee when a game is voided, remade, unsupported, or cannot be settled. Parlay voids return the stake and release the reserved house liability.",
      },
    );
}
