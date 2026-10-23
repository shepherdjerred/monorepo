import type {
  Approval,
  Deployment,
  RecoveryIntent,
} from "#generated/prisma/client.ts";
import {
  PipelineRevisionSchema,
  type DeploymentDetail,
} from "#shared/contract.ts";
import { recipeKindOf } from "#shared/model/recipe-view.ts";
import type { Database } from "#infrastructure/database.ts";
import { ApprovalV2Schema } from "#shared/model/approval-contract.ts";
import { SelectionSchema } from "#shared/model/selection-contract.ts";
import {
  EnvironmentSelectionSchema,
  ApprovalQueueItemSchema,
  DeploymentDetailV2Schema,
  DeploymentV2Schema,
} from "#shared/model/route-contract.ts";
import { RecoveryIntentV2Schema } from "#shared/recovery-intent.ts";
import { EvidenceInputSchema } from "#shared/evidence-contract.ts";
import { z } from "zod";
import { required, wire } from "#infrastructure/delivery-records.ts";

/** Kinds that froze no selection: retired v1 platform history. */
const UNSELECTED_KINDS = new Set([
  "root-release",
  "tofu-plan",
  "tofu-apply",
  "upgrade-control-plane",
]);

/**
 * The selection a deployment froze (4.9). Retired v1 platform history, and
 * v1 deployments whose recipe ids predate revision ids, froze none.
 */
export function selectionOf(row: {
  kind: string;
  versionSetRevisionId: string;
  pipelineRevisionId: string;
  configurationId: string;
}) {
  if (UNSELECTED_KINDS.has(row.kind)) return null;
  const parsed = SelectionSchema.safeParse({
    versionSetRevisionId: row.versionSetRevisionId,
    recipeRevisionId: row.pipelineRevisionId,
    configurationRevisionId: row.configurationId,
  });
  return parsed.success ? parsed.data : null;
}

/** A deployment as the model routes return it. */
export function deploymentView(row: Deployment) {
  return DeploymentV2Schema.parse(
    wire({
      ...row,
      selection: selectionOf(row),
      monitorState: row.monitorState,
    }),
  );
}

export function approvalView(row: Approval | null) {
  if (row === null) return null;
  const {
    boundFingerprint: _bound,
    overrideActor,
    overrideReason,
    overrideDecidedAt,
    ...view
  } = row;
  return ApprovalV2Schema.parse(
    wire({
      ...view,
      overrideDecision:
        overrideDecidedAt === null
          ? null
          : {
              actor: overrideActor,
              reason: overrideReason,
              decidedAt: overrideDecidedAt,
            },
    }),
  );
}

/** The unified recovery intent (4.15) a row records. */
export function recoveryIntentView(row: RecoveryIntent) {
  return RecoveryIntentV2Schema.parse(
    wire({
      id: row.id,
      kind: row.kind,
      deploymentId: row.deploymentId,
      sequence: row.sequence,
      step: row.step,
      requestedBy: row.requestedBy,
      reason: row.reason,
      expectedGeneration: row.expectedGeneration,
      fingerprint: row.fingerprint,
      evidence: z.array(EvidenceInputSchema).parse(row.evidence),
      outcome:
        row.status === "succeeded" || row.status === "failed"
          ? row.status
          : "pending",
      createdAt: row.createdAt,
      settledAt:
        row.status === "succeeded" || row.status === "failed"
          ? row.finishedAt
          : null,
    }),
  );
}

/** `GET /deployments/:id`: the detail with the deployment view, approval and intents. */
export function detailView(
  detail: DeploymentDetail,
  row: Deployment & {
    approval: Approval | null;
    recoveryIntents: RecoveryIntent[];
  },
) {
  return DeploymentDetailV2Schema.parse({
    ...detail,
    deployment: deploymentView(row),
    approval: approvalView(row.approval),
    recoveryIntents: row.recoveryIntents.map((intent) =>
      recoveryIntentView(intent),
    ),
  });
}

export function approvalQueueItem(
  row: Deployment & { approval: Approval | null },
) {
  return ApprovalQueueItemSchema.parse({
    ...deploymentView(row),
    approval: approvalView(row.approval),
  });
}

/** `GET /environments/:id/selection`: the accepted selection beside the declared binding. */
export async function environmentSelection(
  database: Database,
  environmentId: string,
) {
  const env = required(
    await database.environment.findUnique({
      where: { id: environmentId },
      include: { acceptedDeployment: true },
    }),
    "Environment",
  );
  const declared = PipelineRevisionSchema.parse(
    wire(
      await database.pipeline.findUniqueOrThrow({
        where: { id: env.pipelineRevisionId },
      }),
    ),
  );
  const accepted =
    env.acceptedDeployment === null
      ? null
      : selectionOf(env.acceptedDeployment);
  return EnvironmentSelectionSchema.parse({
    accepted,
    acceptedDeploymentId: accepted === null ? null : env.acceptedDeploymentId,
    declared: {
      recipeRevisionId: env.pipelineRevisionId,
      recipeKind: recipeKindOf(declared.definition),
      configurationRevisionId: env.declaredConfigurationId,
    },
    role: env.role,
    lifecycle: env.lifecycle,
    approvalPolicy: env.approvalPolicy,
    bindingGeneration: env.generation,
  });
}

/** `GET /deployments/:id` (model view). */
export async function deploymentDetailV2(
  delivery: {
    database: Database;
    detail: (id: string) => Promise<DeploymentDetail>;
  },
  deploymentId: string,
) {
  const detail = await delivery.detail(deploymentId);
  const row = await delivery.database.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
    include: {
      approval: true,
      recoveryIntents: { orderBy: { sequence: "asc" } },
    },
  });
  return detailView(detail, row);
}

/** A deployment as the model routes return it, read by id. */
export async function deploymentViewById(
  database: Database,
  deploymentId: string,
) {
  return deploymentView(
    await database.deployment.findUniqueOrThrow({
      where: { id: deploymentId },
    }),
  );
}

/** The approval a deployment carries, after a decision. */
export async function approvalById(database: Database, deploymentId: string) {
  return required(
    approvalView(
      await database.approval.findUnique({ where: { deploymentId } }),
    ),
    "Approval",
  );
}

/**
 * `GET /approvals`: deployments awaiting approval, then those whose approval
 * was decided or expired in the last day, each with its approval.
 */
export async function approvalQueue(database: Database) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await database.deployment.findMany({
    where: {
      OR: [
        { status: "awaiting_approval" },
        { approval: { is: { decidedAt: { gte: since } } } },
      ],
    },
    include: { approval: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return rows
    .toSorted(
      (left, right) =>
        Number(right.status === "awaiting_approval") -
        Number(left.status === "awaiting_approval"),
    )
    .map((row) => approvalQueueItem(row));
}
