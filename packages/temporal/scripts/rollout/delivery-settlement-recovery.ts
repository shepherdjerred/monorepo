import { Client, Connection } from "@temporalio/client";
import { defaultPayloadConverter } from "@temporalio/common";
import { Context } from "@temporalio/activity";
import { NativeConnection, Worker } from "@temporalio/worker";
import {
  DeploymentDetailSchema,
  deliveryWorkflowId,
} from "@shepherdjerred/delivery/contract";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { deliveryUrl } from "@shepherdjerred/toolkit/lib/delivery/client.ts";
import { z } from "zod";
import { finishDelivery } from "#activities/delivery/execute.ts";
import {
  requireSettlementTask,
  requireSettlementOwner,
  settlementRecoveryPlan,
} from "#activities/delivery/settlement-recovery.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import {
  parseFlagArguments,
  requiredParsedArgument,
  requiredEnvironment,
} from "#scripts/cli-arguments.ts";
import { resolveOperatorTemporalApiKey } from "./temporal-operator-credentials.ts";

async function main() {
  const flags = parseFlagArguments(
    process.argv.slice(2),
    new Set(["--deployment", "--run", "--activity", "--url", "--mode"]),
  );
  const deploymentId = z
    .uuid()
    .parse(requiredParsedArgument(flags, "--deployment"));
  const workflowId = deliveryWorkflowId(deploymentId);
  const runId = z.uuid().parse(requiredParsedArgument(flags, "--run"));
  const activityId = requiredParsedArgument(flags, "--activity");
  const mode = z
    .enum(["preview", "execute"])
    .parse(requiredParsedArgument(flags, "--mode"));
  Bun.env["DELIVERY_API_URL"] = deliveryUrl(
    requiredParsedArgument(flags, "--url"),
  );
  await resolveCredentials(["DELIVERY_EXECUTOR_TOKEN"]);
  await resolveOperatorTemporalApiKey();
  Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
  const options = temporalConnectionOptions({
    environment: Bun.env,
    defaultAddress: requiredEnvironment(Bun.env, "TEMPORAL_ADDRESS"),
  });
  const connection = await Connection.connect(options);
  try {
    const client = new Client({ connection, namespace: "prod" });
    const handle = client.workflow.getHandle(workflowId, runId);
    const requirePaused = async () => {
      const schedule = await client.schedule
        .getHandle("delivery-dispatch")
        .describe();
      if (!schedule.state.paused || schedule.info.runningActions.length > 0)
        throw new Error(
          "Pause and drain Delivery dispatch before independent settlement",
        );
    };
    const inspect = async () => {
      await requirePaused();
      const observed = await handle.describe();
      const current = await deliveryRequest(
        `deployments/${deploymentId}`,
        DeploymentDetailSchema,
      );
      if (observed.runId !== runId)
        throw new Error("Deployment/run ownership changed before settlement");
      requireSettlementOwner({
        deploymentId,
        status: current.deployment.status,
        activeDeploymentId: current.environment.activeDeploymentId,
      });
      const history = await handle.fetchHistory();
      const plan = settlementRecoveryPlan({
        deploymentId,
        runId,
        activityId,
        workflowType: observed.type,
        workflowStatus: observed.status.name,
        taskQueue: observed.taskQueue,
        pending: (observed.raw.pendingActivities ?? []).map((item) => ({
          id: item.activityId ?? "",
          type: item.activityType?.name ?? "",
          state: item.state ?? 0,
        })),
        scheduled: (history.events ?? []).flatMap((event) => {
          const item = event.activityTaskScheduledEventAttributes;
          return item === null || item === undefined
            ? []
            : [
                {
                  id: item.activityId ?? "",
                  type: item.activityType?.name ?? "",
                  args: (item.input?.payloads ?? []).map((payload) =>
                    defaultPayloadConverter.fromPayload(payload),
                  ),
                },
              ];
        }),
      });
      const pending = observed.raw.pendingActivities?.[0];
      const queue = pending?.activityOptions?.taskQueue?.name;
      if (
        queue !== undefined &&
        queue !== null &&
        !["delivery", plan.queue].includes(queue)
      )
        throw new Error("Activity already belongs to another recovery queue");
      return plan;
    };
    const plan = await inspect();
    console.warn(
      JSON.stringify({
        deploymentId,
        runId,
        activityId,
        queue: plan.queue,
        recordedStatus: plan.result.status,
        mode,
      }),
    );
    if (mode === "preview") return;
    const { apiKey, ...nativeOptions } = options;
    const native = await NativeConnection.connect({
      ...nativeOptions,
      ...(apiKey === undefined ? {} : { apiKey: z.string().parse(apiKey) }),
    });
    try {
      const worker = await Worker.create({
        connection: native,
        namespace: "prod",
        taskQueue: plan.queue,
        identity: `delivery-settlement/${runId}/${activityId}`,
        maxConcurrentActivityTaskExecutions: 1,
        activities: {
          finishDelivery: async (id: string, result: unknown) => {
            const info = Context.current().info;
            requireSettlementTask(
              plan,
              {
                workflowId: info.workflowExecution?.workflowId ?? "",
                runId: info.workflowExecution?.runId ?? "",
                activityId: info.activityId,
              },
              id,
              result,
            );
            await requirePaused();
            const current = await deliveryRequest(
              `deployments/${deploymentId}`,
              DeploymentDetailSchema,
            );
            requireSettlementOwner({
              deploymentId,
              status: current.deployment.status,
              activeDeploymentId: current.environment.activeDeploymentId,
            });
            await finishDelivery(id, plan.result);
          },
        },
      });
      await worker.runUntil(async () => {
        await inspect();
        const command = Bun.spawn(
          [
            "toolkit",
            "temporal",
            "--namespace",
            "prod",
            "activity",
            "update-options",
            "--workflow-id",
            workflowId,
            "--run-id",
            runId,
            "--activity-id",
            activityId,
            "--task-queue",
            plan.queue,
          ],
          { stdout: "ignore", stderr: "inherit" },
        );
        if ((await command.exited) !== 0)
          throw new Error(
            "Exact Activity queue update failed; inspect before resuming the same recovery",
          );
        try {
          await connection.withDeadline(Date.now() + 120_000, async () => {
            await handle.result();
          });
        } catch {
          /* Recheck both authoritative outcomes below, including after an observation timeout. */
        }
        const [observed, settled] = await Promise.all([
          handle.describe(),
          deliveryRequest(
            `deployments/${deploymentId}`,
            DeploymentDetailSchema,
          ),
        ]);
        if (
          !["FAILED", "CANCELLED"].includes(observed.status.name) ||
          !["failed", "canceled"].includes(settled.deployment.status)
        )
          throw new Error(
            "Independent settlement did not preserve the original failed outcome",
          );
        console.warn(
          JSON.stringify({
            deploymentId,
            workflowStatus: observed.status.name,
            status: settled.deployment.status,
            recoveryRequired: settled.deployment.recoveryRequired,
          }),
        );
      });
    } finally {
      await native.close();
    }
  } finally {
    await connection.close();
  }
}

if (import.meta.main) {
  await main();
}
