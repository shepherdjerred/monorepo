import {
  DARE_V2_MAX_ELIGIBLE_GAMES,
  DARE_V2_MAX_HORIZON_DAYS,
  DARE_V2_MAX_TARGETS,
  formatInteger,
} from "@scout-for-lol/data";
import { EmbedBuilder } from "discord.js";
import {
  BETTING_WINDOW_MS,
  BUCKS_EARNING_QUEUES,
  DARE_ACCEPT_WINDOW_MS,
  DARE_DEFAULT_WINDOW_DAYS,
  DARE_MAX_TARGETS,
  DARE_MAX_WINDOW_DAYS,
  DARE_NEXT_GAME_TIMEOUT_MS,
  HOUSE_MATCH_LIMIT,
  MINIMUM_BUCKS_TRANSFER,
  PARLAY_BETTING_WINDOW_MS,
  SEED_GRANT,
} from "#src/betting/constants.ts";
import { EARNED_REWARDS } from "#src/betting/earnings.ts";
import { HOUSE_CUT_PERCENT } from "#src/betting/house-cut.ts";
import { DARE_V2_INTENT_TTL_MS } from "#src/betting/constants.ts";
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

function days(milliseconds: number): string {
  return Math.floor(milliseconds / 86_400_000).toString();
}

function dareRules(version: 1 | 2 | 3, cut: string): string[] {
  if (version === 1) {
    return [
      `\`/bb dare\` puts a one-sided bounty on up to **${DARE_MAX_TARGETS.toString()}** tracked players: contributors fund the pot, targets risk nothing.`,
      `Every target must accept within **${hours(DARE_ACCEPT_WINDOW_MS)} hours**; any decline — or a lapsed window — cancels the dare and refunds every contribution free.`,
      `A windowed dare runs **${DARE_DEFAULT_WINDOW_DAYS.toString()} days** by default (up to **${DARE_MAX_WINDOW_DAYS.toString()}**); a next-game dare waits up to **${days(DARE_NEXT_GAME_TIMEOUT_MS)} days** for that game.`,
      "Anyone except a target can pile onto the pot at any time. Contributions are append-only — they never come back out early.",
      `Achieved: the targets split the pot evenly, each share minus **${cut}%** (rounded down; any indivisible remainder goes to the house). Not achieved: each contributor gets their total back minus **${cut}%** (rounded to the nearest BB).`,
    ];
  }
  const contractDescription =
    version === 3
      ? "Its canonical standard SQL is the binding contract; the wording and readable summary explain it."
      : "Its preview explicitly states same-game/cross-game scope, target relationship, queues, bounds, and generated ScoutQL.";
  return [
    `\`/bb dare\` creates a private Explore draft for **1-${DARE_V2_MAX_TARGETS.toString()}** frozen targets. ${contractDescription}`,
    `Funding is a single-use **${minutes(DARE_V2_INTENT_TTL_MS)} minute** confirmation. It freezes the revision and opens a **${hours(DARE_ACCEPT_WINDOW_MS)} hour** acceptance window; decline, expiry, or challenger cancellation then refunds everyone free.`,
    `After every target accepts, the contract runs for at most **${DARE_V2_MAX_HORIZON_DAYS.toString()} days** and **${DARE_V2_MAX_ELIGIBLE_GAMES.toString()} eligible games**. Active terms and deadlines cannot be edited or cancelled.`,
    "Targets risk nothing. Missing required timeline evidence stays unknown; an unknowable final result voids with full refunds.",
    `Achieved: only targets required by the decisive proof split the pot, each share minus **${cut}%**. Not achieved: contributors receive their totals minus **${cut}%**.`,
  ];
}

