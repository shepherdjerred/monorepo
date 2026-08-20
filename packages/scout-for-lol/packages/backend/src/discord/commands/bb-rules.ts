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
          `Stake any positive whole-BB amount your wallet can cover on the Blue or Red Team in a tracked player's game; that market stays open for ${Math.floor(BETTING_WINDOW_MS / 60_000).toString()} minutes. ` +
          `A separate YES/NO parlay may open for ${Math.floor(PARLAY_BETTING_WINDOW_MS / 60_000).toString()} minutes, with its full house liability reserved when you bet. ` +
          "You can add to a position before its window closes. Cancelling an outcome position has a 20% house cut; cancelling a parlay returns its full stake and releases the house reserve.",
      },
      {
        name: "Settlement",
        value:
          "Winners get their stakes back and split the losing side's pool in proportion to their stakes. " +
          "The house takes 20% of each human winner's gross payout, rounded to the nearest BB, without cutting into winning principal. " +
          "If people bet on only one side, the Bryan Bucks house matches the other side when its reserve can cover the stake.",
      },
      {
        name: "Refunds",
        value:
          "All stakes are returned with no house cut when a game is voided or remade, cannot be settled, or the house cannot cover a one-sided market.",
      },
    );
}
