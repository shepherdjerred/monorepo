import { ServiceSchema } from "@shepherdjerred/ops-model/catalog.ts";
import { DigestKindSchema } from "@shepherdjerred/ops-model/digest.ts";
import {
  FACET_SCHEMAS,
  OpsFacetsSchema,
  type FacetByKey,
  type FacetKey,
} from "@shepherdjerred/ops-model/facets.ts";
import { SeveritySchema } from "@shepherdjerred/ops-model/severity.ts";
import {
  ChangeEventSchema,
  LinkSchema,
  SignalSchema,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";

import { InstantTextSchema, type InstantText } from "#shared/time";

/** Consumers that keep a "last seen" cursor over snapshot signals. */
export const CursorConsumerSchema = z.enum(["web", "digest"]);
export type CursorConsumer = z.infer<typeof CursorConsumerSchema>;

/** Only the browser writes its cursor; the digest cursor is server-owned. */
export const CursorInputSchema = z.strictObject({
  consumer: z.literal("web"),
  seenSignalIds: z.array(z.string().min(1).max(512)).max(5000),
});
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
  // Core / existing Hub 1.0 presets
  "ai-cost-by-source",
  "ai-tokens-by-tool",
  "ai-quota",
  "cluster-llm-cost",
  "provider-billed-cost",
  "prs-open",
  "prs-merged",
  "renovate-pending",
  "bugsink-unresolved",
  "tracker-open",
  "alerts-firing",
  "node-cpu",
  "node-memory",
  // Engineering / Renovate / CI
  "renovate-merges-7d",
  "pr-oldest-age",
  "github-rate-limit",
  "woodpecker-pipelines",
  "kueue-pending-workloads",
  "kueue-cpu-quota",
  "turbo-hit-ratio",
  "turbo-network-bps",
  "pr-code-review-assignments",
  "pr-code-review-outcomes",
  "delivery-active",
  "delivery-outcomes",
  "argocd-sync-status",
  "argocd-health-status",
  // Product / PostHog / Gaming / Media
  "posthog-pageviews-by-site",
  "posthog-dau-by-site",
  "posthog-lcp-p75",
  "scout-guilds",
  "scout-matches",
  "scout-riot-requests",
  "storm-players",
  "storm-brain-requests",
  "media-hdd-usage",
  "qbittorrent-throughput",
  "plex-watch-hours",
  "golink-redirects",
  // Bugs / Flags / Cloud / Edge / Storage
  "bugsink-events-by-project",
  "flags-evaluations",
  "cloudflare-r2-bytes",
  "cloudflare-probe-latency",
  "tailscale-devices-online",
  "tailscale-node-bps",
  "seaweedfs-volume-slots",
  "seaweedfs-s3-rps",
  "seaweedfs-backup-lag",
  "zpool-usage-ratio",
  "zpool-arc-hit-ratio",
  "nvme-writes-24h",
  "nvme-temp",
  "velero-backups",
  // Cluster / Observability / AI / Temporal
  "node-temp",
  "node-psi-cpu",
  "etcd-db-bytes",
  "prometheus-tsdb-series",
  "prometheus-tsdb-bytes",
  "loki-ingested-bps",
  "tempo-span-rate",
  "tempo-error-rate",
  "llm-token-cache-mix",
  "llm-p95-latency",
  "temporal-schedules-by-state",
  "mail-outbox",
  // Target-parameterized service/namespace presets
  "namespace-cpu",
  "namespace-memory",
  "namespace-restarts",
  "service-span-rate",
  "service-span-p95",
  "service-log-errors",
] as const;
export const SeriesPresetIdSchema = z.enum(SERIES_PRESET_IDS);
export type SeriesPresetId = z.infer<typeof SeriesPresetIdSchema>;

export const SERIES_RANGES = ["24h", "7d", "30d", "90d"] as const;
export const SeriesRangeSchema = z.enum(SERIES_RANGES);
export type SeriesRange = z.infer<typeof SeriesRangeSchema>;

export const SeriesUnitSchema = z.enum([
  "usd",
  "tokens",
  "ratio",
  "percent",
  "count",
  "bytes",
  "bps",
  "ms",
  "seconds",
  "hours",
  "celsius",
]);
export type SeriesUnit = z.infer<typeof SeriesUnitSchema>;

export const SeriesTargetSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][\w.|-]{0,120}$/u);

export const SeriesInputSchema = z.object({
  preset: SeriesPresetIdSchema,
  range: SeriesRangeSchema.default("7d"),
  target: SeriesTargetSchema.optional(),
});
export type SeriesInput = z.input<typeof SeriesInputSchema>;

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

const FACET_SCHEMA_BY_KEY: {
  readonly [K in FacetKey]: z.ZodType<FacetByKey[K]>;
} = FACET_SCHEMAS;

export function facetSchema<K extends FacetKey>(
  key: K,
): z.ZodType<FacetByKey[K]> {
  return FACET_SCHEMA_BY_KEY[key];
}

export const OpsFacetsResponseSchema = z.object({
  generatedAt: InstantTextSchema.nullable(),
  receivedAt: InstantTextSchema.nullable(),
  stale: z.boolean(),
  facets: OpsFacetsSchema,
});
export type OpsFacetsResponse = z.infer<typeof OpsFacetsResponseSchema>;

export function opsFacetResponseSchema<K extends FacetKey>(
  key: K,
): z.ZodType<OpsFacetResponse<K>> {
  return z
    .object({
      key: z.literal(key),
      generatedAt: InstantTextSchema.nullable(),
      receivedAt: InstantTextSchema.nullable(),
      stale: z.boolean(),
      data: z.unknown(),
    })
    .transform((envelope) => ({
      ...envelope,
      data:
        envelope.data === null ? null : facetSchema(key).parse(envelope.data),
    }));
}

export type OpsFacetResponse<K extends FacetKey = FacetKey> = {
  key: K;
  generatedAt: InstantText | null;
  receivedAt: InstantText | null;
  stale: boolean;
  data: FacetByKey[K] | null;
};

export const TrendSchema = z.object({
  id: z.string(),
  label: z.string(),
  unit: SeriesUnitSchema,
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
