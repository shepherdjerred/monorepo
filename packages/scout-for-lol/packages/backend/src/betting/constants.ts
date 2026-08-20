import { DiscordAccountIdSchema, type QueueType } from "@scout-for-lol/data";

/**
 * Tuning constants for Bryan Bucks.
 *
 * Kept in one file because several of them are load-bearing across module
 * boundaries: the betting window is stored on each pool at creation, the void
 * grace period is chosen relative to two unrelated timeouts elsewhere in the
 * codebase, and persisted stakes remain within the existing Int32 domain while
 * calculations use bigint intermediates.
 */

/**
 * How long a market stays open after Scout detects the game.
 *
 * Ten minutes of *detected* time, not ten minutes of game time — see
 * `computeClosesAt`, which also clamps against the game's own start timestamp
 * so a late detection cannot silently extend the window.
 */
export const BETTING_WINDOW_MS = 10 * 60 * 1000;

/** The parlay is a separate live/in-play market published after prematch. */
export const PARLAY_BETTING_WINDOW_MS = 5 * 60 * 1000;

export const PARLAY_GENERATION_DEADLINE_MS = 60_000;
export const PARLAY_INITIAL_OUTPUT_TOKENS = 4096;
export const PARLAY_RETRY_OUTPUT_TOKENS = 6144;
export const DEFAULT_PARLAY_AI_MODEL = "gpt-5.6-sol";

/**
 * How long past its close a pool may sit unsettled before it is voided and
 * every stake refunded.
 *
 * Six hours is chosen against two existing constants rather than picked round:
 * `ActiveGame`'s TTL is 3h and `MAX_DISCORD_ALERT_AGE_MS` is 3h, so by the
 * time this fires the match can no longer arrive through the normal post-match
 * path at all. The trade, stated plainly: a match whose settlement kept
 * throwing ends in a refund rather than a wrong payout. For a friendly-stakes
 * economy that is the right direction, and without this sweep staked Bucks
 * would be silently destroyed.
 */
export const VOID_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * One-time grant transferred from the guild house when a wallet is first
 * created.
 *
 * Earning alone cannot bootstrap the economy: a player with no Bucks cannot
 * bet, and betting is the point. Sized at roughly eight games' worth of
 * earnings so a new member can take a position immediately without the number
 * meaning anything. The house debit keeps the grant inside the existing
 * bankroll instead of minting new Bucks.
 */
export const SEED_GRANT = 25;

/**
 * The per-server bankroll available to match a one-sided market. It is seeded
 * once through the same ledger as every other account, so house risk and house
 * winnings remain auditable rather than being implicit minting.
 */
export const HOUSE_BANKROLL = 10_000;

/** Synthetic, non-user Discord ID used only by the per-server house account. */
export const HOUSE_ACCOUNT_DISCORD_ID =
  DiscordAccountIdSchema.parse("10000000000000000");

/**
 * Stake denominations offered as buttons on the prematch message.
 *
 * Two values, because a row holds at most five components and the fifth is
 * Cancel. Small against `SEED_GRANT` and against the three-Bucks-per-game
 * earning ceiling; anything larger goes through `/bb bet`.
 */
export const BUTTON_STAKES = [1, 5] as const;

export const MIN_STAKE = 1;

/**
 * Below this, a game is a remake: no Bucks are earned and every stake is
 * refunded. Riot reports `gameDuration` in seconds.
 */
export const REMAKE_MAX_DURATION_SECONDS = 300;

/**
 * Queues that earn Bucks and can carry a market.
 *
 * which also matches "clash" and "aram clash". That helper exists to gate AI
 * review spend; reusing it would mean a future tweak to review heuristics
 * silently moves the economy. Solo and flex are exactly the queues the MVP
 * weights are calibrated for. Classic intentionally has no prediction inputs,
 * but it still has a binary 5v5 outcome and can carry a market. Standard Clash
 * is included; ARAM Clash is not.
 */
export const BUCKS_EARNING_QUEUES: readonly QueueType[] = [
  "solo",
  "flex",
  "classic",
  "ranked 5s",
  "clash",
];

/** Riot's two team identifiers on Summoner's Rift. */
export const BLUE_TEAM_ID = 100;
export const RED_TEAM_ID = 200;

/** A standard 5v5 lobby. Both the market and the MVP formula refuse anything
 * else. */
export const PARTICIPANTS_PER_TEAM = 5;
export const STANDARD_LOBBY_SIZE = PARTICIPANTS_PER_TEAM * 2;
