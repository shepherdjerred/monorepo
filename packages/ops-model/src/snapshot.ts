import { z } from "zod";
import { SeveritySchema } from "./severity.ts";

export const OPS_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Every upstream the snapshot collector reads. A source is the unit of
 * failure isolation and freshness: one source failing marks only the signals
 * and sections it feeds as `unknown`.
 */
export const SOURCE_IDS = [
  "alerts",
  "kubernetes",
  "argocd",
  "talos",
  "ci",
  "github",
  "renovate",
  "linear",
  "bugsink",
  "posthog",
  "probes",
  "logs",
  "traces",
  "maintenance",
  "ai",
] as const;

export const SourceIdSchema = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof SourceIdSchema>;

/**
 * Snapshot sections, one per operational question. The order here is the
 * rendering order for every consumer.
 */
export const SECTION_IDS = [
  "alerts",
  "platform",
  "delivery",
  "work",
  "errors",
  "product",
  "ai",
  "maintenance",
  "observability",
] as const;

export const SectionIdSchema = z.enum(SECTION_IDS);
export type SectionId = z.infer<typeof SectionIdSchema>;

export const LINK_KINDS = [
  "native",
  "grafana",
  "logs",
  "traces",
  "metrics",
  "argocd",
  "github",
  "linear",
  "bugsink",
  "posthog",
  "buildkite",
] as const;

export const LinkSchema = z.strictObject({
  kind: z.enum(LINK_KINDS),
  label: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
});
export type Link = z.infer<typeof LinkSchema>;

const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * One observed fact that might deserve attention: a firing alert, an
 * out-of-sync app, an open PR, a pending Renovate update, a quota window.
 */
export const SignalSchema = z.strictObject({
  /** Stable across snapshots so consumers can compute "new since last look". */
  id: z.string().min(1),
  source: SourceIdSchema,
  section: SectionIdSchema,
  /** Service catalog id, when the signal belongs to one service. */
  service: z.string().min(1).optional(),
  /** Source-specific kind, e.g. `pull-request`, `argo-app`, `quota-window`. */
  kind: z.string().min(1),
  severity: SeveritySchema,
  /** True when the next action belongs to Jerred rather than a machine. */
  needsMe: z.boolean(),
  title: z.string().min(1),
  detail: z.string().optional(),
  /** When the underlying condition started (alert start, PR open, ...). */
  since: z.iso.datetime().optional(),
  attributes: z.record(z.string(), AttributeValueSchema).default({}),
  links: z.array(LinkSchema).default([]),
});
export type Signal = z.infer<typeof SignalSchema>;
export type SignalInput = z.input<typeof SignalSchema>;

export const METRIC_UNITS = [
  "count",
  "usd",
  "ratio",
  "percent",
  "seconds",
  "hours",
  "tokens",
] as const;

/** A headline number shown on tiles, TRMNL, and digests. */
export const MetricSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  /** `null` means the source answered but has no value (not a failure). */
  value: z.number().nullable(),
  unit: z.enum(METRIC_UNITS),
  severity: SeveritySchema,
  source: SourceIdSchema,
});
export type Metric = z.infer<typeof MetricSchema>;

export const SectionSchema = z.strictObject({
  id: SectionIdSchema,
  title: z.string().min(1),
  /** Rolled up from signals, metrics, and freshness of `sources`. */
  severity: SeveritySchema,
  summary: z.string(),
  sources: z.array(SourceIdSchema).min(1),
  metrics: z.array(MetricSchema),
  signals: z.array(SignalSchema),
});
export type Section = z.infer<typeof SectionSchema>;

export const SourceStatusSchema = z.strictObject({
  source: SourceIdSchema,
  ok: z.boolean(),
  /** When this collection attempt finished. */
  observedAt: z.iso.datetime(),
  /** Last successful collection, possibly from an earlier snapshot. */
  lastSuccessAt: z.iso.datetime().optional(),
  durationMs: z.number().nonnegative(),
  /** Redacted, human-readable failure reason. Never a raw upstream body. */
  error: z.string().optional(),
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SnapshotSchema = z.strictObject({
  schemaVersion: z.literal(OPS_SNAPSHOT_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  severity: SeveritySchema,
  summary: z.string(),
  sources: z.array(SourceStatusSchema),
  sections: z.array(SectionSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const CHANGE_KINDS = [
  "deploy",
  "sync",
  "merge",
  "image-bump",
  "release",
  "alert-open",
  "alert-resolve",
] as const;

/** A discrete "what changed" event for the triage timeline and review. */
export const ChangeEventSchema = z.strictObject({
  source: SourceIdSchema,
  /** Upstream identity; `(source, externalId)` is the dedupe key. */
  externalId: z.string().min(1),
  kind: z.enum(CHANGE_KINDS),
  service: z.string().min(1).optional(),
  title: z.string().min(1),
  occurredAt: z.iso.datetime(),
  severity: SeveritySchema.default("info"),
  url: z.url({ protocol: /^https?$/ }).optional(),
});
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;
export type ChangeEventInput = z.input<typeof ChangeEventSchema>;

/** Body of `POST /internal/v1/ops/snapshots`. */
export const OpsIngestSchema = z.strictObject({
  snapshot: SnapshotSchema,
  changes: z.array(ChangeEventSchema),
});
export type OpsIngest = z.infer<typeof OpsIngestSchema>;

export function parseSnapshot(value: unknown): Snapshot {
  return SnapshotSchema.parse(value);
}

export function parseOpsIngest(value: unknown): OpsIngest {
  return OpsIngestSchema.parse(value);
}
