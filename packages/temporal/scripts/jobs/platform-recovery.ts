import { Connection } from "@temporalio/client";
import { KubeConfig } from "@kubernetes/client-node";
import path from "node:path";
import { z } from "zod";
import { PlatformRecoveryContextSchema } from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliverySelectionPatch } from "homelab/scripts/argocd/argocd-delivery.ts";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  DeliveryJobReceiptSchema,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";
import {
  RecoveryJobInputSchema,
  recoveryExecutionJob,
} from "#lib/delivery/platform/recovery/request.ts";
import {
  closedPlatformWorkflow,
  provePlatformNativeJobs,
} from "#lib/delivery/platform/recovery/native-proof.ts";
import { recoveryJobReader } from "#lib/delivery/workers/worker-recovery-jobs.ts";
import { runTofuRecovery } from "#lib/delivery/platform/recovery/tofu.ts";
import { inspectRootRecovery } from "#lib/delivery/platform/recovery-root.ts";
import { inspectControlPlaneRecovery } from "#lib/delivery/platform/recovery/target-argo.ts";
import { platformExecutionJob } from "#lib/delivery/platform/job-request.ts";
import {
  controlPlaneSelections,
  controlPlaneJobInput,
  requireExactControlPlaneSource,
} from "#lib/delivery/platform/control-plane.ts";
import { renderWorkerChart } from "#lib/delivery/workers/worker-control-plane.ts";
import { workerApplicationResources } from "#lib/delivery/workers/worker-hosts.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { run as runRootRelease } from "./root-release.ts";
import { controlPlaneCommand } from "./control-plane.ts";
import {
  deliveryDispatchBarrierEffects,
  recordedDispatchBarrier,
} from "#lib/delivery/platform/control-plane-barrier-argo.ts";
import { restoreDeliveryDispatch } from "#lib/delivery/platform/control-plane-barrier.ts";

