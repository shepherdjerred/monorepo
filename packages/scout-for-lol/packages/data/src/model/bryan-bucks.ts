import { z } from "zod";
import { LeaguePuuidSchema } from "#src/model/league-account.ts";
import { QueueTypeSchema } from "#src/model/state.ts";

/**
 * Bryan Bucks — the friendly betting currency.
 *
 * They are a private joke with no monetary component and nothing transfers to
 * real goods.
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

/** Prisma's SQLite `Int` client boundary. The economy intentionally remains
 * on Int32 storage for this version even though the product no longer applies
 * a smaller stake cap. */
export const BUCKS_INT32_MAX = 2_147_483_647;

/** Any positive whole-BB stake that the existing storage domain can hold. */
export type BucksStake = z.infer<typeof BucksStakeSchema>;
export const BucksStakeSchema = z
  .number()
  .int()
  .positive()
  .max(BUCKS_INT32_MAX);

/** Why a ledger row exists. Separate `earn_*` and market movement kinds keep
 * the explanation auditable without reconstructing a combined total. */
export type BucksLedgerKind = z.infer<typeof BucksLedgerKindSchema>;
export const BucksLedgerKindSchema = z.enum([
  "seed",
  "earn_game",
  "earn_ranked_5s_bonus",
  "earn_clash_bonus",
  "earn_win",
  "earn_mvp",
  "bet_stake",
  "bet_payout",
  "bet_unmatched_refund",
  "bet_cancel_refund",
  "bet_void_refund",
  "winner_fee",
  "house_match",
  // Legacy kinds retained so historical rows remain parseable. `peek_pass`
  // belongs to the retired peek feature; nothing writes it any more.
  "bet_refund",
  "house_rake",
  "cancel_fee",
  "parlay_stake",
  "parlay_reserve",
  "parlay_payout",
  "parlay_refund",
  "parlay_release",
  "weekly_parlay_stake",
  "weekly_parlay_reserve",
  "weekly_parlay_payout",
  "weekly_parlay_refund",
  "weekly_parlay_release",
  "peek_pass",
  "transfer_sent",
  "transfer_received",
  "transfer_fee",
  "adjustment",
]);

export type BucksBetOutcome = z.infer<typeof BucksBetOutcomeSchema>;
export const BucksBetOutcomeSchema = z.enum([
  "pending",
  "won",
  "lost",
  "refunded",
  "cancelled",
]);

export type BucksPoolState = z.infer<typeof BucksPoolStateSchema>;
export const BucksPoolStateSchema = z.enum([
  "open",
  "closed",
  "settled",
  "voided",
]);

export type BucksParlaySide = z.infer<typeof BucksParlaySideSchema>;
export const BucksParlaySideSchema = z.enum(["YES", "NO"]);

export type BucksParlayMarketState = z.infer<
  typeof BucksParlayMarketStateSchema
>;
export const BucksParlayMarketStateSchema = z.enum([
  "publishing",
  "open",
  "closed",
  "settled",
  "voided",
]);

export type BucksParlayVoidReason = z.infer<typeof BucksParlayVoidReasonSchema>;
export const BucksParlayVoidReasonSchema = z.enum([
  "remake",
  "expired",
  "unsupported_mode",
  "missing_data",
  "unknown_evaluator",
  "invalid_definition",
  "storage_overflow",
]);

export type BucksWeeklyParlayMarketState = z.infer<
  typeof BucksWeeklyParlayMarketStateSchema
>;
export const BucksWeeklyParlayMarketStateSchema = z.enum([
  "publishing",
  "open",
  "active",
  "settled",
  "voided",
]);

export type BucksWeeklyParlayVoidReason = z.infer<
  typeof BucksWeeklyParlayVoidReasonSchema
>;
export const BucksWeeklyParlayVoidReasonSchema = z.enum([
  "infrastructure_failure",
  "insufficient_activity",
  "operator_cancelled",
  "unknown_evaluator",
  "invalid_definition",
  "missing_data",
  "storage_overflow",
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
  "house_unavailable",
  "expired",
  "unsupported_mode",
  "storage_overflow",
]);

/**
 * One participant as they appeared on the loading screen, frozen at pool
 * creation. This is what the bettor actually saw, so it is snapshotted rather
 * than re-derived at settlement: aliases are renameable and `Player` rows are
 * prunable.
 */
