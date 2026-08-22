import { BUCKS_RULES_HINT } from "#src/betting/prematch-line.ts";

/**
 * User-facing Bryan Bucks strings shared by more than one surface.
 *
 * Two rules govern everything in this file:
 *
 * 1. **State numbers, not rules.** `/bb rules` is the only place a fee, a
 *    window, or a rounding mode is explained. Every other surface that
 *    restated them drifted: the rules embed and the old prematch blurb once
 *    described the winner fee as two different amounts at the same time.
 * 2. **One concept, one string.** The outcome and parlay handlers previously
 *    carried five copies of the DM guard in two dialects, three copies of
 *    "no market", and a parlay "only tracked players can bet" that silently
 *    dropped the remediation sentence its outcome twin carried.
 */

export const BUCKS_GUILD_ONLY = "🏠 Bryan Bucks only works inside a server.";

export const BUCKS_NOT_ENABLED = "🚫 Bryan Bucks isn't enabled in this server.";

export const BUCKS_NO_OUTCOME_MARKET =
  "🚫 There's no Bryan Bucks market for this game.";

export const BUCKS_NO_PARLAY_MARKET =
  "🚫 There's no parlay market for this game.";

/** Keeps the actionable second sentence; the parlay copy used to drop it. */
export const BUCKS_NOT_ELIGIBLE =
  "🔒 Only tracked players can bet. Ask an admin to link your Discord account to a player in the dashboard.";

export const BUCKS_INVALID_STAKE =
  "💱 Bets must be a positive whole number of BB.";

export const BUCKS_STORAGE_LIMIT =
  "💱 That position is too large for the current Bryan Bucks storage format.";

export const BUCKS_HOUSE_CANNOT_FUND =
  "🏦 The Bryan Bucks house can't fund a new wallet right now. No Bucks moved.";

export function bucksInsufficient(balance: number, needed: number): string {
  return `💸 You have **${balance.toString()} BB** but need **${needed.toString()} BB**.`;
}

/** Appended where a reader may want the rules but the surface must not carry them. */
export function withRulesHint(text: string): string {
  return `${text} ${BUCKS_RULES_HINT}`;
}
