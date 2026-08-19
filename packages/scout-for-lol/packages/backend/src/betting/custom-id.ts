import { z } from "zod";

/**
 * Discord custom IDs for the Bryan Bucks buttons.
 *
 * Format: `bb:<version>:<action>:<matchId>:<subjectIndex>:<side>:<amount>`
 *
 * Two properties matter more than the encoding itself:
 *
 * **The ID carries a key, never state.** `subjectIndex` points into the pool's
 * own frozen roster rather than naming a player, so a button keeps working
 * across a bot restart with nothing held in memory. The visible controls name
 * Blue and Red directly; `side` is the compatibility adapter that expresses
 * that team choice relative to this anchor. It also keeps the ID short: a PUUID
 * is 78 characters and Discord's cap is 100.
 *
 * **A malformed ID is never fatal.** This is an unauthenticated input surface —
 * anyone can craft a component interaction — so parsing returns a result rather
 * than throwing. A forged ID can at worst produce a bet the sender could have
 * placed by clicking, because every field is re-validated against server state
 * before anything is charged.
 */

export const BUCKS_COMPONENT_NAMESPACE = "bb";
export const BUCKS_COMPONENT_VERSION = "1";

/** Discord's hard limit on `custom_id`. */
export const MAX_CUSTOM_ID_LENGTH = 100;

const BucksActionSchema = z.enum(["b", "x"]);
const BucksSideSchema = z.enum(["W", "L"]);

export type BucksCustomId = z.infer<typeof BucksCustomIdSchema>;
export const BucksCustomIdSchema = z.strictObject({
  /** `b` places a bet; `x` cancels the sender's position. */
  action: BucksActionSchema,
  matchId: z.string().min(1),
  /** Index into `BucksMatchPool.roster.participants`. */
  subjectIndex: z.number().int().min(0).max(9),
  /** Whether the selected team matches the anchor's team. */
  side: BucksSideSchema,
  /** Stake in Bucks. Zero for a cancel, where it carries no meaning. */
  amount: z.number().int().min(0).max(1000),
});

export function formatBucksCustomId(input: BucksCustomId): string {
  const parsed = BucksCustomIdSchema.parse(input);
  const id = [
    BUCKS_COMPONENT_NAMESPACE,
    BUCKS_COMPONENT_VERSION,
    parsed.action,
    parsed.matchId,
    parsed.subjectIndex.toString(),
    parsed.side,
    parsed.amount.toString(),
  ].join(":");

  // Asserted rather than trusted: a future field or a longer platform prefix
  // would silently produce IDs Discord rejects at send time, which is a much
  // worse place to discover it.
  if (id.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `Bryan Bucks custom ID is ${id.length.toString()} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH.toString()} limit: ${id}`,
    );
  }
  return id;
}

const EXPECTED_SEGMENTS = 7;

/**
 * Parse a custom ID, or return undefined if it is not one of ours.
 *
 * Never throws. An unrecognised or malformed ID is an ordinary occurrence —
 * another feature's component, a stale ID from an older version, or someone
 * poking the API — and none of those deserve an exception.
 */
export function parseBucksCustomId(raw: string): BucksCustomId | undefined {
  const segments = raw.split(":");
  if (segments.length !== EXPECTED_SEGMENTS) {
    return undefined;
  }

  const [namespace, version, action, matchId, subjectIndex, side, amount] =
    segments;
  if (
    namespace !== BUCKS_COMPONENT_NAMESPACE ||
    version !== BUCKS_COMPONENT_VERSION
  ) {
    return undefined;
  }

  const result = BucksCustomIdSchema.safeParse({
    action,
    matchId,
    subjectIndex: Number(subjectIndex),
    side,
    amount: Number(amount),
  });
  return result.success ? result.data : undefined;
}

/** Whether a custom ID belongs to this feature at all, without validating it.
 * Used by the dispatcher to decide whether to claim the interaction. */
export function isBucksCustomId(raw: string): boolean {
  return raw.startsWith(`${BUCKS_COMPONENT_NAMESPACE}:`);
}