export type BucksPoolParticipant = z.infer<typeof BucksPoolParticipantSchema>;
export const BucksPoolParticipantSchema = z.strictObject({
  /**
   * Null for participants Riot scrubbed for privacy. Those players carry no
   * usable identity, so they can never be a bet's subject — but they still
   * occupy a slot on the loading screen the bettor saw, so the roster records
   * them rather than dropping them and misrepresenting the lobby.
   */
  puuid: LeaguePuuidSchema.nullable(),
  teamId: RiotTeamIdSchema,
  /** Riot champion ID. The spectator payload has no champion name, and this
   * snapshot is written before any Data Dragon lookup. */
  championId: z.number().int(),
  riotId: z.string().optional(),
  /** Set only for participants Scout tracks in this guild. */
  trackedAlias: z.string().optional(),
});

export type BucksPoolRoster = z.infer<typeof BucksPoolRosterSchema>;
export const BucksPoolRosterSchema = z.strictObject({
  participants: z.array(BucksPoolParticipantSchema).length(10),
});

/** Legacy unversioned prediction retained so old pool records still settle. */
export const BucksPredictionV1Schema = z.strictObject({
  /** Probability that `subjectTeamId` wins. Clamped to [0.05, 0.95]. */
  winProbability: z.number().min(0).max(1),
  subjectTeamId: RiotTeamIdSchema,
  confidence: z.enum(["low", "medium", "high"]),
  sentence: z.string(),
  /** The top contributing terms, so the sentence explains itself. */
  drivers: z.array(z.string()),
});
export type BucksPredictionV1 = z.infer<typeof BucksPredictionV1Schema>;

export const BucksPredictionQualitySchema = z.enum(["low", "medium", "high"]);
export type BucksPredictionQuality = z.infer<
  typeof BucksPredictionQualitySchema
>;

export const BucksPredictionCoverageSchema = z.strictObject({
  covered: z.number().int().nonnegative(),
  applicable: z.number().int().positive(),
});

/** Canonical team-relative prediction. Storing Blue's probability once makes
 * the same estimate reusable for every tracked player in the lobby. */
export const BucksPredictionV2Schema = z.strictObject({
  version: z.literal(2),
  blueWinProbability: z.number().min(0).max(1),
  dataQuality: BucksPredictionQualitySchema,
  coverage: BucksPredictionCoverageSchema,
  /** The top contributing terms, already phrased from Blue's perspective. */
  drivers: z.array(z.string()).max(2),
});
export type BucksPredictionV2 = z.infer<typeof BucksPredictionV2Schema>;

/** Scout's frozen heuristic call, serialized onto the pool. */
export type BucksPrediction = z.infer<typeof BucksPredictionSchema>;
export const BucksPredictionSchema = z.union([
  BucksPredictionV1Schema,
  BucksPredictionV2Schema,
]);

const PredictionFormSnapshotSchema = z.strictObject({
  wins: z.number().int().nonnegative(),
  games: z.number().int().nonnegative(),
});

export const BucksPredictionFeatureSchema = z.strictObject({
  puuid: LeaguePuuidSchema.nullable(),
  teamId: RiotTeamIdSchema,
  championId: z.number().int().nonnegative(),
  lane: z.string(),
  rankLeaguePoints: z.number().nullable(),
  seasonWins: z.number().int().nonnegative().nullable(),
  seasonLosses: z.number().int().nonnegative().nullable(),
  recentForm: PredictionFormSnapshotSchema,
  laneForm: PredictionFormSnapshotSchema,
  championForm: PredictionFormSnapshotSchema,
});
export type BucksPredictionFeature = z.infer<
  typeof BucksPredictionFeatureSchema
>;

/** Durable, point-in-time input/output record used to score v2 after the
 * corresponding Match-V5 result reaches the report lake. */
export const BucksPredictionObservationSchema = z.strictObject({
  version: z.literal(1),
  matchId: z.string(),
  platformId: z.string(),
  gameId: z.string(),
  queueType: QueueTypeSchema,
  observedAt: z.iso.datetime(),
  gameStartAt: z.iso.datetime(),
  prediction: BucksPredictionV2Schema,
  features: z.array(BucksPredictionFeatureSchema).length(10),
});
export type BucksPredictionObservation = z.infer<
  typeof BucksPredictionObservationSchema