export function buildBbRulesEmbed(dareVersion: 1 | 2 | 3 = 1): EmbedBuilder {
  const outcomeWindow = minutes(BETTING_WINDOW_MS);
  const parlayWindow = minutes(PARLAY_BETTING_WINDOW_MS);
  const cut = HOUSE_CUT_PERCENT.toString();
  return new EmbedBuilder()
    .setTitle("📜 Bryan Bucks rules")
    .setColor(BUCKS_COLOR)
    .setDescription(
      [
        "Bryan Bucks (BB) are friendly points for tracked League players.",
        "They are a joke: there is no cash value and nothing can actually be redeemed. `/bb prizes` is part of the joke.",
      ].join("\n"),
    )
    .addFields(
      {
        name: "Earning Bucks",
        value: [
          "Link your Discord account to a tracked player to join.",
          `A new wallet starts with **${formatInteger(SEED_GRANT)} BB**.`,
          `Each eligible game pays **+${formatInteger(EARNED_REWARDS.played.amount)} BB** for playing, **+${formatInteger(EARNED_REWARDS.win.amount)} BB** for a win, and **+${formatInteger(EARNED_REWARDS.mvp.amount)} BB** for MVP.`,
          `Ranked 5s adds **+${formatInteger(EARNED_REWARDS["ranked 5s bonus"].amount)} BB**; Clash adds **+${formatInteger(EARNED_REWARDS["clash bonus"].amount)} BB**.`,
          `Eligible queues: ${BUCKS_EARNING_QUEUES.join(", ")}.`,
          "League Classic pays the played point but carries no market — Riot exposes no post-game data for it.",
        ].join("\n"),
      },
      {
        name: `Betting on games — closes after ${outcomeWindow} minutes`,
        value: [
          "Bet with the buttons on the game's own message.",
          "Pick **WIN** or **LOSE** for the tracked player. When both teams have a tracked player, the buttons say **Blue** and **Red** instead.",
          "Your amount is a maximum offer. Offers from the two sides match first at even money; oversubscribed offers match proportionally.",
          `The house then fills up to **${formatInteger(HOUSE_MATCH_LIMIT)} BB** per game, if its balance allows.`,
          "Unmatched BB are refunded at close, free.",
          `Win and you get back twice your matched stake, minus **${cut}%** of the profit (rounded down).`,
          `Cancelling before close costs **${cut}%** of the offer, rounded to the nearest BB.`,
        ].join("\n"),
      },
      {
        name: `Parlays — close after ${parlayWindow} minutes`,
        value: [
          "One shared YES/NO market per game, on 2-6 statements about it. **Every leg must hit for YES.**",
          "Odds are fixed when you bet, and the house reserves your full payout at that price.",
          "It is a live in-play market — it opens after the game starts, so early events may already be decided.",
          "Cancelling a parlay is free and returns the whole stake.",
        ].join("\n"),
      },
      {
        name: "Weekly parlays",
        value: [
          `One YES/NO market across the whole week, with ${WEEKLY_PARLAY_MIN_LEGS.toString()}-${WEEKLY_PARLAY_MAX_LEGS.toString()} legs about one or more tracked players.`,
          `Opens Sunday at ${weeklyParlayWallClockLabel(WEEKLY_PARLAY_OPEN_HOUR)}; betting closes Monday at ${weeklyParlayWallClockLabel(WEEKLY_PARLAY_BETTING_CLOSE_HOUR)} (${WEEKLY_PARLAY_TIMEZONE}).`,
          `Only completed ${WEEKLY_PARLAY_ELIGIBLE_QUEUES.join(", ")} games finished by Sunday at ${weeklyParlayWallClockLabel(WEEKLY_PARLAY_FINAL_HOUR)} count, and Scout waits **${WEEKLY_PARLAY_INGESTION_GRACE_MINUTES.toString()} minutes** past that cutoff for late games to ingest.`,
          `Activity is not a leg: every featured player must complete **${WEEKLY_PARLAY_SETTLEMENT_MIN_GAMES.toString()} eligible games**, or everyone is refunded.`,
          "Every proposal includes a one-game peak on a named champion.",
          `Each leg must historically land at **${(WEEKLY_PARLAY_MIN_LEG_PROBABILITY_BPS / 100).toString()}-${(WEEKLY_PARLAY_MAX_LEG_PROBABILITY_BPS / 100).toString()}%**, and the full parlay at **${(WEEKLY_PARLAY_MIN_YES_PROBABILITY_BPS / 100).toString()}-${(WEEKLY_PARLAY_MAX_YES_PROBABILITY_BPS / 100).toString()}%**.`,
          `If the Sunday opening is missed, a catch-up market may open midweek with at least **${WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_HOURS.toString()} hours** to bet. Its message shows the exact clocks, and games finished before betting closes never count.`,
          "YES can settle early once every leg is impossible to undo; NO always waits for the end. Cancelling before betting closes is free.",
        ].join("\n"),
      },
      {
        name: "Dares",
        value: dareRules(dareVersion, cut).join("\n"),
      },
      {
        name: "Voids & refunds",
        value: [
          "Remakes, unsupported modes, and games that never resolve return every matched stake with no fee.",
          "Unmatched BB are always refunded free.",
          "Parlay voids also release the reserved house payout.",
        ].join("\n"),
      },
      {
        name: "Western Union transfers",
        value:
          `\`/bb transfer\` spends at least **${formatInteger(MINIMUM_BUCKS_TRANSFER)} BB** from your wallet. ` +
          "The recipient gets half, rounded down, and the house gets half, rounded up. " +
          "Both people need existing wallets in this server. Transfers are immediate, irreversible, and post a public receipt with the exact split but no balances.",
      },
    );
}
