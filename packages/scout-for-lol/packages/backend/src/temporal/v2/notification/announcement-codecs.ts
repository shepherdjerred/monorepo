import { z } from "zod";
import {
  BucksAmountSchema,
  BucksDareHorizonKindSchema,
  BucksParlaySideSchema,
  BucksParlayVoidReasonSchema,
  BucksPoolTotalSchema,
  BucksStakeSchema,
  BucksVoidReasonSchema,
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import { UndeliverableContentError } from "#src/temporal/v2/notification/undeliverable-content.ts";
import type {
  EarnedAward,
  EarnedAwardReason,
} from "#src/betting/accounts/earnings.ts";
import type {
  DareContributorRefund,
  DareTargetPayout,
} from "#src/betting/dares/settlement/dare-ledger.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settlement-types.ts";
import type { SettlementAnnouncementInput } from "#src/betting/notify/announce-prepare.ts";
import { ParlayLegResultSchema } from "#src/betting/parlays/parlay-evaluator.ts";
import type {
  ParlaySettlementBet,
  ParlaySettlementSummary,
} from "#src/betting/parlays/runtime/parlay-settlement-types.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";
import type { SettlementBet } from "#src/betting/settlement/settlement-types.ts";

/**
 * The wire shape of what a `settlement` or `dare-summary` intent announces.
 *
 * The intent row carries these as an opaque versioned envelope (the domain
 * must not mirror the betting slice's types), and this module is the one
 * place that envelope is given a shape: the minter serializes through these
 * codecs and the delivery arm parses through them, so the two cannot drift
 * apart without one of them failing to parse.
 *
 * ## Why the intent carries presentation inputs rather than identities
 *
 * The settlement receipt names what settlement moved — bet ids, Dare ids,
 * parlay guilds, earners — and deliberately no amount. v1's announcement
 * (`buildSettlementMessage`, `dareResultMessage`) is built from the summaries
 * settlement PRODUCED: per-bet payouts, pool totals, the void reason, each
 * parlay leg's rendered condition, each Dare payout and refund. Rebuilding
 * those from ledger rows by id would be a second implementation of settlement
 * arithmetic, which is exactly the thing that must exist once. So the intent
 * carries the summaries themselves, as settlement handed them to v1, and the
 * arm renders through v1's own builders without deriving a single fact.
 *
 * Every member schema is `satisfies`-checked against the v1 type it mirrors:
 * a field added to a v1 summary fails this module's typecheck, and a field
 * this module invents fails the strict parse of a real summary. The two outer
 * mappers below are written field by field for the same reason.
 */

const EarnedAwardReasonSchema = z.enum([
  "played",
  "ranked 5s bonus",
  "clash bonus",
  "win",
  "mvp",
]) satisfies z.ZodType<EarnedAwardReason>;

export const EarnedAwardSchema = z.strictObject({
  serverId: z.string().min(1),
  discordId: z.string().min(1),
  alias: z.string(),
  reasons: z.array(EarnedAwardReasonSchema),
  total: z.number().int(),
}) satisfies z.ZodType<EarnedAward>;

const SettlementBetSchema = z.strictObject({
  betId: z.number().int(),
  bucksAccountId: z.number().int(),
  discordId: DiscordAccountIdSchema,
  isHouse: z.boolean(),
  predictedTeamId: z.number().int(),
  submittedStake: BucksStakeSchema,
  matchedStake: BucksAmountSchema,
  unmatchedStake: BucksAmountSchema,
  grossPayout: BucksAmountSchema,
  houseCut: BucksAmountSchema,
  payout: BucksAmountSchema,
  winnings: BucksAmountSchema,
  won: z.boolean(),
  refunded: z.boolean(),
  subjectPuuid: LeaguePuuidSchema,
}) satisfies z.ZodType<SettlementBet>;

export const SettlementSummarySchema = z.strictObject({
  matchId: z.string().min(1),
  serverId: z.string().min(1),
  winningTeamId: z.number().int().optional(),
  voidReason: BucksVoidReasonSchema.optional(),
  winnersPool: BucksPoolTotalSchema,
  losersPool: BucksPoolTotalSchema,
  houseCut: BucksPoolTotalSchema,
  bets: z.array(SettlementBetSchema),
});

const ParlaySettlementBetSchema = z.strictObject({
  discordId: z.string().min(1),
  side: BucksParlaySideSchema,
  stake: z.number().int(),
  grossPayout: z.number().int(),
  payout: z.number().int(),
  outcome: z.enum(["won", "lost", "refunded"]),
}) satisfies z.ZodType<ParlaySettlementBet>;

const MessageRefSchema = z.strictObject({
  channelId: z.string().min(1),
  messageId: z.string().min(1),
});

export const ParlaySettlementSummarySchema = z.strictObject({
  matchId: z.string().min(1),
  serverId: z.string().min(1),
  yesResult: z.boolean().optional(),
  voidReason: BucksParlayVoidReasonSchema.optional(),
  legs: z.array(ParlayLegResultSchema),
  messageRefs: z.array(MessageRefSchema),
  bets: z.array(ParlaySettlementBetSchema),
});

export type SettlementAnnouncement = z.infer<
  typeof SettlementAnnouncementSchema
>;
export const SettlementAnnouncementSchema = z.strictObject({
  summary: SettlementSummarySchema,
  includeOutcome: z.boolean(),
  parlay: ParlaySettlementSummarySchema.optional(),
  /** This guild's earnings only; the arm never sees another guild's. */
  earnings: z.array(EarnedAwardSchema),
});

export const settlementAnnouncementCodec = defineVersionedCodec({
  kind: "scout-settlement-announcement",
  version: 1,
  schema: SettlementAnnouncementSchema,
});

export function settlementSummaryOf(
  parsed: SettlementAnnouncement["summary"],
): SettlementSummary {
  return {
    matchId: parsed.matchId,
    serverId: parsed.serverId,
    winningTeamId: parsed.winningTeamId,
    voidReason: parsed.voidReason,
    winnersPool: parsed.winnersPool,
    losersPool: parsed.losersPool,
    houseCut: parsed.houseCut,
    bets: parsed.bets,
  };
}

export function parlaySummaryOf(
  parsed: NonNullable<SettlementAnnouncement["parlay"]>,
): ParlaySettlementSummary {
  return {
    matchId: parsed.matchId,
    serverId: parsed.serverId,
    yesResult: parsed.yesResult,
    voidReason: parsed.voidReason,
    legs: parsed.legs,
    messageRefs: parsed.messageRefs,
    bets: parsed.bets,
  };
}

/** The parsed announcement in the shape v1's preparation takes. */
export function settlementAnnouncementInputOf(
  parsed: SettlementAnnouncement,
): SettlementAnnouncementInput {
  return {
    summary: settlementSummaryOf(parsed.summary),
    includeOutcome: parsed.includeOutcome,
    parlay:
      parsed.parlay === undefined ? undefined : parlaySummaryOf(parsed.parlay),
    earnings: parsed.earnings,
  };
}

/**
 * What a minter puts on a `settlement` intent: v1's announcement inputs,
 * serialized through this codec. `earnings` must already be this guild's.
 */
export function settlementAnnouncementEnvelope(
  input: SettlementAnnouncementInput,
) {
  return settlementAnnouncementCodec.serialize({
    summary: {
      matchId: input.summary.matchId,
      serverId: input.summary.serverId,
      ...(input.summary.winningTeamId === undefined
        ? {}
        : { winningTeamId: input.summary.winningTeamId }),
      ...(input.summary.voidReason === undefined
        ? {}
        : { voidReason: input.summary.voidReason }),
      winnersPool: input.summary.winnersPool,
      losersPool: input.summary.losersPool,
      houseCut: input.summary.houseCut,
      bets: input.summary.bets,
    },
    includeOutcome: input.includeOutcome,
    ...(input.parlay === undefined
      ? {}
      : {
          parlay: {
            matchId: input.parlay.matchId,
            serverId: input.parlay.serverId,
            ...(input.parlay.yesResult === undefined
              ? {}
              : { yesResult: input.parlay.yesResult }),
            ...(input.parlay.voidReason === undefined
              ? {}
              : { voidReason: input.parlay.voidReason }),
            legs: input.parlay.legs,
            messageRefs: input.parlay.messageRefs,
            bets: input.parlay.bets,
          },
        }),
    earnings: [...input.earnings],
  });
}

const DareTargetPayoutSchema = z.strictObject({
  bucksAccountId: z.number().int(),
  discordId: z.string().min(1),
  alias: z.string(),
  grossShare: BucksAmountSchema,
  fee: BucksAmountSchema,
  net: BucksAmountSchema,
}) satisfies z.ZodType<DareTargetPayout>;

const DareContributorRefundSchema = z.strictObject({
  bucksAccountId: z.number().int(),
  discordId: z.string().min(1),
  contributed: BucksAmountSchema,
  fee: BucksAmountSchema,
  refunded: BucksAmountSchema,
}) satisfies z.ZodType<DareContributorRefund>;

const DareResolutionSchema = z.enum([
  "captured",
  "achieved",
  "unachieved",
  "voided",
  "expired",
  "abandoned",
]) satisfies z.ZodType<DareSettlementSummary["resolution"]>;

export type DareSummaryAnnouncement = z.infer<
  typeof DareSummaryAnnouncementSchema
>;
export const DareSummaryAnnouncementSchema = z.strictObject({
  dareId: z.number().int(),
  serverId: z.string().min(1),
  channelId: z.string().min(1),
  messageRef: z.string().nullable(),
  matchId: z.string().optional(),
  resolution: DareResolutionSchema,
  horizonKind: BucksDareHorizonKindSchema,
  challengerDiscordId: z.string().min(1),
  targetAliases: z.array(z.string()),
  conditionSummary: z.string(),
  potTotal: z.number().int(),
  payouts: z.array(DareTargetPayoutSchema),
  refunds: z.array(DareContributorRefundSchema),
  voidReason: z.string().optional(),
  leafCounts: z.array(z.number().int()).optional(),
});

export const dareSummaryAnnouncementCodec = defineVersionedCodec({
  kind: "scout-dare-summary-announcement",
  version: 1,
  schema: DareSummaryAnnouncementSchema,
});

/** The parsed announcement in the shape v1's copy builder takes. */
export function dareSettlementSummaryOf(
  parsed: DareSummaryAnnouncement,
): DareSettlementSummary {
  return {
    dareId: parsed.dareId,
    serverId: parsed.serverId,
    channelId: parsed.channelId,
    messageRef: parsed.messageRef,
    matchId: parsed.matchId,
    resolution: parsed.resolution,
    horizonKind: parsed.horizonKind,
    challengerDiscordId: parsed.challengerDiscordId,
    targetAliases: parsed.targetAliases,
    conditionSummary: parsed.conditionSummary,
    potTotal: parsed.potTotal,
    payouts: parsed.payouts,
    refunds: parsed.refunds,
    voidReason: parsed.voidReason,
    leafCounts: parsed.leafCounts,
  };
}

/** What a minter puts on a `dare-summary` intent: the summary, serialized. */
export function dareSummaryAnnouncementEnvelope(
  summary: DareSettlementSummary,
) {
  return dareSummaryAnnouncementCodec.serialize({
    dareId: summary.dareId,
    serverId: summary.serverId,
    channelId: summary.channelId,
    messageRef: summary.messageRef,
    ...(summary.matchId === undefined ? {} : { matchId: summary.matchId }),
    resolution: summary.resolution,
    horizonKind: summary.horizonKind,
    challengerDiscordId: summary.challengerDiscordId,
    targetAliases: summary.targetAliases,
    conditionSummary: summary.conditionSummary,
    potTotal: summary.potTotal,
    payouts: summary.payouts,
    refunds: summary.refunds,
    ...(summary.voidReason === undefined
      ? {}
      : { voidReason: summary.voidReason }),
    ...(summary.leafCounts === undefined
      ? {}
      : { leafCounts: summary.leafCounts }),
  });
}

/**
 * The announcement payload this intent carries cannot produce its message.
 *
 * The same class of defect as a malformed render receipt, on the other kind of
 * persisted evidence: an announcement-kind intent minted with no payload, one
 * whose envelope fails its codec, or one describing a resolution that has no
 * message to send. All three are fixed at mint and re-read identically
 * forever, so the delivery parks the intent instead of asking reconciliation
 * to re-drive it every sweep.
 */
export class MalformedAnnouncementIntentError extends UndeliverableContentError {
  readonly intentKey: string;

  constructor(args: { intentKey: string; detail: string }) {
    super(
      `The announcement payload on intent ${args.intentKey} cannot produce a message: ${args.detail}`,
    );
    this.name = "MalformedAnnouncementIntentError";
    this.intentKey = args.intentKey;
  }
}
