import { Client, type Connection } from "@temporalio/client";
import type { KubeConfig } from "@kubernetes/client-node";
import { deliveryWorkflowId } from "@shepherdjerred/delivery/contract";
import {
  requireHealthyWorkflowPoller,
  type RolloutCommandRunner,
} from "#lib/worker-deployment-proofs.ts";
import type { WorkerRecoveryEffects } from "./worker-recovery.ts";
import { retirementEffects } from "./worker-retirement.ts";
import {
  verifyWorkerPoolPollers,
  workerApplicationResources,
} from "./worker-hosts.ts";
import {
  proveTerminalWorkerJobs,
  recoveryJobReader,
} from "./worker-recovery-jobs.ts";

export function workerRecoveryEffects(input: {
  connection: Connection;
  kubernetes: KubeConfig;
  readArgo: WorkerRecoveryEffects["readArgo"];
  pollerRunner?: RolloutCommandRunner;
}): WorkerRecoveryEffects {
  const temporal = retirementEffects(input.connection);
  return {
    readArgo: input.readArgo,
    resources: async (app, kind) =>
      await workerApplicationResources(app, kind, input.readArgo),
    async workflowClosed(id) {
      const workflowId = deliveryWorkflowId(id);
      const result = await new Client({
        connection: input.connection,
        namespace: "prod",
      }).workflow
        .getHandle(workflowId)
        .describe();
      if (
        result.type !== "deliveryDeploymentWorkflow" ||
        ![
          "COMPLETED",
          "FAILED",
          "CANCELED",
          "TERMINATED",
          "TIMED_OUT",
        ].includes(result.status.name)
      )
        throw new Error("Failed source Workflow is not independently closed");
      return `${workflowId}/${result.runId}`;
    },
    terminalJobs: async (context) =>
      await proveTerminalWorkerJobs(
        context,
        recoveryJobReader(input.kubernetes),
      ),
    async pollers(pool) {
      if (input.pollerRunner === undefined) {
        await verifyWorkerPoolPollers(pool);
        return;
      }
      for (const worker of pool.versions.filter(
        (entry) => entry.replicas === 1,
      ))
        for (const route of worker.host.routes)
          await requireHealthyWorkflowPoller(
            { ...route, buildId: worker.buildId },
            input.pollerRunner,
            "recovery",
          );
    },
    async routes(pool) {
      const routes = pool.versions[0]?.host.routes;
      if (routes === undefined)
        throw new Error("Missing worker recovery routes");
      const result = [];
      for (const route of routes) {
        const current = await temporal.routing(route);
        if (current.rampingBuildId !== null)
          throw new Error("Worker routing has not settled");
        result.push({
          ...route,
          currentBuildId: current.currentBuildId,
          rampingBuildId: null,
          routingConflictToken: current.token,
        });
      }
      return result;
    },
    async noCandidateReferences(pool) {
      for (const route of pool.versions[0]?.host.routes ?? []) {
        const routing = await temporal.routing(route);
        if (
          routing.currentBuildId === pool.candidateBuildId ||
          routing.rampingBuildId === pool.candidateBuildId ||
          (await temporal.openExecutions(route, pool.candidateBuildId)) !== 0
        )
          throw new Error(
            "Unapplied candidate has routing or open execution references",
          );
      }
    },
  };
}
