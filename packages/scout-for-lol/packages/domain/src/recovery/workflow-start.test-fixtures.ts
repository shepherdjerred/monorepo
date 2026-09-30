import {
  IsoInstantSchema,
  WorkflowRunIdSchema,
  WorkflowStartRequestIdSchema,
  type WorkflowRunId,
} from "#src/identity/brands.ts";
import type { VersionedPayloadEnvelope } from "#src/codec/versioned.ts";
import type {
  ScoutWorkflowStartRecord,
  ScoutWorkflowStartRequest,
} from "#src/recovery/workflow-start.ts";

export const WORKFLOW_ID = "scout-beta-pipeline-reconciliation-v2-operator";
export const WORKFLOW_TYPE = "scoutPipelineReconciliationV2Workflow";
export const REQUESTED_AT = IsoInstantSchema.parse("2026-09-16T10:00:00.000Z");
export const ACCEPTED_AT = IsoInstantSchema.parse("2026-09-16T10:00:01.000Z");
export const RUN_ID = WorkflowRunIdSchema.parse("run-1");
export const FIRST_REQUEST_ID = WorkflowStartRequestIdSchema.parse(
  "6f1e7f1a-2b3c-4d5e-8f90-0123456789ab",
);
export const SECOND_REQUEST_ID = WorkflowStartRequestIdSchema.parse(
  "7a2f8e2b-3c4d-4e6f-9a01-123456789abc",
);

export function startRequest(
  overrides: Partial<{
    requestedWorkflowId: string;
    workflowType: string;
    inputPayload: VersionedPayloadEnvelope;
    requestSource: string;
  }> = {},
): ScoutWorkflowStartRequest {
  const workflowType = overrides.workflowType ?? WORKFLOW_TYPE;
  return {
    requestedWorkflowId: overrides.requestedWorkflowId ?? WORKFLOW_ID,
    workflowType,
    requestedBy: null,
    requestSource: overrides.requestSource ?? "operations:reconcile-pipeline",
    inputPayload: overrides.inputPayload ?? {
      kind: workflowType,
      version: 1,
      data: { stage: "beta", trigger: "operator" },
    },
    requestedAt: REQUESTED_AT,
  };
}

export function requestedRecord(
  overrides: Parameters<typeof startRequest>[0] & {
    requestId?: ScoutWorkflowStartRecord["requestId"];
  } = {},
): ScoutWorkflowStartRecord {
  return {
    requestId: overrides.requestId ?? FIRST_REQUEST_ID,
    ...startRequest(overrides),
    acceptance: null,
  };
}

export function acceptedRecord(
  overrides: Parameters<typeof requestedRecord>[0] & {
    runId?: WorkflowRunId | null;
  } = {},
): ScoutWorkflowStartRecord {
  return {
    ...requestedRecord(overrides),
    acceptance: {
      acceptedAt: ACCEPTED_AT,
      runId: overrides.runId === undefined ? RUN_ID : overrides.runId,
    },
  };
}
