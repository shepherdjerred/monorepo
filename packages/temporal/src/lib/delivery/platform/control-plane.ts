import { z } from "zod";
import {
  ControlPlaneUpgradeSnapshotSchema,
  ControlPlaneAcceptanceSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  DeliverySelectionSchema,
  deliverySelectionPatch,
  assertDeliveryRootPreservesSelection,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { verifyArgoRelease } from "#lib/delivery/argocd-proof.ts";
import {
  controlPlaneTemplates,
  requireUnchangedControlPlane,
  requireControlPlanePodCoverage,
  requireControlPlaneReplicas,
} from "#lib/delivery/workers/worker-control-plane.ts";
import { verifyControlPlaneArtifactPods } from "#lib/delivery/workers/worker-hosts.ts";

export const ControlPlaneJobInputSchema = z.strictObject({
  deploymentId: z.string().min(1),
  snapshot: ControlPlaneUpgradeSnapshotSchema,
  configuration: z.record(z.string(), z.string()),
});
export function controlPlaneJobInput(detail: DeploymentDetail) {
  if (
    detail.pipeline.definition.kind !== "control-plane" ||
    detail.deployment.environmentId !== "delivery-control-plane/prod"
  )
    throw new Error("Missing dedicated control-plane pipeline/environment");
  return ControlPlaneJobInputSchema.parse({
    deploymentId: detail.deployment.id,
    snapshot: detail.deployment.controlPlaneSnapshot,
    configuration: detail.deployment.configuration,
  });
}
export function controlPlaneSelections(
  input: z.infer<typeof ControlPlaneJobInputSchema>,
) {
  const { snapshot } = input;
  const selected = (prior: boolean) => {
    const image = prior ? snapshot.previousArtifact : snapshot.nextArtifact;
    const chart = prior ? snapshot.priorChartArtifact : snapshot.chartArtifact;
    const selection = DeliverySelectionSchema.parse({
      application: "delivery-control-plane",
      environmentId: "delivery-control-plane/prod",
      repository: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "delivery-control-plane",
      revision: chart.version,
      namespace: "temporal",
      parameters: {
        ...input.configuration,
        ...(prior && !snapshot.priorSelectionManaged
          ? {}
          : {
              "delivery.images.delivery-control-plane": `${image.uri}:${image.version}@${image.digest}`,
            }),
      },
    });
    if (
      chart.uri !==
      `https://chartmuseum.tailnet-1a49.ts.net/charts/delivery-control-plane-${chart.version}.tgz`
    )
      throw new Error(
        "Control-plane chart URI differs from its frozen owner/version",
      );
    return { selection, chart };
  };
  return { prior: selected(true), next: selected(false), snapshot };
}

export type ControlPlaneEffects = {
  quiesce: () => Promise<void>;
  assertQuiescent: () => Promise<void>;
  replay: () => Promise<void>;
  fence: (input: z.infer<typeof ControlPlaneJobInputSchema>) => Promise<void>;
  render: (
    input: ReturnType<typeof controlPlaneSelections>["prior"],
  ) => Promise<unknown[]>;
  read: (application: string) => Promise<unknown>;
  workloads: () => Promise<unknown[]>;
  pods: () => Promise<unknown[]>;
  patch: (application: string, patch: unknown) => Promise<void>;
  sync: (selection: DeliverySelection, operationId: string) => Promise<void>;
};

export function requireExactControlPlaneSource(
  input: unknown,
  selection: DeliverySelection,
) {
  const source = z
    .object({
      spec: z.object({
        source: z
          .object({
            repoURL: z.string(),
            chart: z.string(),
            targetRevision: z.string(),
            helm: z
              .object({
                parameters: z
                  .array(
                    z.object({
                      name: z.string(),
                      value: z.string(),
                      forceString: z.literal(true),
                    }),
                  )
                  .default([]),
              })
              .strict()
              .optional(),
          })
          .strict(),
      }),
    })
    .parse(input).spec.source;
  if (
    source.repoURL !== selection.repository ||
    source.chart !== selection.chart ||
    source.targetRevision !== selection.revision ||
    canonicalJson(
      Object.fromEntries(
        (source.helm?.parameters ?? []).map(({ name, value }) => [name, value]),
      ),
    ) !== canonicalJson(selection.parameters)
  )
    throw new Error(
      "Prior control-plane source differs from its frozen exact selection",
    );
}

function isolatedChart(manifests: unknown[]) {
  const kinds = manifests.map(
    (input) => z.object({ kind: z.string() }).parse(input).kind,
  );
  if (
    kinds.some((kind) =>
      ["Pod", "Job", "CronJob", "DaemonSet"].includes(kind),
    ) ||
    controlPlaneTemplates(manifests).length !==
      kinds.filter((kind) => ["Deployment", "StatefulSet"].includes(kind))
        .length
  )
    throw new Error(
      "Control-plane chart contains workloads belonging to another application",
    );
}

/** The native Job survives replacement of its own Activity worker; no ordinary app is selected. */
export async function runControlPlaneUpgrade(
  raw: unknown,
  effects: ControlPlaneEffects,
  nativeJobUID: string,
) {
  const input = ControlPlaneJobInputSchema.parse(raw);
  const { prior, next, snapshot } = controlPlaneSelections(input);
  const [beforeManifests, afterManifests] = await Promise.all([
    effects.render(prior),
    effects.render(next),
  ]);
  isolatedChart(beforeManifests);
  isolatedChart(afterManifests);
  await effects.fence(input);
  assertDeliveryRootPreservesSelection(await effects.read("apps"));
  requireExactControlPlaneSource(
    await effects.read("delivery-control-plane"),
    prior.selection,
  );
  const beforeWorkloads = await effects.workloads();
  requireUnchangedControlPlane(
    controlPlaneTemplates(beforeManifests),
    beforeWorkloads,
  );
  requireControlPlaneReplicas(beforeManifests, beforeWorkloads);
  const previousPods = await effects.pods();
  requireControlPlanePodCoverage(beforeManifests, previousPods);
  verifyControlPlaneArtifactPods(previousPods, snapshot.previousArtifact);
  await effects.quiesce();
  await effects.replay();
  await effects.fence(input);
  const pausedWorkloads = await effects.workloads();
  requireUnchangedControlPlane(
    controlPlaneTemplates(beforeManifests),
    pausedWorkloads,
  );
  requireControlPlaneReplicas(beforeManifests, pausedWorkloads, true);
  const current = await effects.read("delivery-control-plane");
  requireExactControlPlaneSource(current, prior.selection);
  await effects.assertQuiescent();
  const operationId = deliveryOperationId(
    `${input.deploymentId}:control-plane`,
  );
  await effects.patch(
    "delivery-control-plane",
    deliverySelectionPatch(current, next.selection),
  );
  await effects.sync(next.selection, operationId);
  const owned = verifyArgoRelease(
    await effects.read("delivery-control-plane"),
    next.selection,
    operationId,
  );
  const afterWorkloads = await effects.workloads();
  requireUnchangedControlPlane(
    controlPlaneTemplates(afterManifests),
    afterWorkloads,
  );
  requireControlPlaneReplicas(afterManifests, afterWorkloads);
  const pods = await effects.pods();
  requireControlPlanePodCoverage(afterManifests, pods);
  verifyControlPlaneArtifactPods(pods, snapshot.nextArtifact);
  await effects.fence(input);
  return ControlPlaneAcceptanceSchema.parse({
    adapter: "control-plane",
    previousArtifactId: snapshot.previousArtifact.id,
    nextArtifactId: snapshot.nextArtifact.id,
    chartArtifactId: snapshot.chartArtifact.id,
    nativeJobUID,
    argoRequestId: operationId,
    argoOperationId: owned.operationId,
  });
}
