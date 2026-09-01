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

/** Delay before retrying a wallet-funded earning. */
export const PENDING_EARNING_RETRY_DELAY_MS = 5 * 60 * 1000;

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

/** Maximum aggregate house exposure added to one guild's game pool. */
export const HOUSE_MATCH_LIMIT = 5;

/** Synthetic, non-user Discord ID used only by the per-server house account. */
export const HOUSE_ACCOUNT_DISCORD_ID =
  DiscordAccountIdSchema.parse("10000000000000000");

/**
 * Stake denominations offered as buttons on the prematch message.
 *
 * Two values, because a row holds at most five components and the fifth is
 * Cancel. Small against `SEED_GRANT` and against the three-Bucks-per-game
 * earning ceiling; larger positions are built by clicking again — top-ups
 * stack onto the same offer.
 */
export const BUTTON_STAKES = [1, 5] as const;

export const MIN_STAKE = 1;
export const MINIMUM_BUCKS_TRANSFER = 2;

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
 * weights are calibrated for. League Classic has no supported post-game
 * payload, so it has a separate pre-match participation grant and cannot
 * carry a market. Standard Clash is included; ARAM Clash is not.
 */
export const BUCKS_EARNING_QUEUES: readonly QueueType[] = [
  "solo",
  "flex",
  "ranked 5s",
  "clash",
];

/**
 * How long an unconfirmed dare proposal lives.
 *
 * A `proposed` dare holds no money — it is an ephemeral confirmation the
 * challenger has not clicked yet — so the TTL only bounds how long a stale
 * translation can still be confirmed against a shortlist that may have moved.
 * Ten minutes matches the outcome market's sense of "still the same moment".
 */
export const DARE_PROPOSAL_TTL_MS = 10 * 60 * 1000;

/**
 * How long targets have to accept before the dare expires and fully refunds.
 *
 * Long enough to span time zones and a work day; short enough that escrowed
 * contributions are never parked indefinitely behind someone who will not
 * answer. Lapsing is the public chicken outcome, so the window is also the
 * social deadline.
 */
export const DARE_ACCEPT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Window length when the challenger names none: one week of games. */
export const DARE_DEFAULT_WINDOW_DAYS = 7;

/**
 * Longest allowed window. A calendar month bounds how long contributions sit
 * in escrow and keeps every deadline within one season's patch churn.
 */
export const DARE_MAX_WINDOW_DAYS = 31;

/**
 * How long a `next_game` dare waits for that game before it is swept
 * unachieved. Not queueing is not a forfeit rule — the clock just runs out —
 * and seven days matches the default window so the two horizons cost the
 * same patience.
 */
export const DARE_NEXT_GAME_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Grace past `windowEndsAt` before the unachieved sweep settles a window
 * dare.
 *
 * A game that *ends* inside the window can still be minutes away from
 * Match-V5 ingestion, and settling before it lands would refund a dare the
 * targets actually achieved. Thirty minutes is at least two worst-case
 * polling intervals of the match-history cursor — the same margin the weekly
 * parlays leave — so eligibility stays "ended inside the window", not "was
 * ingested inside it".
 */
export const DARE_WINDOW_INGESTION_GRACE_MS = 30 * 60 * 1000;

/**
 * Most players one dare may name. Groups require every target in the same
 * match on the same team, so five is also the largest group that can ever
 * qualify — a full team.
 */
export const DARE_MAX_TARGETS = 5;

/** Longest accepted `/bb dare` free text. Bounds the translation prompt and
 * keeps the code-rendered confirmation inside one embed field. */
export const DARE_MAX_TEXT_LENGTH = 400;

/** Most leaves a translated condition tree may hold across all clauses. */
export const DARE_MAX_LEAVES = 6;

/** Most clauses under the root, and most leaves per clause. The fixed
 * depth-2 tree (root over clauses over leaves) covers AND-of-ORs and
 * OR-of-ANDs without recursion. */
export const DARE_MAX_CLAUSES = 4;

/**
 * Cap on any leaf's required qualifying games. Fifty is unreachable inside
 * the 31-day maximum window for these queues, so it bounds storage and
 * rendering without ever being the reason a plausible dare is rejected.
 */
export const DARE_MAX_REQUIRED_GAMES = 50;

/**
 * Pot-contribution denominations offered as buttons on the dare callout.
 * Deliberately THE SAME denominations as the prematch buttons: contributions
 * are append-only, so larger amounts are built by clicking again, and deriving
 * the alias keeps the two button sets in lockstep structurally.
 */
export const DARE_CONTRIBUTION_STAKES = BUTTON_STAKES;

/**
 * Deadline for the dare translation call. Shorter than the parlay's 60s
 * budget because a human is actively waiting on an ephemeral reply, and a
 * single structured completion — no second threshold pass — fits well inside
 * it.
 */
export const DARE_TRANSLATION_DEADLINE_MS = 30_000;

/** Output-token budget for the translation call, and the raised retry budget
 * used when the first attempt is cut off mid-object. */
export const DARE_TRANSLATION_OUTPUT_TOKENS = 2048;
export const DARE_TRANSLATION_RETRY_OUTPUT_TOKENS = 3072;

/** Riot's two team identifiers on Summoner's Rift. */
export const BLUE_TEAM_ID = 100;
export const RED_TEAM_ID = 200;

/** A standard 5v5 lobby. Both the market and the MVP formula refuse anything
 * else. */
export const PARTICIPANTS_PER_TEAM = 5;
export const STANDARD_LOBBY_SIZE = PARTICIPANTS_PER_TEAM * 2;
