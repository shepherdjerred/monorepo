import { z } from "zod";
import { FleetSnapshotSchema } from "./schemas.ts";

export const RUN_BUNDLE_SCHEMA_VERSION = 1;
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
  "environment.result",
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

export const UnsignedRunEventSchema = z.object({
  schemaVersion: z.literal(RUN_BUNDLE_SCHEMA_VERSION),
  runId: z.string().min(1),
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime(),
  previousHash: z.string().regex(/^[0-9a-f]{64}$/),
  kind: RunEventKindSchema,
  correlation: RunEventCorrelationSchema,
  payload: RunEventPayloadSchema,
});

export const RecordedRunEventSchema = UnsignedRunEventSchema.extend({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const RunManifestSchema = z.object({
  schemaVersion: z.literal(RUN_BUNDLE_SCHEMA_VERSION),
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
  files: z.object({
    events: z.literal("events.jsonl"),
    summary: z.literal("summary.json"),
    mastra: z.literal("mastra.db"),
    observability: z.literal("observability.duckdb"),
  }),
  capture: z.object({
    localOnly: z.literal(true),
    redactedBeforePersistence: z.literal(true),
    retention: z.literal("indefinite"),
  }),
});

export const RunArtifactSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("absent") }),
  z.object({
    state: z.literal("present"),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
]);

export const RunArtifactsSchema = z.object({
  mastra: RunArtifactSchema,
  observability: RunArtifactSchema,
});

export const RunSummarySchema = z.object({
  schemaVersion: z.literal(RUN_BUNDLE_SCHEMA_VERSION),
  runId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  finishedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  lastHash: z.string().regex(/^[0-9a-f]{64}$/),
  countsByKind: z.record(z.string(), z.number().int().nonnegative()),
  artifacts: RunArtifactsSchema,
  finalSnapshot: FleetSnapshotSchema.nullable(),
  error: z
    .object({
      message: z.string(),
      stack: z.string().optional(),
    })
    .nullable(),
});

export type JsonValue = z.infer<typeof JsonValueSchema>;
export type RunEventKind = z.infer<typeof RunEventKindSchema>;
export type RunEventCorrelation = z.infer<typeof RunEventCorrelationSchema>;
export type RecordedRunEvent = z.infer<typeof RecordedRunEventSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type RunArtifact = z.infer<typeof RunArtifactSchema>;
export type RunArtifacts = z.infer<typeof RunArtifactsSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
