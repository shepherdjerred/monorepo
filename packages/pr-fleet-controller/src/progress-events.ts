import { z } from "zod";
import { captureTelemetryOperation } from "./controller-telemetry.ts";
import type { FleetTelemetry } from "./ports.ts";
import type { RunEventCorrelation, RunEventKind } from "./run-events.ts";

export const FleetFailureClassSchema = z.enum([
  "setup-required",
  "lease-unavailable",
  "worktree-head-changed",
  "restack-required",
  "invalid-commit-scope",
  "hook-failed",
  "publication-context",
  "command-timeout",
  "command-aborted",
  "operator-input-required",
  "unknown",
]);
export type FleetFailureClass = z.infer<typeof FleetFailureClassSchema>;

export const LeaseDenialReasonSchema = z.enum([
  "setup-held",
  "heavy-capacity",
  "stack-write-held",
]);
export type LeaseDenialReason = z.infer<typeof LeaseDenialReasonSchema>;

const LeaseKindSchema = z.enum(["setup", "heavy", "stack-write"]);
const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const PublicationIntentSchema = z.enum(["fix", "restack", "inherited-commits"]);
const PublicationStageSchema = z.enum([
  "validation",
  "hooks",
  "commit",
  "submission",
  "remote-head",
  "review",
]);
const ProgressStateSchema = z.enum(["started", "completed"]);

export const ProgressEventKindSchema = z.enum([
  "lease.granted",
  "lease.denied",
  "lease.released",
  "setup.required",
  "setup.started",
  "setup.completed",
  "setup.failed",
  "publication.stage",
  "worktree.head.transition",
]);
export type ProgressEventKind = z.infer<typeof ProgressEventKindSchema>;

export const ProgressPayloadSchemas = {
  "lease.granted": z.object({ kind: LeaseKindSchema }),
  "lease.denied": z.object({
    kind: LeaseKindSchema,
    reason: LeaseDenialReasonSchema,
  }),
  "lease.released": z.object({
    kind: LeaseKindSchema,
    durationMs: z.number().int().nonnegative(),
  }),
  "setup.required": z.object({ reason: z.literal("current-head-unprepared") }),
  "setup.started": z.object({ headSha: ShaSchema }),
  "setup.completed": z.object({
    headSha: ShaSchema,
    commandCount: z.number().int().nonnegative(),
  }),
  "setup.failed": z.object({
    headSha: ShaSchema,
    failureClass: FleetFailureClassSchema,
  }),
  "publication.stage": z.object({
    intent: PublicationIntentSchema,
    stage: PublicationStageSchema,
    state: ProgressStateSchema,
  }),
  "worktree.head.transition": z.object({
    cause: z.enum(["restack", "publication", "unexpected"]),
    localHeadSha: ShaSchema,
  }),
} as const satisfies Record<ProgressEventKind, z.ZodType>;

export function validateProgressEvent(
  kind: RunEventKind,
  payload: unknown,
): void {
  const parsedKind = ProgressEventKindSchema.safeParse(kind);
  if (parsedKind.success) {
    ProgressPayloadSchemas[parsedKind.data].parse(payload);
  }
}

export function recordProgressEvent(options: {
  telemetry: FleetTelemetry | undefined;
  kind: ProgressEventKind;
  payload: Record<string, unknown>;
  correlation: RunEventCorrelation;
}): void {
  const { telemetry, kind, payload, correlation } = options;
  validateProgressEvent(kind, payload);
  captureTelemetryOperation(kind, () => {
    telemetry?.record(kind, payload, correlation);
  });
}

export function classifyFleetFailure(error: unknown): FleetFailureClass {
  const message = error instanceof Error ? error.message : String(error);
  if (/worktree .*HEAD changed|local HEAD changed/i.test(message)) {
    return "worktree-head-changed";
  }
  if (/setup must complete|current head before validation/i.test(message)) {
    return "setup-required";
  }
  if (
    /lease is not available|does not hold the stack write lease/i.test(message)
  ) {
    return "lease-unavailable";
  }
  if (/invalid commit scope/i.test(message)) {
    return "invalid-commit-scope";
  }
  if (/restack|rebase/i.test(message)) {
    return "restack-required";
  }
  if (/prettier|lefthook|commit hook|hook failed/i.test(message)) {
    return "hook-failed";
  }
  if (
    /cannot publish|unvalidated .*worktree context|publication requires/i.test(
      message,
    )
  ) {
    return "publication-context";
  }
  if (/timed? ?out/i.test(message)) {
    return "command-timeout";
  }
  if (/aborted|abort/i.test(message)) {
    return "command-aborted";
  }
  if (/operator input|waiting-for-answer/i.test(message)) {
    return "operator-input-required";
  }
  return "unknown";
}