/** This source-owned recipe is the only provider child with the readonly recovery-inspector token. */
export async function run(request: DeliveryJobRequest) {
  const input = RecoveryJobInputSchema.parse(request.input);
  const base = `platform-recovery/${encodeURIComponent(input.intentId)}`;
  const load = async () =>
    await deliveryRequest(base, PlatformRecoveryContextSchema);
  let context = await load();
  const expected = recoveryExecutionJob(context, {
    intent: context.intent,
    action: input.action,
    attempt: input.attempt,
  });
  if (
    context.intent.status !== "pending" ||
    canonicalJson(request) !== canonicalJson(expected)
  )
    throw new Error(
      "Recovery Job differs from the pending immutable quarantine intent",
    );
  const native = DeliveryJobReceiptSchema.parse({
    namespace: "delivery-platform-jobs",
    name: Bun.env["DELIVERY_JOB_NAME"],
    uid: z.uuid().parse(Bun.env["DELIVERY_JOB_UID"]),
    specFingerprint: Bun.env["DELIVERY_JOB_FINGERPRINT"],
    requestId: input.intentId,
  });
  await deliveryRequest(`${base}/native`, z.unknown(), {
    action: input.action,
    receipt: native,
  });
  context = await load();
  const kubernetes = new KubeConfig();
  kubernetes.loadFromCluster();
  const read = recoveryJobReader(kubernetes, "delivery-platform-jobs");
  const connection = await Connection.connect({
    address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    connectTimeout: "10 seconds",
  });
  try {
    const fence = async () => {
      const current = await load();
      const sourceWorkflow = await closedPlatformWorkflow(
        connection,
        current.deployment.deployment.id,
      );
      const nativeJobs = await provePlatformNativeJobs(
        current,
        read,
        native.uid,
      );
      await deliveryRequest(`${base}/admit-apply`, z.unknown(), {
        expectedEnvironmentGeneration:
          current.intent.expectedEnvironmentGeneration,
        snapshotFingerprint: current.intent.snapshotFingerprint,
        observedAt: new Date().toISOString(),
        sourceWorkflow,
        nativeJobs,
        ...(current.intent.planFingerprint === null
          ? {}
          : { planFingerprint: current.intent.planFingerprint }),
      });
    };
    // Even read-only recovery planning must not overlap a still executing original producer.
    await closedPlatformWorkflow(connection, context.deployment.deployment.id);
    await provePlatformNativeJobs(context, read, native.uid);
    if (input.target === "tofu")
      return await runTofuRecovery(context, input.action, native, fence);
    if (input.action === "plan")
      throw new Error("Only OpenTofu has a recovery saved-plan action");
    if (input.action === "apply") {
      if (input.target === "root-release")
        await runRootRelease(platformExecutionJob(context.deployment), fence);
      else {
        const selected = await controlPlaneRecoverySelection(
          context,
          native,
          fence,
        );
        await fence();
        await controlPlaneCommand([
          "bun",
          "--no-install",
          path.resolve(
            import.meta.dirname,
            "../../../homelab/scripts/argocd/argocd.ts",
          ),
          "sync-managed",
          "delivery-control-plane",
          "--revision",
          selected.selection.revision,
          "--request-id",
          deliveryOperationId(
            `${context.deployment.deployment.id}:control-plane`,
          ),
          "--timeout",
          "1200",
        ]);
      }
    }
    const render = async (selected: Parameters<typeof renderWorkerChart>[0]) =>
      await renderWorkerChart(selected, controlPlaneCommand);
    if (input.target === "root-release")
      return await inspectRootRecovery(context, {
        read: argoApplicationRequest,
        render: async (chart) =>
          await render({
            chart,
            selection: {
              application: "apps",
              environmentId: context.deployment.environment.id,
              repository: "https://chartmuseum.tailnet-1a49.ts.net",
              chart: "apps",
              revision: chart.version,
              namespace: "argocd",
              parameters: {},
            },
          }),
      });
    return await inspectControlPlaneRecovery(context, {
      read: argoApplicationRequest,
      render,
      workloads: async () => {
        const resources = await Promise.all(
          (["Deployment", "StatefulSet"] as const).map(
            async (kind) =>
              await workerApplicationResources(
                "delivery-control-plane",
                kind,
                argoApplicationRequest,
              ),
          ),
        );
        return resources.flat();
      },
      pods: async () =>
        await workerApplicationResources(
          "delivery-control-plane",
          "Pod",
          argoApplicationRequest,
        ),
    });
  } finally {
    await connection.close();
  }
}
async function controlPlaneRecoverySelection(
  context: z.infer<typeof PlatformRecoveryContextSchema>,
  native: z.infer<typeof DeliveryJobReceiptSchema>,
  fence: () => Promise<void>,
) {
  const { next, prior } = controlPlaneSelections(
    controlPlaneJobInput(context.deployment),
  );
  const current = await argoApplicationRequest("delivery-control-plane");
  try {
    requireExactControlPlaneSource(current, next.selection);
    return next;
  } catch {
    requireExactControlPlaneSource(current, prior.selection);
  }
  deliverySelectionPatch(current, prior.selection);
  const guarded = async () => {
    await fence();
    const source = await argoApplicationRequest("delivery-control-plane");
    requireExactControlPlaneSource(source, prior.selection);
    deliverySelectionPatch(source, prior.selection);
  };
  const barrier = deliveryDispatchBarrierEffects(
    context.deployment.deployment.id,
    native,
    guarded,
  );
  const journal = recordedDispatchBarrier(context.deployment);
  if (journal === undefined) {
    const host = z
      .object({ spec: z.object({ replicas: z.literal(1) }) })
      .safeParse(await barrier.read());
    if (!host.success)
      throw new Error(
        "Stopped prior host lacks its original dispatch barrier journal",
      );
  } else await restoreDeliveryDispatch(barrier, journal);
  return prior;
}
