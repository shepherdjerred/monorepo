import { Client, type Connection } from "@temporalio/client";
import type { ForumStepAcknowledgement } from "@shepherdjerred/ops-model/forum-recovery.ts";
import type { KubeConfig } from "@kubernetes/client-node";
import { z } from "zod";
import {
  ContentRecoveryContextSchema,
  type ContentRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import { stepRecipeOf } from "@shepherdjerred/delivery/model-contract";
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
import { workerHostEffects } from "#lib/delivery/workers/worker-recovery-effects.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";
import { DeliveryJobReceiptSchema } from "#shared/delivery-job.ts";
import {
  contentNativeReader,
  proveContentNativeJobs,
} from "#lib/delivery/content-recovery/native-proof.ts";
import {
  forumRecoveryRelease,
  originalForumRecoveryJob,
  runForumRecoveryChild,
} from "#lib/delivery/content-recovery/forum-jobs.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { requireRenderedSource } from "#lib/delivery/model/application-proof.ts";
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

/** The Forum's candidate web Deployment runs the frozen image (4.15). */
async function forumWebReady(
  context: ContentRecoveryContext,
  application: string,
  revision: string,
) {
  const pods = await workerApplicationResources(
    application,
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
    context.deployment.versionSet.components[
      forumRecoveryRelease(context.deployment).imageComponent
    ];
  if (image?.kind !== "image")
    throw new Error("Forum candidate image is missing");
  try {
    await verifyDeliveryPods(web, [image]);
  } catch {
    throw new ContentOperatorError(
      `Forum database is repaired but its exact candidate web Deployment is not ready. With the same frozen source still selected, run toolkit argocd app sync ${application} --revision ${revision} --resource apps:Deployment:storm-forum-web (no prune), then rerun this SAME recovery intent.`,
    );
  }
}

/**
 * A model release's content step ran only after its own Application's sync
 * settled. Forum recovery re-proves that Application still carries exactly
 * its rendered source with no operation in flight, and that the candidate
 * web Deployment runs the frozen image; a site step's bucket is its own
 * target.
 */
async function modelBackend(
  context: ContentRecoveryContext,
  forumWeb: boolean,
) {
  if (context.intent.targetKind !== "forum") return;
  const detail = context.deployment;
  const recipe = stepRecipeOf(detail.pipeline.definition, "forum-bundle");
  if (recipe === null)
    throw new Error("Forum recovery lacks its fixed native target");
  const rendered = renderApplication(detail, recipe);
  const native = await argoApplicationRequest(rendered.name);
  requireRenderedSource(native, rendered);
  z.object({ operation: z.null().optional() }).parse(native);
  if (forumWeb) await forumWebReady(context, rendered.name, rendered.revision);
}

/** Foreground operator capability only; never registered on a worker or Workflow. */
export async function recoverContentWithOperator(
  id: string,
  action: ContentAction,
  runtime: {
    kubernetes: KubeConfig;
    connection: Connection;
    command: RolloutCommandRunner;
    signal: AbortSignal;
    acknowledgement?: ForumStepAcknowledgement;
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
    if (policy.kind !== "argocd") {
      await modelBackend(context, forumWeb);
      return;
    }
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
      const worker = workerHostEffects({
        connection: runtime.connection,
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
    } else if (forumWeb && policy.forumRelease !== undefined)
      await forumWebReady(
        context,
        policy.application,
        selected.selection.revision,
      );
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
        step: z.string().nullable().optional(),
        journalSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
      })
      .parse(
        await runForumRecoveryChild({
          ...original,
          intentId: id,
          action: requested,
          ...(requested === "repair" && runtime.acknowledgement !== undefined
            ? { acknowledgement: runtime.acknowledgement }
            : {}),
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
        `Forum journal is ${result.phase}, step ${result.step ?? "none"}, SHA256 ${result.journalSha256 ?? "unavailable"}; ${result.safeToResume ? "use repair for the same approved candidate" : "retain original backup/owner for reviewed native migration inspection; acknowledge only independently completed steps"}`,
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
      if (
        runtime.acknowledgement !== undefined &&
        context.intent.targetKind !== "forum"
      )
        throw new Error("Step acknowledgement is only supported for Forum");
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