>;

export const BUCKS_MATCHING_VERSION = 1;

const MatchingAmountFields = {
  submittedStake: z.number().int().positive(),
  humanMatchedStake: z.number().int().nonnegative(),
  houseMatchedStake: z.number().int().nonnegative(),
  matchedStake: z.number().int().nonnegative(),
  unmatchedStake: z.number().int().nonnegative(),
};

export type BucksMatchingAllocation = z.infer<
  typeof BucksMatchingAllocationSchema
>;
export const BucksMatchingAllocationSchema = z.strictObject({
  betId: z.number().int().positive(),
  bucksAccountId: z.number().int().positive(),
  predictedTeamId: RiotTeamIdSchema,
  ...MatchingAmountFields,
});

/** Complete, versioned close-time allocation for one guild's match pool. */
export type BucksMatchingSummary = z.infer<typeof BucksMatchingSummarySchema>;
export const BucksMatchingSummarySchema = z.strictObject({
  version: z.literal(BUCKS_MATCHING_VERSION),
  humanMatchedPerSide: z.number().int().nonnegative(),
  houseFill: z.number().int().nonnegative(),
  houseTeamId: RiotTeamIdSchema.nullable(),
  houseBetId: z.number().int().positive().nullable(),
  totalMatchedPerSide: z.number().int().nonnegative(),
  allocations: z.array(BucksMatchingAllocationSchema),
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
// Weekly v2 pricing uses a challenging 20–30% YES range. Keep the original
// 40–60% range readable for v1 ledger entries because ledger history is
// append-only and the context does not carry the weekly schema version.
export const BucksWeeklyParlayYesProbabilityBpsSchema = z.union([
  z.number().int().min(2000).max(3000),
  z.number().int().min(4000).max(6000),
]);
export const BucksLedgerContextSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("seed"),
    note: z.string(),
    /** Correlates the debit and credit for a house-funded welcome grant. */
    transferId: z.string().min(1).optional(),
    /** The account on the other side of this seed transfer. */
    counterpartyAccountId: z.number().int().positive().optional(),
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
    type: z.literal("earn_prematch"),
    alias: z.string(),
    puuid: LeaguePuuidSchema,
    championId: z.number().int(),
    teamId: RiotTeamIdSchema,
    queueType: QueueTypeSchema,
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
    /** Added with house cuts. Optional so historical ledger JSON remains
     * parseable under the current schema. */
    grossPayout: z.number().int().nonnegative().optional(),
    houseCut: z.number().int().nonnegative().optional(),
    netPayout: z.number().int().nonnegative().optional(),
    submittedStake: z.number().int().nonnegative().optional(),
    matchedStake: z.number().int().nonnegative().optional(),
    unmatchedStake: z.number().int().nonnegative().optional(),
    /** Gross payouts may be split around the fee transfer so every
     * intermediate wallet balance remains representable. */
    payoutComponent: z
      .enum(["gross", "principal", "profit", "refund"])
      .optional(),
    voidReason: BucksVoidReasonSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("matching"),
    source: z.enum(["unmatched_refund", "house_match"]),
    matchingVersion: z.literal(BUCKS_MATCHING_VERSION),
    subjectAlias: z.string(),
    subjectPuuid: LeaguePuuidSchema,
    backedAliases: z.array(z.string()),
    opposingAliases: z.array(z.string()),
    ...MatchingAmountFields,
  }),
  z.strictObject({
    type: z.literal("cancellation"),
    subjectAlias: z.string(),
    backedAliases: z.array(z.string()),
    opposingAliases: z.array(z.string()),
    submittedStake: z.number().int().positive(),
    fee: z.number().int().nonnegative(),
    netRefund: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("house_fee"),
    source: z.enum(["settlement", "cancellation"]),
    ratePercent: z.number().int().min(0).max(100),
    grossAmount: z.number().int().positive(),
    fee: z.number().int().positive(),
    basis: z.enum(["matched_profit", "submitted_stake"]).optional(),
  }),
  z.strictObject({
    type: z.literal("parlay_stake"),
    side: BucksParlaySideSchema,
    yesProbabilityBps: z.number().int().min(1000).max(9000),
    totalStake: BucksStakeSchema,
    quotedGrossPayout: BucksStakeSchema,
  }),
  z.strictObject({
    type: z.literal("parlay_reserve"),
    side: BucksParlaySideSchema,
    yesProbabilityBps: z.number().int().min(1000).max(9000),
    totalStake: BucksStakeSchema,
    totalReserve: z.number().int().nonnegative().max(BUCKS_INT32_MAX),
    quotedGrossPayout: BucksStakeSchema,
  }),
  z.strictObject({
    type: z.literal("parlay_settlement"),
    side: BucksParlaySideSchema,
    yesResult: z.boolean().optional(),
    stake: BucksStakeSchema,
    reserve: z.number().int().nonnegative().max(BUCKS_INT32_MAX),
    grossPayout: BucksStakeSchema,
    credited: z.number().int().nonnegative().max(BUCKS_INT32_MAX),
    voidReason: BucksParlayVoidReasonSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("weekly_parlay_stake"),
    version: z.literal(1),
    definitionId: z.number().int().positive(),
    periodKey: z.iso.date(),
    slot: z.number().int().nonnegative(),
    side: BucksParlaySideSchema,
    yesProbabilityBps: BucksWeeklyParlayYesProbabilityBpsSchema,
    totalStake: BucksStakeSchema,
    quotedGrossPayout: BucksStakeSchema,
  }),
  z.strictObject({
    type: z.literal("weekly_parlay_reserve"),
    version: z.literal(1),
    definitionId: z.number().int().positive(),
    periodKey: z.iso.date(),
    slot: z.number().int().nonnegative(),
    side: BucksParlaySideSchema,
    yesProbabilityBps: BucksWeeklyParlayYesProbabilityBpsSchema,
    totalStake: BucksStakeSchema,
    totalReserve: z.number().int().nonnegative().max(BUCKS_INT32_MAX),
    quotedGrossPayout: BucksStakeSchema,
  }),
  z.strictObject({
    type: z.literal("weekly_parlay_settlement"),
    version: z.literal(1),
    definitionId: z.number().int().positive(),
    periodKey: z.iso.date(),
    slot: z.number().int().nonnegative(),
    side: BucksParlaySideSchema,
    yesResult: z.boolean().optional(),
    stake: BucksStakeSchema,
    reserve: z.number().int().nonnegative().max(BUCKS_INT32_MAX),
    grossPayout: BucksStakeSchema,
    credited: z.number().int().nonnegative().max(BUCKS_INT32_MAX),
    voidReason: BucksWeeklyParlayVoidReasonSchema.optional(),
  }),
  // Retired peek feature; the shape survives so historical rows still parse.
  z.strictObject({
    type: z.literal("peek_pass"),
    purchaserDiscordId: z.string(),
    price: z.number().int().positive(),
    balanceBefore: z.number().int().nonnegative(),
    weightedAgeWeeks: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal("transfer"),
    transferId: z.uuid(),
    senderAccountId: z.number().int().positive(),
    recipientAccountId: z.number().int().positive(),
    houseAccountId: z.number().int().positive(),
    totalAmount: BucksStakeSchema,
    recipientAmount: BucksStakeSchema,
    feeAmount: BucksStakeSchema,
    role: z.enum(["sender", "recipient", "house"]),
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

/**
 * One row of the persisted weekly leaderboard snapshot — the standings exactly
 * as the Friday 5 PM PT Discord post disclosed them. The web leaderboard reads
 * only this stored JSON, never live balances, so the deliberate
 * no-on-demand-leaderboard rule survives a second surface.
 */
export type BucksWeeklyLeaderboardEntry = z.infer<
  typeof BucksWeeklyLeaderboardEntrySchema
>;
export const BucksWeeklyLeaderboardEntrySchema = z.strictObject({
  rank: z.number().int().positive(),
  discordId: z.string(),
  balance: z.number().int(),
});

export type BucksWeeklyLeaderboardEntries = z.infer<
  typeof BucksWeeklyLeaderboardEntriesSchema
>;
export const BucksWeeklyLeaderboardEntriesSchema = z.array(
  BucksWeeklyLeaderboardEntrySchema,
);
