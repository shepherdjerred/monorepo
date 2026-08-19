import { z } from "zod";
import { FleetSnapshotSchema } from "./schemas.ts";

export const RUN_BUNDLE_SCHEMA_VERSION = 2;
export const GENESIS_EVENT_HASH = "0".repeat(64);

export const RunEventKindSchema = z.enum([
  "run.started",
  "run.completed",
  "run.failed",
  "controller.initialized",
  "operator.input",
  "operator.question.asked",
  "operator.question.answered",
  "operator.question.superseded",
  "tick.started",
  "tick.queued",
  "tick.completed",
  "tick.failed",
  "fleet.snapshot",
  "fleet.change",
  "master.text",
  "master.turn.started",
  "master.turn.completed",
  "master.turn.failed",
  "worker.started",
  "worker.attempt.started",
  "worker.attempt.completed",
  "worker.attempt.failed",
  "worker.completed",
  "worker.cancelled",
  "worker.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "command.started",
  "command.completed",
  "command.failed",
  "lease.granted",
  "lease.denied",
  "lease.released",
  "setup.required",
  "setup.started",
  "setup.completed",
  "setup.failed",
  "publication.stage",
  "worktree.head.transition",
  "environment.result",
  "environment.failed",
  "shutdown.started",
  "shutdown.completed",
  "shutdown.failed",
]);

export const RunEventCorrelationSchema = z.object({
  traceId: z.string().optional(),
  causationId: z.string().optional(),
  tickId: z.string().optional(),
  prNumber: z.number().int().positive().optional(),
  headSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  generation: z.number().int().nonnegative().optional(),
  modelTurnId: z.string().optional(),
  toolCallId: z.string().optional(),
  commandId: z.string().optional(),
});

export const JsonValueSchema = z.json();
export const RunEventPayloadSchema = z.record(z.string(), JsonValueSchema);

const UnsignedRunEventBaseSchema = z.object({
  runId: z.string().min(1),
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime(),
  previousHash: z.string().regex(/^[0-9a-f]{64}$/),
  kind: RunEventKindSchema,
  correlation: RunEventCorrelationSchema,
  payload: RunEventPayloadSchema,
});

export const UnsignedRunEventV1Schema = UnsignedRunEventBaseSchema.extend({
  schemaVersion: z.literal(1),
});
export const UnsignedRunEventV2Schema = UnsignedRunEventBaseSchema.extend({
  schemaVersion: z.literal(2),
});
export const UnsignedRunEventSchema = z.discriminatedUnion("schemaVersion", [
  UnsignedRunEventV1Schema,
  UnsignedRunEventV2Schema,
]);
export const RecordedRunEventV1Schema = UnsignedRunEventV1Schema.extend({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const RecordedRunEventV2Schema = UnsignedRunEventV2Schema.extend({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const RecordedRunEventSchema = z.discriminatedUnion("schemaVersion", [
  RecordedRunEventV1Schema,
  RecordedRunEventV2Schema,
]);

const RunManifestBaseSchema = z.object({
  runId: z.string().min(1),
  createdAt: z.iso.datetime(),
  controllerVersion: z.string().min(1),
  controllerCommit: z.string().regex(/^[0-9a-f]{40}$/),
  controllerSourceDirty: z.boolean(),
  controllerSourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  controllerSourceResolved: z.boolean().default(true),
  model: z.string().min(1),
  repository: z.string().min(1),
  checkout: z.string().min(1),
  worktreeRoot: z.string().min(1),
  maxWorkers: z.number().int().positive(),
  author: z.string().min(1).nullable().default(null),
  capture: z.object({
    localOnly: z.literal(true),
    redactedBeforePersistence: z.literal(true),
    retention: z.literal("indefinite"),
  }),
});

export const RunManifestV1Schema = RunManifestBaseSchema.extend({
  schemaVersion: z.literal(1),
  files: z.object({
    events: z.literal("events.jsonl"),
    summary: z.literal("summary.json"),
    mastra: z.literal("mastra.db"),
    observability: z.literal("observability.duckdb"),
  }),
});
export const RunManifestV2Schema = RunManifestBaseSchema.extend({
  schemaVersion: z.literal(2),
  files: z.object({
    events: z.literal("events.jsonl"),
    summary: z.literal("summary.json"),
    spans: z.literal("spans.jsonl"),
  }),
});
export const RunManifestSchema = z.discriminatedUnion("schemaVersion", [
  RunManifestV1Schema,
  RunManifestV2Schema,
]);

export const RunArtifactSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("absent") }),
  z.object({
    state: z.literal("present"),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
]);
export const RunArtifactsV1Schema = z.object({
  mastra: RunArtifactSchema,
  observability: RunArtifactSchema,
});
export const RunArtifactsV2Schema = z.object({
  spans: RunArtifactSchema,
});

const RunSummaryBaseSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  finishedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  lastHash: z.string().regex(/^[0-9a-f]{64}$/),
  countsByKind: z.record(z.string(), z.number().int().nonnegative()),
  finalSnapshot: FleetSnapshotSchema.nullable(),
  error: z
    .object({ message: z.string(), stack: z.string().optional() })
    .nullable(),
});
export const RunSummaryV1Schema = RunSummaryBaseSchema.extend({
  schemaVersion: z.literal(1),
  artifacts: RunArtifactsV1Schema,
});
export const RunSummaryV2Schema = RunSummaryBaseSchema.extend({
  schemaVersion: z.literal(2),
  artifacts: RunArtifactsV2Schema,
});
export const RunSummarySchema = z.discriminatedUnion("schemaVersion", [
  RunSummaryV1Schema,
  RunSummaryV2Schema,
]);

export type JsonValue = z.infer<typeof JsonValueSchema>;
export type RunEventKind = z.infer<typeof RunEventKindSchema>;
export type RunEventCorrelation = z.infer<typeof RunEventCorrelationSchema>;
export type RecordedRunEvent = z.infer<typeof RecordedRunEventSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type RunManifestV2 = z.infer<typeof RunManifestV2Schema>;
export type RunArtifact = z.infer<typeof RunArtifactSchema>;
export type RunArtifactsV1 = z.infer<typeof RunArtifactsV1Schema>;
export type RunArtifactsV2 = z.infer<typeof RunArtifactsV2Schema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type RunSummaryV2 = z.infer<typeof RunSummaryV2Schema>;
