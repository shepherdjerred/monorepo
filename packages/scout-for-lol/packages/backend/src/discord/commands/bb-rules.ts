import { EmbedBuilder } from "discord.js";
import {
  BETTING_WINDOW_MS,
  BUCKS_EARNING_QUEUES,
  HOUSE_MATCH_LIMIT,
  PARLAY_BETTING_WINDOW_MS,
  SEED_GRANT,
} from "#src/betting/constants.ts";
import { EARNED_REWARDS } from "#src/betting/earnings.ts";
import { formatInteger } from "#src/betting/display-format.ts";
import { HOUSE_CUT_PERCENT } from "#src/betting/house-cut.ts";
import { PEEK_DELAY_MS } from "#src/betting/pool-open.ts";
import {
  MINIMUM_PRICE,
  PEEK_PASS_DURATION_MS,
} from "#src/betting/peek-pass.ts";
import {
  WEEKLY_PARLAY_ELIGIBLE_QUEUES,
  WEEKLY_PARLAY_MAX_LEGS,
  WEEKLY_PARLAY_MAX_LEG_PROBABILITY_BPS,
  WEEKLY_PARLAY_MAX_YES_PROBABILITY_BPS,
  WEEKLY_PARLAY_MIN_LEGS,
  WEEKLY_PARLAY_MIN_LEG_PROBABILITY_BPS,
  WEEKLY_PARLAY_MIN_YES_PROBABILITY_BPS,
  WEEKLY_PARLAY_SETTLEMENT_MIN_GAMES,
} from "#src/betting/weekly-parlay-criteria.ts";
import {
  WEEKLY_PARLAY_BETTING_CLOSE_HOUR,
  WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_HOURS,
  WEEKLY_PARLAY_FINAL_HOUR,
  WEEKLY_PARLAY_INGESTION_GRACE_MINUTES,
  WEEKLY_PARLAY_OPEN_HOUR,
  WEEKLY_PARLAY_TIMEZONE,
  weeklyParlayWallClockLabel,
} from "#src/betting/weekly-parlay-period.ts";

const BUCKS_COLOR = 0x2e_cc_71;

/**
 * The single place Bryan Bucks rules are explained.
 *
 * No other surface states a fee, a window, a cap, or a rounding mode. Market
 * messages and confirmations show numbers and point here. Two reasons:
 *
 * 1. The old house-terms blurb was 344 characters rendered on seven surfaces —
 *    17% of every character a player ever saw — and four of those surfaces
 *    were not a betting decision.
 * 2. Restating a rule means maintaining it twice, and it drifted: for a day
 *    this embed said the winner fee was 20% of *gross payout* rounded to the
 *    nearest BB while the market copy said 20% of *matched profit* rounded
 *    down. Two different amounts, both live.
 *
 * Every number below is interpolated from the constant that implements it.
 * Do not hand-type one.
 */
function minutes(milliseconds: number): string {
  return Math.floor(milliseconds / 60_000).toString();
}

function hours(milliseconds: number): string {
  return Math.floor(milliseconds / 3_600_000).toString();
}

