import { z } from "zod";
import type {
  PlatformRecoveryContext,
  ArtifactVersion,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { verifyArgoRelease } from "#lib/delivery/argocd-proof.ts";
import {
  controlPlaneJobInput,
  controlPlaneSelections,
  requireExactControlPlaneSource,
} from "#lib/delivery/platform/control-plane.ts";
import {
  controlPlaneTemplates,
  requireUnchangedControlPlane,
  requireControlPlanePodCoverage,
  requireControlPlaneReplicas,
} from "#lib/delivery/workers/worker-control-plane.ts";
import { verifyControlPlaneArtifactPods } from "#lib/delivery/workers/worker-hosts.ts";
import {
  deliverySelectionPatch,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";

export type ArgoRecoveryEffects = {
  read: (application: string) => Promise<unknown>;
  render: (input: {
    selection: DeliverySelection;
    chart: ArtifactVersion;
  }) => Promise<unknown[]>;
  workloads: () => Promise<unknown[]>;
  pods: () => Promise<unknown[]>;
};
const Settled = z.object({
  operation: z.null().optional(),
  metadata: z.object({ uid: z.string().min(1) }),
  status: z.object({
    sync: z.object({ status: z.literal("Synced") }),
    health: z.object({ status: z.literal("Healthy") }),
    operationState: z.object({
      phase: z.literal("Succeeded"),
      finishedAt: z.string().min(1),
    }),
  }),
});

/** Prior can be observed without counterfeit acceptance; desired always proves the original owned operation. */
export async function inspectControlPlaneRecovery(
  context: PlatformRecoveryContext,
  effects: ArgoRecoveryEffects,
) {
  const detail = context.deployment;
  const { prior, next, snapshot } = controlPlaneSelections(
    controlPlaneJobInput(detail),
  );
  const before = await effects.read("delivery-control-plane");
  const identity = Settled.parse(before);
  const revision = z
    .object({
      spec: z.object({ source: z.object({ targetRevision: z.string() }) }),
    })
    .parse(before).spec.source.targetRevision;
  // A same-chart image-only upgrade is distinguished by its exact complete Helm selection.
  const nextMatches = (() => {
    try {
      requireExactControlPlaneSource(before, next.selection);
      return true;
    } catch {
      return false;
    }
  })();
  const state = nextMatches ? "desired" : "prior";
  const selected = state === "desired" ? next : prior;
  if (revision !== selected.chart.version)
    throw new Error("Control-plane source is partially selected");
  requireExactControlPlaneSource(before, selected.selection);
  // Build the shared guarded CAS patch only to validate identity/ownership; recovery inspection sends no mutation.
  deliverySelectionPatch(before, selected.selection);
  const requestId = deliveryOperationId(
    `${detail.deployment.id}:control-plane`,
  );
  const operation =
    state === "desired"
      ? verifyArgoRelease(before, next.selection, requestId).operationId
      : undefined;
  const manifests = await effects.render(selected);
  requireControlPlaneReplicas(manifests, await effects.workloads());
  requireUnchangedControlPlane(
    controlPlaneTemplates(manifests),
    await effects.workloads(),
  );
  const pods = await effects.pods();
  requireControlPlanePodCoverage(manifests, pods);
  verifyControlPlaneArtifactPods(
    pods,
    state === "desired" ? snapshot.nextArtifact : snapshot.previousArtifact,
  );
  const after = await effects.read("delivery-control-plane");
  if (Settled.parse(after).metadata.uid !== identity.metadata.uid)
    throw new Error(
      "Control-plane Application incarnation changed during proof",
    );
  requireExactControlPlaneSource(after, selected.selection);
  deliverySelectionPatch(after, selected.selection);
  if (
    operation !== undefined &&
    verifyArgoRelease(after, next.selection, requestId).operationId !==
      operation
  )
    throw new Error("Owned control-plane operation changed during proof");
  if (
    canonicalJson(controlPlaneTemplates(await effects.workloads())) !==
    canonicalJson(controlPlaneTemplates(manifests))
  )
    throw new Error("Control-plane templates changed during proof");
  return {
    state,
    observedAt: new Date().toISOString(),
    proofSummary: `Independently verified ${state} dedicated control-plane source, native Application ${identity.metadata.uid}, all exact Pod templates and original runtime digests${operation === undefined ? "" : `; original owned operation ${operation}`}`,
  } as const;
}
