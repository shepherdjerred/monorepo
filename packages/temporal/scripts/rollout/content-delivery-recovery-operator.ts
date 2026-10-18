import { Client, type Connection } from "@temporalio/client";
import type { KubeConfig } from "@kubernetes/client-node";
import { z } from "zod";
import {
  ContentRecoveryContextSchema,
  type ContentRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { deliverySelection } from "#lib/delivery/selection.ts";
import { requireExactControlPlaneSource } from "#lib/delivery/platform/control-plane.ts";
import { verifyArgoRelease } from "#lib/delivery/argocd-proof.ts";
import { closedPlatformWorkflow } from "#lib/delivery/platform/recovery/native-proof.ts";
import { deliveryDispatchBarrierEffects } from "#lib/delivery/platform/control-plane-barrier-argo.ts";
import {
  observeDeliveryPods,
  verifyDeliveryPods,
} from "#activities/delivery/runtime.ts";
import {
  applyStaticSiteDetail,
  verifyStaticSiteDetail,
} from "#activities/delivery/static-site.ts";
import {
  workerApplicationResources,
  verifyWorkerPoolPods,
} from "#lib/delivery/workers/worker-hosts.ts";
import { workerRecoveryEffects } from "#lib/delivery/workers/worker-recovery-effects.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";
import { DeliveryJobReceiptSchema } from "#shared/delivery-job.ts";
import {
  contentNativeReader,
  proveContentNativeJobs,
} from "#lib/delivery/content-recovery/native-proof.ts";
import {
  originalForumRecoveryJob,
  runForumRecoveryChild,
} from "#lib/delivery/content-recovery/forum-jobs.ts";
import { contentOwnership } from "#lib/delivery/content-recovery/ownership.ts";
import {
  contentOuterEffects,
  restoreContentDispatch,
} from "#lib/delivery/content-recovery/restoration.ts";
import { executeContentRecovery } from "#lib/delivery/content-recovery/execute.ts";
import {
  ContentOperatorError,
  type ContentAction,
} from "#lib/delivery/content-recovery/request.ts";

/** Foreground operator capability only; never registered on a worker or Workflow. */
export async function recoverContentWithOperator(
  id: string,
  action: ContentAction,
  runtime: {
    kubernetes: KubeConfig;
    connection: Connection;
    command: RolloutCommandRunner;
    signal: AbortSignal;
  },
) {
  const base = `content-recovery/${encodeURIComponent(id)}`;
  const load = async () =>
    await deliveryRequest(base, ContentRecoveryContextSchema);
  const read = contentNativeReader(runtime.kubernetes);
  const client = new Client({
    connection: runtime.connection,
    namespace: "prod",
  });
  const paused = async () => {
    const schedule = await client.schedule
      .getHandle("delivery-dispatch")
      .describe();
    if (
      !schedule.state.paused ||
      schedule.info.runningActions.length > 0 ||
      schedule.action.workflowType !== "deliveryDispatchWorkflow" ||
      schedule.action.taskQueue !== TASK_QUEUES.DELIVERY_WORKFLOWS
    )
      throw new Error(
        "Pause the Delivery dispatch Schedule and wait for its running actions to finish before operator recovery",
      );
    for await (const _open of client.workflow.list({
      query: `ExecutionStatus = 'Running' AND TaskQueue = '${TASK_QUEUES.DELIVERY_WORKFLOWS}'`,
      pageSize: 100,
    })) {
      throw new Error(
        "Wait for or explicitly settle open Delivery Workflows before operator recovery",
      );
    }
  };
  const fence = async (
    context: ContentRecoveryContext,
    activeUIDs: string[] = [],
  ) => {
    await paused();
    await closedPlatformWorkflow(
      runtime.connection,
      context.deployment.deployment.id,
    );
    await proveContentNativeJobs(context, read, activeUIDs);
  };
  const ownership = async (
    context: ContentRecoveryContext,
    activeUIDs: string[] = [],
  ) =>
    await contentOwnership(context, runtime.connection, read, {
      barrier: contentOuterEffects(context),
      activeUIDs,
    });
  const backend = async (context: ContentRecoveryContext, forumWeb = true) => {
    const detail = context.deployment,
      policy = detail.pipeline.definition;
    if (policy.kind !== "argocd") return;
    const selected = deliverySelection(detail);
    const native = await argoApplicationRequest(policy.application);
    requireExactControlPlaneSource(native, selected.selection);
    z.object({ operation: z.null().optional() }).parse(native);
    if (policy.scoutSite !== undefined) {
      verifyArgoRelease(native, selected.selection, selected.operationId);
      await observeDeliveryPods(detail, argoApplicationRequest);
      const pool = detail.deployment.workerSnapshot;
      if (pool === null)
        throw new Error(
          "Scout content recovery lacks its exact frozen worker pool; use specialized worker recovery",
        );
      const worker = workerRecoveryEffects({
        connection: runtime.connection,
        kubernetes: runtime.kubernetes,
        readArgo: argoApplicationRequest,
        pollerRunner: runtime.command,
      });
      const routes = await worker.routes(pool);
      if (
        routes.some((route) => route.currentBuildId !== pool.candidateBuildId)
      )
        throw new Error(
          "Scout worker routing is incomplete; use specialized worker recovery before frontend repair",
        );
      verifyWorkerPoolPods(
        await workerApplicationResources(
          policy.application,
          "Pod",
          argoApplicationRequest,
        ),
        pool,
      );
      await worker.pollers(pool);
    } else if (forumWeb && policy.forumRelease !== undefined) {
      const pods = await workerApplicationResources(
        policy.application,
        "Pod",
        argoApplicationRequest,
      );
      const web = pods.filter(
        (value) =>
          z
            .object({
              metadata: z.object({
                labels: z.record(z.string(), z.string()).default({}),
              }),
            })
            .parse(value).metadata.labels["component"] === "web",
      );
      const image =
        detail.versionSet.components[policy.forumRelease.imageComponent];
      if (image?.kind !== "image")
        throw new Error("Forum candidate image is missing");
      try {
        verifyDeliveryPods(web, [image]);
      } catch {
        throw new ContentOperatorError(
          `Forum database is repaired but its exact candidate web Deployment is not ready. With the same frozen source still selected, run toolkit argocd app sync ${policy.application} --revision ${selected.selection.revision} --resource apps:Deployment:storm-forum-web (no prune), then rerun this SAME recovery intent.`,
        );
      }
    }
  };
  const forum = async (
    context: ContentRecoveryContext,
    requested: ContentAction,
  ) => {
    const original = await originalForumRecoveryJob(
      context,
      runtime.kubernetes,
      runtime.command,
    );
    const attempt =
      context.intent.nativeReceipts.filter(
        (value) => value.action !== "original",
      ).length + 1;
    const result = z
      .object({
        intentId: z.literal(id),
        settled: z.boolean(),
        phase: z.enum([
          "prepared",
          "maintenance",
          "snapshot",
          "ready",
          "mutating",
          "verified",
          "complete",
        ]),
        safeToResume: z.boolean(),
        owner: z.uuid(),
        observedAt: z.iso.datetime(),
      })
      .parse(
        await runForumRecoveryChild({
          ...original,
          intentId: id,
          action: requested,
          attempt,
          config: runtime.kubernetes,
          checkpoint: async (receipt) => {
            await deliveryRequest(`${base}/native`, z.unknown(), {
              action: requested,
              receipt,
            });
          },
          fence: async (uid) => {
            const current = await load();
            await fence(current, [uid]);
            const proof = await ownership(current, [uid]);
            if (requested === "repair")
              await deliveryRequest(`${base}/admit-repair`, z.unknown(), {
                ...proof,
                activeRepairJobUIDs: [uid],
              });
          },
        }),
      );
    if (
      requested === "inspect" &&
      (!result.settled || Date.now() - Date.parse(result.observedAt) > 60_000)
    )
      throw new ContentOperatorError(
        `Forum journal is ${result.phase}; ${result.safeToResume ? "use repair for the same approved candidate" : "retain original backup/owner for reviewed native migration inspection"}`,
      );
  };
  return await executeContentRecovery(id, action, {
    paused,
    original: async (context) => {
      if (context.intent.targetKind === "forum") {
        const original = await originalForumRecoveryJob(
          context,
          runtime.kubernetes,
          runtime.command,
        );
        await deliveryRequest(`${base}/native`, z.unknown(), {
          action: "original",
          receipt: original.receipt,
        });
      }
      for (const stage of context.deployment.stages.filter(
        (value) =>
          value.key.startsWith("worker-") && value.message.startsWith("{"),
      )) {
        const receipt = DeliveryJobReceiptSchema.parse(
          JSON.parse(stage.message),
        );
        if (receipt.namespace !== "delivery-worker-jobs")
          throw new Error("Worker native stage namespace changed");
        await deliveryRequest(`${base}/native`, z.unknown(), {
          action: "original",
          receipt,
        });
      }
    },
    fence: async (context) => {
      await fence(context);
    },
    barrier: (context, checkpoint, check) =>
      deliveryDispatchBarrierEffects(
        context.deployment.deployment.id,
        undefined,
        check,
        checkpoint,
      ),
    ownership: async (context) => await ownership(context),
    repair: async (context) => {
      await backend(context, false);
      if (context.intent.targetKind === "forum") await forum(context, "repair");
      else {
        await deliveryRequest(`${base}/admit-repair`, z.unknown(), {
          ...(await ownership(context)),
          activeRepairJobUIDs: [],
        });
        await applyStaticSiteDetail(context.deployment, {
          signal: runtime.signal,
          heartbeat: () => {
            /* Foreground CLI awaits every bounded operation. */
          },
        });
      }
    },
    inspect: async (context) => {
      await backend(context);
      if (context.intent.targetKind === "forum")
        await forum(context, "inspect");
      else
        await verifyStaticSiteDetail(context.deployment, {
          signal: runtime.signal,
          heartbeat: () => {
            /* Foreground CLI awaits every bounded operation. */
          },
        });
      await backend(await load());
      return { observedAt: new Date().toISOString() };
    },
    restore: async (context) => {
      await restoreContentDispatch(context, runtime.connection, read);
    },
  });
}
