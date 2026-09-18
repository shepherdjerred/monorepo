import { z } from "zod";
import {
  IsoInstantSchema,
  WorkflowRunIdSchema,
  WorkflowStartRequestIdSchema,
} from "#src/identity/brands.ts";
import { DiscordAccountIdSchema } from "#src/identity/discord.ts";
import { VersionedPayloadEnvelopeSchema } from "#src/codec/versioned.ts";

/**
 * Workflow start request contract.
 *
 * A request records that someone asked Temporal to start a Workflow and, once
 * Temporal answered, that the start was accepted. It exists so a requester
 * that crashed between asking and hearing back leaves durable evidence, and so
 * a retry adopts that evidence instead of starting a duplicate.
 *
 * One record per REQUEST, not per Workflow. Every V2 Workflow id derives from
 * identity alone, so one Workflow is requested many times over its life: an
 * operator reconciles a stage again next week, a projection is repaired twice.
 * Each request carries its own key; the Workflow id is what the requests
 * share, and the requests for one Workflow id all describe the same start —
 * same type, same input — because the id was derived from that identity.
 *
 * A request has two phases. It is `requested` until acceptance is recorded and
 * `accepted` after. {@link WORKFLOW_START_LIFECYCLE} says which of those is
 * in flight — adopted by a concurrent request for the same Workflow id rather
 * than duplicated — and which is terminal — succeeded by a new request. The
 * transition functions are the only place that table is applied, so the
 * persistence layer can mirror it (a partial unique key over in-flight
 * requests) without being the place it is defined.
 *
 * `accepted` is terminal even though the Workflow it started may still be
 * running, and that is the point rather than an approximation. Acceptance
 * ends the HANDOFF: from then on the Workflow id is Temporal's to govern —
 * its conflict policy decides whether a later start joins the running
 * execution, its reuse policy whether a closed one re-runs. This contract
 * records handoffs, not executions, and a request made after acceptance is a
 * new handoff whatever Temporal then does with it.
 */

const startShape = {
  /** Temporal's business key — the Workflow id asked for. */
  requestedWorkflowId: z.string().min(1),
  /** The registered Workflow name; also the input envelope's kind. */
  workflowType: z.string().min(1),
  /** The operator who asked, or null for a system request. */
  requestedBy: DiscordAccountIdSchema.nullable(),
  /** Where the request came from, e.g. `operations:reconcile-pipeline`. */
  requestSource: z.string().min(1),
  /** The Workflow input, wrapped in an envelope whose kind is `workflowType`. */
  inputPayload: VersionedPayloadEnvelopeSchema,
  requestedAt: IsoInstantSchema,
} as const;

/**
 * The expected-kind contract: a start is typed by `workflowType`, and its
 * input envelope's kind IS that type, so a stored input can never be mistaken
 * for another Workflow's.
 */
function refineExpectedKind(
  start: { inputPayload: { kind: string }; workflowType: string },
  ctx: z.RefinementCtx,
): void {
  if (start.inputPayload.kind !== start.workflowType) {
    ctx.addIssue({
      code: "custom",
      message: `input payload kind ${start.inputPayload.kind} does not match workflowType ${start.workflowType}`,
      path: ["inputPayload", "kind"],
    });
  }
}

/** What a requester supplies: everything but the key and the acceptance. */
export type ScoutWorkflowStartRequest = z.infer<
  typeof ScoutWorkflowStartRequestSchema
>;
export const ScoutWorkflowStartRequestSchema = z
  .strictObject(startShape)
  .superRefine(refineExpectedKind);

/**
 * Temporal's answer. A run id is acceptance evidence, so it can never exist
 * without `acceptedAt`; it is nullable because not every client path surfaces
 * one.
 */
export type WorkflowStartAcceptance = z.infer<
  typeof WorkflowStartAcceptanceSchema
>;
export const WorkflowStartAcceptanceSchema = z.strictObject({
  acceptedAt: IsoInstantSchema,
  runId: WorkflowRunIdSchema.nullable(),
});

export type ScoutWorkflowStartRecord = z.infer<
  typeof ScoutWorkflowStartRecordSchema
>;
export const ScoutWorkflowStartRecordSchema = z
  .strictObject({
    requestId: WorkflowStartRequestIdSchema,
    ...startShape,
    acceptance: WorkflowStartAcceptanceSchema.nullable(),
  })
  .superRefine(refineExpectedKind);

export const WORKFLOW_START_PHASES = ["requested", "accepted"] as const;
export type WorkflowStartPhase = (typeof WORKFLOW_START_PHASES)[number];

export type WorkflowStartLifecycle = "in-flight" | "terminal";

/**
 * Which phases are in flight and which are terminal. In flight: a concurrent
 * request for the same Workflow id adopts this one. Terminal: a later request
 * for the same Workflow id is recorded as a new request.
 */
export const WORKFLOW_START_LIFECYCLE = {
  requested: "in-flight",
  accepted: "terminal",
} as const satisfies Record<WorkflowStartPhase, WorkflowStartLifecycle>;

export function workflowStartPhase(
  record: ScoutWorkflowStartRecord,
): WorkflowStartPhase {
  return record.acceptance === null ? "requested" : "accepted";
}

export function workflowStartLifecycle(
  record: ScoutWorkflowStartRecord,
): WorkflowStartLifecycle {
  return WORKFLOW_START_LIFECYCLE[workflowStartPhase(record)];
}
