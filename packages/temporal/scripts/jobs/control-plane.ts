import path from "node:path";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  runControlPlaneUpgrade,
  ControlPlaneJobInputSchema,
} from "#lib/delivery/platform/control-plane.ts";
import { renderWorkerChart } from "#lib/delivery/workers/worker-control-plane.ts";
import { workerApplicationResources } from "#lib/delivery/workers/worker-hosts.ts";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { admitPlatformNativeJob } from "#lib/delivery/platform/native-job.ts";
import { verifyControlPlaneImageCompatibility } from "#lib/delivery/platform/control-plane-image.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";
import { createTemporalReadClient } from "#client";
import {
  deliveryWorkflowId,
  DeploymentDetailSchema,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  pauseDeliveryDispatch,
  restoreDeliveryDispatch,
  assertDeliveryDispatchPaused,
  type DispatchBarrier,
} from "#lib/delivery/platform/control-plane-barrier.ts";
import {
  deliveryDispatchBarrierEffects,
  recordedDispatchBarrier,
} from "#lib/delivery/platform/control-plane-barrier-argo.ts";
import {
  controlPlaneSelections,
  requireExactControlPlaneSource,
} from "#lib/delivery/platform/control-plane.ts";
import { requireControlPlaneQueueQuiescence } from "#lib/delivery/platform/control-plane-history.ts";
import { requireFreshControlPlaneReplay } from "#lib/delivery/platform/control-plane-history.ts";
import { deliverySelectionPatch } from "homelab/scripts/argocd/argocd-delivery.ts";
import { replayControlPlaneCandidate } from "./control-plane-replay.ts";

export async function controlPlaneCommand(argv: readonly string[]) {
  const child = Bun.spawn([...argv], {
    env: {
      PATH: Bun.env["PATH"],
      HOME: Bun.env["HOME"],
      TMPDIR: Bun.env["TMPDIR"],
      DOCKER_CONFIG: Bun.env["DOCKER_CONFIG"],
      ...(argv.includes("sync-managed")
        ? {
            ARGOCD_TOKEN: Bun.env["ARGOCD_TOKEN"],
            ARGOCD_SERVER_URL: Bun.env["ARGOCD_SERVER_URL"],
          }
        : {}),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of child.stdout) {
    size += chunk.byteLength;
    if (size > 4 * 1024 * 1024) {
      child.kill("SIGKILL");
      await child.exited;
      throw new Error("Control-plane command exceeded its bounded output");
    }
    chunks.push(chunk);
  }
  if ((await child.exited) !== 0)
    throw new Error(
      "Guarded control-plane proof/synchronization command failed; retain native ownership",
    );
  return { stdout: Buffer.concat(chunks).toString("utf8"), stderr: "" };
}

export async function run(request: DeliveryJobRequest) {
  const frozen = ControlPlaneJobInputSchema.parse(request.input);
  const snapshot = frozen.snapshot;
  if (
    snapshot.source.sourceRevision !== request.sourceRevision ||
    frozen.deploymentId !== request.deploymentId
  )
    throw new Error(
      "Control-plane native Job differs from its frozen exact source",
    );
  const native = await admitPlatformNativeJob(request);
  await verifyControlPlaneImageCompatibility(snapshot, controlPlaneCommand);
  const temporal = await createTemporalReadClient("prod");
  const workflowId = deliveryWorkflowId(request.deploymentId);
  const own = await temporal.workflow.getHandle(workflowId).describe();
  const execution = {
    deploymentId: request.deploymentId,
    workflowId,
    runId: own.runId,
  };
  const nativeFence = async () => {
    const current = await admitPlatformNativeJob(request);
    if (canonicalJson(current) !== canonicalJson(native))
      throw new Error("Control-plane Job native UID/fingerprint changed");
  };
  const fence = async () => {
    await nativeFence();
    await requireControlPlaneQueueQuiescence(temporal, execution);
  };
  const barrier = deliveryDispatchBarrierEffects(
    request.deploymentId,
    native,
    nativeFence,
  );
  let journal: DispatchBarrier | undefined;
  let replay:
    Awaited<ReturnType<typeof replayControlPlaneCandidate>> | undefined;
  try {
    return await runControlPlaneUpgrade(
      frozen,
      {
        quiesce: async () => {
          journal = await pauseDeliveryDispatch(barrier);
        },
        assertQuiescent: async () => {
          if (journal === undefined)
            throw new Error(
              "Control-plane replacement lacks its owned dispatch barrier",
            );
          await assertDeliveryDispatchPaused(barrier, journal);
          if (replay === undefined)
            throw new Error("Missing exact-history replay receipt");
          await requireFreshControlPlaneReplay(temporal, execution, replay);
        },
        replay: async () => {
          await requireControlPlaneQueueQuiescence(temporal, execution);
          replay = await replayControlPlaneCandidate(snapshot, execution);
          await deliveryRequest(
            `deployments/${encodeURIComponent(request.deploymentId)}/stages`,
            z.unknown(),
            {
              key: "control-plane",
              status: "running",
              operationId: native.name,
              message: JSON.stringify(native),
              evidence: [
                {
                  kind: "preflight",
                  operationId: native.uid,
                  summary: JSON.stringify({
                    adapter: "control-plane-history-replay/v1",
                    ...replay,
                    workflowId,
                    imageArtifactId: snapshot.nextArtifact.id,
                    imageDigest: snapshot.nextArtifact.digest,
                    imageSourceRevision: snapshot.nextArtifact.sourceRevision,
                  }),
                },
              ],
            },
          );
        },
        fence,
        render: async (input) =>
          await renderWorkerChart(input, controlPlaneCommand),
        read: argoApplicationRequest,
        workloads: async () => {
          const resources = await Promise.all([
            workerApplicationResources(
              "delivery-control-plane",
              "Deployment",
              argoApplicationRequest,
            ),
            workerApplicationResources(
              "delivery-control-plane",
              "StatefulSet",
              argoApplicationRequest,
            ),
          ]);
          return resources.flat();
        },
        pods: async () =>
          await workerApplicationResources(
            "delivery-control-plane",
            "Pod",
            argoApplicationRequest,
          ),
        async patch(application, patch) {
          await argoApplicationRequest(application, {
            patch: JSON.stringify(patch),
            patchType: "json",
          });
        },
        async sync(selection, operationId) {
          await controlPlaneCommand([
            "bun",
            "--no-install",
            path.resolve(
              import.meta.dirname,
              "../../../homelab/scripts/argocd/argocd.ts",
            ),
            "sync-managed",
            selection.application,
            "--revision",
            selection.revision,
            "--request-id",
            operationId,
            "--timeout",
            "1200",
          ]);
        },
      },
      native.uid,
    );
  } catch (error) {
    const { prior } = controlPlaneSelections(frozen);
    const current = await argoApplicationRequest("delivery-control-plane");
    let priorStillSelected = false;
    try {
      requireExactControlPlaneSource(current, prior.selection);
      deliverySelectionPatch(current, prior.selection);
      priorStillSelected = true;
    } catch {
      /* A changed or ambiguous source keeps quarantine ownership. */
    }
    if (priorStillSelected) {
      const detail = await deliveryRequest(
        `deployments/${encodeURIComponent(request.deploymentId)}`,
        DeploymentDetailSchema,
      );
      const recorded = recordedDispatchBarrier(detail);
      if (recorded !== undefined)
        await restoreDeliveryDispatch(barrier, recorded);
    }
    throw error;
  }
}
