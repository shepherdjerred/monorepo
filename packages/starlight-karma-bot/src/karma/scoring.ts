/** Pure karma scoring and leaderboard helpers, extracted from the Discord
 *  command handlers so the behavior can be unit-tested without a live client
 *  or database. The command layer (commands.ts) composes these with I/O. */

/** Amount of karma applied when a giver does not ask for a specific amount. */
export const KARMA_GIVE_AMOUNT = 1;

/** The complete set of amounts a giver may award.
 *
 *  Closed deliberately. An open-ended amount would need a giving budget to stay
 *  meaningful — with no ceiling, amounts drift upward through ordinary social
 *  escalation (not abuse) until the number carries no information. Capping at
 *  3x gets that protection for one validation rule instead of a
 *  balance-tracking subsystem. */
export const ALLOWED_KARMA_AMOUNTS = [1, 2, 3] as const;

export type KarmaAmount = (typeof ALLOWED_KARMA_AMOUNTS)[number];

/** Thrown when a requested amount is outside {@link ALLOWED_KARMA_AMOUNTS}.
 *  Distinguished from a programming error so the command layer can answer the
 *  user rather than reporting to Sentry — a mistyped amount is boundary input,
 *  not a broken contract. */
export class InvalidKarmaAmountError extends Error {
  constructor(readonly received: string) {
    super(
      `Karma amount must be one of ${ALLOWED_KARMA_AMOUNTS.join(", ")} — got ${received}`,
    );
    this.name = "InvalidKarmaAmountError";
  }
}

/** Validate a requested amount. Every entry point (slash command, context
 *  menu, reactions) funnels through here so the bound cannot be bypassed by
 *  adding a new surface. */
export function parseKarmaAmount(requested: unknown): KarmaAmount {
  const value =
    typeof requested === "string" ? Number(requested.trim()) : requested;
  // `find` over the literal tuple both validates and narrows, so no type
  // assertion is needed. Non-numeric input simply matches nothing.
  const matched = ALLOWED_KARMA_AMOUNTS.find((allowed) => allowed === value);
  if (matched === undefined) {
    throw new InvalidKarmaAmountError(JSON.stringify(requested));
  }
  return matched;
}

/** Decide how much karma a give-interaction should apply.
 *
 *  Giving to yourself costs you the amount you asked for: requesting 3 is a
 *  bigger stunt than requesting 1, so it should sting proportionally. */
export function karmaAmountFor(
  giverId: string,
  receiverId: string,
  requested: unknown = KARMA_GIVE_AMOUNT,
): number {
  const amount = parseKarmaAmount(requested);
  return giverId === receiverId ? -amount : amount;
}

/** A single leaderboard input row: a user id and their summed karma. */
export type KarmaCount = {
  id: string;
  karmaReceived: number;
};

/** A ranked leaderboard row. `rank` uses dense ranking (1, 2, 2, 3): equal
 *  scores share a rank and the next distinct score takes the next integer. */
export type RankedEntry = KarmaCount & {
  rank: number;
};

/** Assign dense competition ranks to karma counts in their given order.
 *  Callers pass rows already sorted by karma descending (the DB view orders
 *  them); this function does not re-sort, matching the original handler. */
export function rankLeaderboard(counts: readonly KarmaCount[]): RankedEntry[] {
  const ranked: RankedEntry[] = [];
  let rank = 0;
  let prev: number | undefined;

  for (const count of counts) {
    if (count.karmaReceived !== prev) {
      rank++;
    }
    prev = count.karmaReceived;
    ranked.push({ ...count, rank });
  }

  return ranked;
}

/** Format a single leaderboard line. Top-3 ranks are emphasized by the caller
 *  via `emphasizeRank`; `displayName` is the already-resolved user label. */
export function formatLeaderboardLine(
  entry: RankedEntry,
  displayName: string,
): string {
  const rankString = `#${entry.rank.toString()}`;
  const shown = entry.rank <= 3 ? `**${rankString}**` : rankString;
  return `${shown}: ${displayName} (${entry.karmaReceived.toString()} karma)`;
}
