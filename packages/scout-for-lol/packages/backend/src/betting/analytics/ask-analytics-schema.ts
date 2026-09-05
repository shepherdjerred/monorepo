import { z } from "zod";
import {
  BucksBetOutcomeSchema,
  DiscordAccountIdSchema,
} from "@scout-for-lol/data";

const SortDirectionSchema = z.enum(["asc", "desc"]);
const DateFiltersSchema = z.strictObject({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const BucksAccountMeasureSchema = z.enum([
  "balance_bb",
  "account_count",
]);
export const BucksAccountQuerySchema = z.strictObject({
  measures: z.array(BucksAccountMeasureSchema).min(1).max(2),
});

export const BucksLedgerMeasureSchema = z.enum([
  "delta_bb",
  "entry_count",
  "bettor_count",
  "match_count",
]);
export const BucksAskLedgerKindSchema = z.enum([
  "seed",
  "earn_game",
  "earn_ranked_5s_bonus",
  "earn_clash_bonus",
  "earn_win",
  "earn_mvp",
  "adjustment",
]);
export const BucksLedgerDimensionSchema = z.enum(["ledger_kind", "day"]);
export const BucksLedgerQuerySchema = z.strictObject({
  measures: z.array(BucksLedgerMeasureSchema).min(1).max(4),
  groupBy: z.array(BucksLedgerDimensionSchema).max(2).optional(),
  filters: DateFiltersSchema.extend({
    kinds: z.array(BucksAskLedgerKindSchema).min(1).max(7),
  }).strict(),
  sort: z
    .strictObject({
      measure: BucksLedgerMeasureSchema,
      direction: SortDirectionSchema,
    })
    .optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export const BucksBetPositionTypeSchema = z.enum(["outcome", "parlay"]);
export const BucksAskBetOutcomeSchema = BucksBetOutcomeSchema.exclude([
  "cancelled",
]);
export type BucksAskBetOutcome = z.infer<typeof BucksAskBetOutcomeSchema>;
export const BucksSubjectResultSchema = z.enum([
  "won",
  "lost",
  "unresolved",
  "not_applicable",
]);
export const BucksBetDirectionSchema = z.enum(["for", "against", "yes", "no"]);
export const BucksBetMeasureSchema = z.enum([
  "net_bb",
  "staked_bb",
  "gross_payout_bb",
  "position_count",
  "bettor_count",
  "market_count",
  "settled_position_count",
  "refunded_position_count",
  "pending_position_count",
  "win_rate_percent",
  "roi_percent",
]);
export const BucksBetDimensionSchema = z.enum([
  "position_type",
  "bettor",
  "subject",
  "subject_result",
  "bet_direction",
  "outcome",
  "day",
]);
export const BucksBetQuerySchema = z.strictObject({
  measures: z.array(BucksBetMeasureSchema).min(1).max(4),
  groupBy: z.array(BucksBetDimensionSchema).max(2).optional(),
  filters: DateFiltersSchema.extend({
    positionTypes: z.array(BucksBetPositionTypeSchema).max(2).optional(),
    bettorDiscordIds: z.array(DiscordAccountIdSchema).max(10).optional(),
    subjectAliases: z
      .array(z.string().trim().min(1).max(64))
      .max(10)
      .describe(
        "Tracked-player aliases. This alone selects every bet framed around those players; do not infer an outcome, subject result, or for/against direction from wording such as 'betting on X'.",
      )
      .optional(),
    subjectResults: z
      .array(BucksSubjectResultSchema)
      .max(4)
      .describe(
        "Whether the subject player's frozen-roster team won or lost. Use only when the question explicitly asks about the player's result.",
      )
      .optional(),
    betDirections: z
      .array(BucksBetDirectionSchema)
      .max(4)
      .describe(
        "For outcome positions, whether bettors backed the subject player's team (for) or the opposing team (against). For parlays, the YES or NO side. Use only when the question explicitly requests a direction or side.",
      )
      .optional(),
    outcomes: z
      .array(BucksAskBetOutcomeSchema)
      .max(4)
      .describe(
        "The bettor position outcome. A request for who lost the most BB means negative net_bb, not necessarily an outcome filter.",
      )
      .optional(),
  })
    .strict()
    .optional(),
  sort: z
    .strictObject({
      measure: BucksBetMeasureSchema,
      direction: SortDirectionSchema,
    })
    .optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export type BucksAccountQuery = z.infer<typeof BucksAccountQuerySchema>;
export type BucksLedgerQuery = z.infer<typeof BucksLedgerQuerySchema>;
export type BucksBetQuery = z.infer<typeof BucksBetQuerySchema>;
export type BucksSubjectResult = z.infer<typeof BucksSubjectResultSchema>;
export type BucksBetDirection = z.infer<typeof BucksBetDirectionSchema>;

export const BucksAskDimensionValueSchema = z.strictObject({
  name: z.string(),
  value: z.string(),
});
export const BucksAskMetricValueSchema = z.strictObject({
  name: z.string(),
  value: z.number().nullable(),
});
export const BucksAskResultRowSchema = z.strictObject({
  dimensions: z.array(BucksAskDimensionValueSchema).max(2),
  metrics: z.array(BucksAskMetricValueSchema).max(4),
});

const ResultCoverageSchema = z.strictObject({
  matchedRecords: z.number().int().min(0),
  returnedRows: z.number().int().min(0).max(10),
  totalGroups: z.number().int().min(0),
  truncated: z.boolean(),
  earliestAt: z.iso.datetime().nullable(),
  latestAt: z.iso.datetime().nullable(),
});

export const BucksAccountQueryResultSchema = z.strictObject({
  rows: z.array(BucksAskResultRowSchema).max(10),
  coverage: ResultCoverageSchema,
});
export const BucksLedgerQueryResultSchema = z.strictObject({
  rows: z.array(BucksAskResultRowSchema).max(10),
  coverage: ResultCoverageSchema,
});
export const BucksBetQueryResultSchema = z.strictObject({
  rows: z.array(BucksAskResultRowSchema).max(10),
  coverage: ResultCoverageSchema.extend({
    financialPositions: z.number().int().min(0),
    refundedPositions: z.number().int().min(0),
    pendingPositions: z.number().int().min(0),
  }).strict(),
  unknownSubjectAliases: z.array(z.string()).max(10),
  ambiguousSubjectAliases: z.array(z.string()).max(10),
  availableSubjectAliases: z.array(z.string()).max(100),
});

export const BucksAskDatasetOverviewSchema = z.strictObject({
  accountCount: z.number().int().min(0),
  ledgerEntryCount: z.number().int().min(0),
  positionCount: z.number().int().min(0),
  marketCount: z.number().int().min(0),
  settledPositionCount: z.number().int().min(0),
  refundedPositionCount: z.number().int().min(0),
  pendingPositionCount: z.number().int().min(0),
  earliestAt: z.iso.datetime().nullable(),
  latestAt: z.iso.datetime().nullable(),
  availableSubjectAliases: z.array(z.string()).max(100),
  totalSubjectCount: z.number().int().min(0),
  notes: z.array(z.string()),
});

export type BucksAskResultRow = z.infer<typeof BucksAskResultRowSchema>;
