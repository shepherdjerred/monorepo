import { ServiceSchema } from "@shepherdjerred/ops-model/catalog.ts";
import { SeveritySchema } from "@shepherdjerred/ops-model/severity.ts";
import {
  ChangeEventSchema,
  LinkSchema,
  SignalSchema,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";

import { InstantTextSchema } from "#shared/time";

/** Consumers that keep a "last seen" cursor over snapshot signals. */
export const CursorConsumerSchema = z.enum(["web", "digest"]);
export type CursorConsumer = z.infer<typeof CursorConsumerSchema>;

/** Only the browser writes its cursor; the digest cursor is server-owned. */
export const CursorInputSchema = z.strictObject({
  consumer: z.literal("web"),
  seenSignalIds: z.array(z.string().min(1).max(512)).max(5000),
});
export type CursorInput = z.infer<typeof CursorInputSchema>;

export const CursorResponseSchema = z.object({
  consumer: CursorConsumerSchema,
  lastSeenAt: InstantTextSchema,
  seenCount: z.number().int().nonnegative(),
});
export type CursorResponse = z.infer<typeof CursorResponseSchema>;

export const SnapshotQuerySchema = z.object({
  consumer: CursorConsumerSchema.optional(),
});

/** A stored or ledger-derived change, as the timeline renders it. */
export const ChangeViewSchema = ChangeEventSchema.extend({
  id: z.string().min(1),
  severity: SeveritySchema,
});
export type ChangeView = z.infer<typeof ChangeViewSchema>;

export const ChangeListInputSchema = z.object({
  service: z.string().min(1).max(100).optional(),
  since: InstantTextSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ChangeListInput = z.infer<typeof ChangeListInputSchema>;

export const ChangeListResponseSchema = z.object({
  items: z.array(ChangeViewSchema),
});
export type ChangeListResponse = z.infer<typeof ChangeListResponseSchema>;

export const ServiceDetailSchema = z.object({
  service: ServiceSchema,
  /** `null` until the first snapshot has been ingested. */
  snapshotGeneratedAt: InstantTextSchema.nullable(),
  signals: z.array(SignalSchema),
  changes: z.array(ChangeViewSchema),
  links: z.array(LinkSchema),
});
export type ServiceDetail = z.infer<typeof ServiceDetailSchema>;

export const SERIES_PRESET_IDS = [
  "ai-cost-by-source",
  "ai-tokens-by-tool",
  "ai-quota",
  "cluster-llm-cost",
  "openai-project-cost",
  "prs-open",
  "prs-merged",
  "renovate-pending",
  "bugsink-unresolved",
  "linear-open",
  "alerts-firing",
  "node-cpu",
  "node-memory",
] as const;
export const SeriesPresetIdSchema = z.enum(SERIES_PRESET_IDS);
export type SeriesPresetId = z.infer<typeof SeriesPresetIdSchema>;

export const SERIES_RANGES = ["24h", "7d", "30d", "90d"] as const;
export const SeriesRangeSchema = z.enum(SERIES_RANGES);
export type SeriesRange = z.infer<typeof SeriesRangeSchema>;

export const SeriesUnitSchema = z.enum(["usd", "tokens", "ratio", "count"]);
export type SeriesUnit = z.infer<typeof SeriesUnitSchema>;

export const SeriesInputSchema = z.object({
  preset: SeriesPresetIdSchema,
  range: SeriesRangeSchema.default("7d"),
});
export type SeriesInput = z.infer<typeof SeriesInputSchema>;

export const SeriesResponseSchema = z.object({
  preset: SeriesPresetIdSchema,
  range: SeriesRangeSchema,
  title: z.string(),
  unit: SeriesUnitSchema,
  stepSeconds: z.number().int().positive(),
  start: z.number(),
  end: z.number(),
  series: z.array(
    z.object({
      name: z.string(),
      /** `[unix seconds, value]` pairs on the shared step grid. */
      points: z.array(z.tuple([z.number(), z.number()])),
    }),
  ),
});
export type SeriesResponse = z.infer<typeof SeriesResponseSchema>;

export const DigestKindSchema = z.enum(["daily", "weekly"]);
export type DigestKind = z.infer<typeof DigestKindSchema>;

export const TrendSchema = z.object({
  id: z.string(),
  label: z.string(),
  unit: SeriesUnitSchema.or(z.literal("hours")),
  current: z.number().nullable(),
  previous: z.number().nullable(),
  /** Whether a rising value is good news, for coloring the delta. */
  higherIsBetter: z.boolean(),
});
export type Trend = z.infer<typeof TrendSchema>;

export const IncidentStatsSchema = z.object({
  opened: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  medianMinutesToResolve: z.number().nullable(),
});
export type IncidentStats = z.infer<typeof IncidentStatsSchema>;

/**
 * Everything a digest says, independent of how it is rendered. The email and
 * the web Review page both render this model.
 */
export const DigestReportSchema = z.object({
  kind: DigestKindSchema,
  periodKey: z.string(),
  periodStart: InstantTextSchema,
  periodEnd: InstantTextSchema,
  status: z.object({
    severity: SeveritySchema,
    summary: z.string(),
    stale: z.boolean(),
    snapshotGeneratedAt: InstantTextSchema.nullable(),
  }),
  attention: z.array(SignalSchema),
  needsMe: z.array(SignalSchema),
  newSinceLast: z.array(SignalSchema),
  changes: z.array(ChangeViewSchema),
  incidents: IncidentStatsSchema,
  trends: z.array(TrendSchema),
});
export type DigestReport = z.infer<typeof DigestReportSchema>;

export const DigestRunResponseSchema = z.object({
  kind: DigestKindSchema,
  periodKey: z.string(),
  status: z.enum(["sent", "skipped"]),
  /** True when this period was already handled by an earlier request. */
  duplicate: z.boolean(),
});
export type DigestRunResponse = z.infer<typeof DigestRunResponseSchema>;

export const OpsErrorSchema = z.object({
  error: z.string(),
  code: z.enum([
    "snapshot_unavailable",
    "service_not_found",
    "digest_in_progress",
    "digest_mailer_unconfigured",
    "digest_send_failed",
    "upstream_unavailable",
  ]),
});
export type OpsError = z.infer<typeof OpsErrorSchema>;
