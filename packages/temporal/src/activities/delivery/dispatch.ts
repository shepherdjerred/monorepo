import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
  ApplicationFailure,
  WorkflowNotFoundError,
} from "@temporalio/common";
import { z } from "zod";
import {
  DeploymentSchema,
  deliverySuccessorWorkflowId,
  deliveryWorkflowId,
} from "@shepherdjerred/delivery/contract";
import { createTemporalClient } from "#client";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const closedStatus = z.enum([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "TERMINATED",
  "TIMED_OUT",
]);

async function reportClosed(
  id: string,
  workflowId: string,
  status: string,
): Promise<boolean> {
  if (status === "RUNNING") return false;
  await deliveryRequest(
    `deployments/${encodeURIComponent(id)}/orphan`,
    z.unknown(),
    {
      workflowId,
      workflowStatus: closedStatus.parse(status),
      reason:
        "Independent dispatch repair observed a closed Workflow before deployment settlement",
    },
  );
  return true;
}

export async function qualifyDeliveryBuilds() {
  const qualification = await deliveryRequest(
    "qualification/pending",
    z.object({
      builds: z.array(
        z.object({
          id: z.string(),
          serviceId: z.string(),
          sourceRevision: z.string(),
          ciUrl: z.string(),
        }),
      ),
    }),
  );
  const outcomes = await Promise.allSettled(
    qualification.builds
      .slice(0, 3)
      .map(
        async (build) =>
          await deliveryRequest(
            `builds/${encodeURIComponent(build.id)}/qualify`,
            z.object({ status: z.enum(["pending", "verified", "failed"]) }),
            {},
          ),
      ),
  );
  for (const outcome of outcomes)
    if (outcome.status === "rejected") throw outcome.reason;
}

type TemporalClient = Awaited<ReturnType<typeof createTemporalClient>>;

/** The Workflow type behind each executor identity a deployment may have. */
function ownerWorkflowType(deploymentId: string, workflowId: string) {
  return workflowId === deliverySuccessorWorkflowId(deploymentId)
    ? "deliveryHandoffWorkflow"
    : "deliveryDeploymentWorkflow";
}

/**
 * D8: a handed-off self-hosted deployment gets exactly one successor
 * executor, which claims the marker before it continues. A successor that
 * already started keeps its own identity; no other Workflow is started.
 */
async function startSuccessor(client: TemporalClient, deploymentId: string) {
  try {
    await client.workflow.start("deliveryHandoffWorkflow", {
      taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
      workflowId: deliverySuccessorWorkflowId(deploymentId),
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [{ deploymentId }],
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
}

async function repairSubmitted(client: TemporalClient) {
  const monitor = await deliveryRequest(
    "dispatch/monitor",
    z.object({
      deployments: z.array(
        z.object({
          id: z.string(),
          status: z.string(),
          workflowId: z.string(),
          submitted: z.boolean(),
          ownerWorkflowId: z.string().nullable(),
          handoff: z.boolean(),
        }),
      ),
    }),
  );
  for (const deployment of monitor.deployments) {
    // The outgoing executor closes by design after a handoff (D8).
    if (deployment.handoff) {
      await startSuccessor(client, deployment.id);
      continue;
    }
    // A closed owner, original or successor, leaves the deployment orphaned.
    const owner = deployment.ownerWorkflowId ?? deployment.workflowId;
    let observed;
    try {
      observed = await client.workflow.getHandle(owner).describe();
    } catch (error) {
      if (error instanceof WorkflowNotFoundError && !deployment.submitted)
        continue;
      throw error;
    }
    if (observed.type !== ownerWorkflowType(deployment.id, owner))
      throw new Error(
        "Delivery Workflow monitor found an unexpected Workflow type",
      );
    if (!deployment.submitted && observed.status.name === "RUNNING")
      await deliveryRequest(
        `dispatch/${encodeURIComponent(deployment.id)}/submitted`,
        z.unknown(),
        { workflowId: deployment.workflowId },
      );
    await reportClosed(deployment.id, owner, observed.status.name);
  }
}

async function reconcileAdmission(): Promise<boolean> {
  try {
    await deliveryRequest("reconcile", z.unknown(), {});
  } catch (error) {
    if (
      error instanceof ApplicationFailure &&
      error.type === "DeliveryApi:PAUSED"
    )
      return false;
    throw error;
  }
  return true;
}

/** An outbox row remains pending until a stable Workflow identity exists. */
export async function dispatchPendingDeliveries() {
  const client = await createTemporalClient("prod");
  await repairSubmitted(client);
  if (!(await reconcileAdmission())) return { submitted: 0 };
  const pending = await deliveryRequest(
    "dispatch/pending",
    z.object({ deployments: z.array(DeploymentSchema) }),
  );
  let submitted = 0;
  for (const deployment of pending.deployments) {
    const workflowId = deliveryWorkflowId(deployment.id);
    try {
      await client.workflow.start("deliveryDeploymentWorkflow", {
        taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
        workflowId,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        args: [{ deploymentId: deployment.id }],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
      // A lost start response is reconciled by identity, never by another ID.
      const existing = await client.workflow.getHandle(workflowId).describe();
      if (existing.type !== "deliveryDeploymentWorkflow")
        throw new Error(
          "Delivery Workflow identity belongs to another Workflow type",
          { cause: error },
        );
      if (await reportClosed(deployment.id, workflowId, existing.status.name))
        continue;
    }
    await deliveryRequest(
      `dispatch/${encodeURIComponent(deployment.id)}/submitted`,
      z.unknown(),
      { workflowId },
    );
    submitted += 1;
  }
  return { submitted };
}