export function buildBbRulesEmbed(): EmbedBuilder {
  const outcomeWindow = minutes(BETTING_WINDOW_MS);
  const parlayWindow = minutes(PARLAY_BETTING_WINDOW_MS);
  const cut = HOUSE_CUT_PERCENT.toString();
  return new EmbedBuilder()
    .setTitle("📜 Bryan Bucks rules")
    .setColor(BUCKS_COLOR)
    .setDescription(
      "Bryan Bucks are friendly points for tracked League players. They are a joke — there is no cash value and nothing can actually be redeemed. `/bb prizes` is part of the joke.",
    )
    .addFields(
      {
        name: "Getting Bucks",
        value:
          `Link your Discord account to a tracked player. A new wallet starts with **${formatInteger(SEED_GRANT)} BB**. ` +
          `Every eligible game pays **+${formatInteger(EARNED_REWARDS.played.amount)} BB** for playing, ` +
          `**+${formatInteger(EARNED_REWARDS.win.amount)} BB** for winning, and ` +
          `**+${formatInteger(EARNED_REWARDS.mvp.amount)} BB** for MVP. ` +
          `Ranked 5s adds **+${formatInteger(EARNED_REWARDS["ranked 5s bonus"].amount)} BB** and Clash adds ` +
          `**+${formatInteger(EARNED_REWARDS["clash bonus"].amount)} BB**. ` +
          `Eligible queues: ${BUCKS_EARNING_QUEUES.join(", ")}. ` +
          "League Classic pays the played point but carries no market, because Riot exposes no post-game payload for it.",
      },
      {
        name: `Outcome bets — ${outcomeWindow} minutes`,
        value:
          "Bet **WIN** or **LOSE** on the tracked player. When both teams have a tracked player, pick **Blue** or **Red** instead. " +
          "Your amount is a maximum offer: human offers match first at even money, oversubscribed offers match proportionally, " +
          `and the house then fills up to **${formatInteger(HOUSE_MATCH_LIMIT)} BB** per game if its balance allows. ` +
          "Unmatched BB are refunded at close, free. " +
          `Winners get twice their matched stake, less **${cut}%** of matched profit, rounded down. ` +
          `Cancelling before close costs **${cut}%** of the offer, rounded to the nearest BB.`,
      },
      {
        name: `Parlays — ${parlayWindow} minutes`,
        value:
          "A separate YES/NO market on 2-6 legs about the live game. **Every leg must hit for YES.** " +
          "Odds are fixed and quoted when you bet, and the house reserves the full payout at that price. " +
          "It is a live in-play market published after the game starts, so early events may already be visible. " +
          "Cancelling a parlay is free and returns the whole stake.",
      },
      {
        name: "Weekly parlays",
        value:
          `A ${WEEKLY_PARLAY_MIN_LEGS.toString()}-${WEEKLY_PARLAY_MAX_LEGS.toString()} leg YES/NO market across one or more tracked players. ` +
          `It opens Sunday at ${weeklyParlayWallClockLabel(WEEKLY_PARLAY_OPEN_HOUR)} and betting closes Monday at ${weeklyParlayWallClockLabel(WEEKLY_PARLAY_BETTING_CLOSE_HOUR)} in ${WEEKLY_PARLAY_TIMEZONE}. ` +
          `Only completed ${WEEKLY_PARLAY_ELIGIBLE_QUEUES.join(", ")} games count, through Sunday at ${weeklyParlayWallClockLabel(WEEKLY_PARLAY_FINAL_HOUR)}. ` +
          `Activity is not a leg: every featured player must complete **${WEEKLY_PARLAY_SETTLEMENT_MIN_GAMES.toString()} eligible games**, or everyone is refunded. ` +
          `Every proposal includes a one-game peak on a named champion. Each leg must replay at **${(WEEKLY_PARLAY_MIN_LEG_PROBABILITY_BPS / 100).toString()}-${(WEEKLY_PARLAY_MAX_LEG_PROBABILITY_BPS / 100).toString()}%**, and the full parlay at **${(WEEKLY_PARLAY_MIN_YES_PROBABILITY_BPS / 100).toString()}-${(WEEKLY_PARLAY_MAX_YES_PROBABILITY_BPS / 100).toString()}%**, in qualified history. ` +
          `Scout waits **${WEEKLY_PARLAY_INGESTION_GRACE_MINUTES.toString()} minutes** after that cutoff for completed games to ingest. ` +
          `If Sunday opening is missed, an exceptional catch-up market may open midweek with at least **${WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_HOURS.toString()} hours** to bet before the next eligible Pacific midnight. ` +
          "Its message shows the exact betting and scoring timestamps, and games completed before betting closes never count. " +
          "Scout may settle YES early only after every leg is impossible to undo; NO always waits for final settlement. Cancelling before betting closes is free.",
      },
      {
        name: "Voids",
        value:
          "Remakes, unsupported modes, and games that never resolve return every matched stake with no fee. " +
          "Unmatched BB are always refunded free. Parlay voids also release the reserved house payout.",
      },
      {
        name: "Peek passes",
        value:
          `\`/bb pass\` buys **${hours(PEEK_PASS_DURATION_MS)} hours** of private pregame estimates. ` +
          `The price scales with your balance and how long you have held it, minimum **${formatInteger(MINIMUM_PRICE)} BB**. ` +
          `Then \`/bb peek game:<tracked player>\` once the game has been live for **${minutes(PEEK_DELAY_MS)} minutes**. ` +
          "Estimates are experimental, frozen before the game, and disappear when the market resolves.",
      },
    );
}
