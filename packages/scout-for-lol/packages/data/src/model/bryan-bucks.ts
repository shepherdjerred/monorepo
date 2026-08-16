import { z } from "zod";
import { LeaguePuuidSchema } from "#src/model/league-account.ts";
import { QueueTypeSchema } from "#src/model/state.ts";

/**
 * Bryan Bucks — the friendly betting currency.
 *
 * Bucks exchange at 1:10 Bucks:CAD, in person only, from Bryan, who lives in
 * rural Canada. They are therefore unredeemable in practice. There is no
 * monetary component and nothing transfers to real goods.
 *
 * These schemas describe the JSON blobs and string enums stored on the
 * `Bucks*` Prisma models. SQLite has no native enum type, so every one of
 * these columns is a plain `String` in the database and is validated here on
 * the way in and on the way out.
 */

/**
 * Riot's numeric team identifier. Bets are stored against this rather than
 * against a player, because every 5v5 outcome reduces to the same binary
 * event: with two tracked players on opposite teams, "A wins" *is* "B loses".
 * Storing the team is what lets one pool hold both framings without
 * double-counting.
 *
 * `parseTeam` in `#src/model/team.ts` maps these to the red/blue display
 * model; this schema deliberately keeps the wire value.
 */
export type RiotTeamId = z.infer<typeof RiotTeamIdSchema>;
export const RiotTeamIdSchema = z.union([z.literal(100), z.literal(200)]);

/** Why a ledger row exists. Three separate `earn_*` kinds rather than one
 * combined award, because "how did they get these points" is the requirement
 * and a single `+3` forces the reader to reconstruct which conditions fired. */
export type BucksLedgerKind = z.infer<typeof BucksLedgerKindSchema>;
export const BucksLedgerKindSchema = z.enum([
  "seed",
  "earn_game",
  "earn_win",
  "earn_mvp",
  "bet_stake",
  "bet_payout",
  "bet_refund",
  "adjustment",
]);

export type BucksBetOutcome = z.infer<typeof BucksBetOutcomeSchema>;
export const BucksBetOutcomeSchema = z.enum([
  "pending",
  "won",
  "lost",
  "refunded",
]);

export type BucksPoolState = z.infer<typeof BucksPoolStateSchema>;
export const BucksPoolStateSchema = z.enum([
  "open",
  "closed",
  "settled",
  "voided",
]);

/**
 * Why a pool paid nobody.
 *
 * `no_counterparty` is recorded rather than paying winners a payout that
 * happens to equal their stake: the two are numerically identical, but a
 * ledger should not have to be arithmetically decoded to be read.
 */
export type BucksVoidReason = z.infer<typeof BucksVoidReasonSchema>;
export const BucksVoidReasonSchema = z.enum([
  "remake",
  "no_counterparty",
  "expired",
  "unsupported_mode",
]);

/**
 * One participant as they appeared on the loading screen, frozen at pool
 * creation. This is what the bettor actually saw, so it is snapshotted rather
 * than re-derived at settlement: aliases are renameable and `Player` rows are
 * prunable.
 */
export type BucksPoolParticipant = z.infer<typeof BucksPoolParticipantSchema>;
export const BucksPoolParticipantSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  teamId: RiotTeamIdSchema,
  championName: z.string(),
  riotId: z.string().optional(),
  /** Set only for participants Scout tracks in this guild. */
  trackedAlias: z.string().optional(),
});

export type BucksPoolRoster = z.infer<typeof BucksPoolRosterSchema>;
export const BucksPoolRosterSchema = z.strictObject({
  participants: z.array(BucksPoolParticipantSchema).length(10),
});

/** Scout's heuristic call, serialized onto the pool for the post-match recap
 * and for later calibration scoring. */
export type BucksPrediction = z.infer<typeof BucksPredictionSchema>;
export const BucksPredictionSchema = z.strictObject({
  /** Probability that `subjectTeamId` wins. Clamped to [0.05, 0.95]. */
  winProbability: z.number().min(0).max(1),
  subjectTeamId: RiotTeamIdSchema,
  confidence: z.enum(["low", "medium", "high"]),
  sentence: z.string(),
  /** The top contributing terms, so the sentence explains itself. */
  drivers: z.array(z.string()),
});

const MvpContextSchema = z.strictObject({
  score: z.number(),
  runnersUp: z.array(
    z.strictObject({ puuid: LeaguePuuidSchema, score: z.number() }),
  ),
});

/**
 * The explanation frozen onto a ledger row.
 *
 * Discriminated on `type` so a row is self-describing without consulting its
 * `kind` column, and so adding a future entry shape cannot silently widen the
 * meaning of an existing one.
 */
export type BucksLedgerContext = z.infer<typeof BucksLedgerContextSchema>;
export const BucksLedgerContextSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("seed"),
    note: z.string(),
  }),
  z.strictObject({
    type: z.literal("earn"),
    alias: z.string(),
    puuid: LeaguePuuidSchema,
    championName: z.string(),
    teamPosition: z.string(),
    queueType: QueueTypeSchema,
    won: z.boolean(),
    mvp: MvpContextSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("stake"),
    subjectAlias: z.string(),
    subjectPuuid: LeaguePuuidSchema,
    /** Aliases on the side the bettor backed, and on the other side. */
    backedAliases: z.array(z.string()),
    opposingAliases: z.array(z.string()),
  }),
  z.strictObject({
    type: z.literal("settlement"),
    subjectAlias: z.string(),
    backedAliases: z.array(z.string()),
    opposingAliases: z.array(z.string()),
    winnersPool: z.number().int(),
    losersPool: z.number().int(),
    stakeReturned: z.number().int(),
    winnings: z.number().int(),
    voidReason: BucksVoidReasonSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("adjustment"),
    note: z.string(),
    actorDiscordId: z.string(),
  }),
]);

/** A `{ channelId, messageId }` pair for one guild's prematch message, so the
 * close sweep can edit exactly the right messages without re-deriving the
 * channel-to-guild mapping. */
export type BucksMessageRef = z.infer<typeof BucksMessageRefSchema>;
export const BucksMessageRefSchema = z.strictObject({
  channelId: z.string(),
  messageId: z.string(),
});

export type BucksMessageRefs = z.infer<typeof BucksMessageRefsSchema>;
export const BucksMessageRefsSchema = z.array(BucksMessageRefSchema);
