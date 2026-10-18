import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  ControlPlaneUpgradeSnapshotSchema,
  type ArtifactVersion,
  type PipelineDefinition,
  type RegisterEnvironment,
} from "#shared/contract.ts";
import { PlatformSourceSchema } from "#shared/platform-contract.ts";
import { artifact, type Transaction } from "#infrastructure/delivery-data.ts";
import { required } from "#infrastructure/delivery-records.ts";
import { recoveredControllerSelection } from "./recovered-selection.ts";

export const controlPlaneEnvironment = "delivery-control-plane/prod";
export function requireControlPlaneOwner(catalog: ServiceIndex) {
  if (
    catalog.catalog.deliveryDelegations?.["delivery-control-plane"] !==
    controlPlaneEnvironment
  )
    throw new DeliveryError(
      "INVALID",
      "Control-plane mutation remains owned by legacy root until its reviewed source delegation",
    );
}

export function validateControlPlaneEnvironment(
  input: RegisterEnvironment,
  pipeline: PipelineDefinition,
) {
  if (pipeline.kind !== "control-plane") return;
  if (
    input.id !== controlPlaneEnvironment ||
    input.serviceId !== "delivery-control-plane" ||
    input.application !== "delivery-control-plane" ||
    input.promotionSourceEnvironmentId !== undefined
  )
    throw new DeliveryError(
      "INVALID",
      "Control-plane pipeline requires its fixed independent service, environment and Application",
    );
}

export async function controlPlaneArtifact(
  tx: Transaction,
  artifactId: string,
  kind: "image" | "chart",
  repositoryId: number,
) {
  const selected = await artifact(tx, artifactId);
  const build = await tx.build.findUniqueOrThrow({
    where: { id: selected.buildId },
  });
  const image = kind === "image";
  const service = image ? "temporal" : "delivery-control-plane";
  const component = image
    ? "image:temporal-worker"
    : "chart:delivery-control-plane";
  const uri = image
    ? "docker.io/shepherdjerred/temporal-worker"
    : `https://chartmuseum.tailnet-1a49.ts.net/charts/delivery-control-plane-${selected.version}.tgz`;
  if (
    selected.kind !== kind ||
    selected.serviceId !== service ||
    selected.component !== component ||
    selected.uri !== uri ||
    selected.origin.kind !== "first-party" ||
    build.sourceKind !== "ci" ||
    build.repositoryId !== repositoryId
  )
    throw new DeliveryError(
      "INVALID",
      "Control-plane references must preserve their fixed original qualified chart owner or Temporal image role from the canonical repository",
    );
  return {
    artifact: selected,
    source: PlatformSourceSchema.parse({
      id: build.id,
      sourceRevision: build.sourceRevision,
      repositoryId: build.repositoryId,
      pipelineNumber: build.pipelineNumber,
      ciUrl: build.ciUrl,
    }),
  };
}

export async function previousControlPlane(
  tx: Transaction,
  input: {
    acceptedDeploymentId: string | null;
    previousImageArtifactId?: string;
    priorChartArtifactId?: string;
    repositoryId: number;
  },
) {
  const accepted =
    input.acceptedDeploymentId === null
      ? null
      : await tx.deployment.findUniqueOrThrow({
          where: { id: input.acceptedDeploymentId },
        });
  const recovered = await recoveredControllerSelection(
    tx,
    accepted?.finishedAt ?? null,
  );
  if (recovered !== null) {
    if (
      (input.previousImageArtifactId !== undefined &&
        input.previousImageArtifactId !== recovered.previousArtifact.id) ||
      (input.priorChartArtifactId !== undefined &&
        input.priorChartArtifactId !== recovered.priorChartArtifact.id)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Explicit prior controller inputs differ from independently recovered source",
      );
    return recovered;
  }
  if (input.acceptedDeploymentId !== null) {
    const prior = required(
      await tx.deployment.findUnique({
        where: { id: input.acceptedDeploymentId },
      }),
      "Accepted control-plane deployment",
    );
    if (
      prior.status !== "succeeded" ||
      prior.kind !== "upgrade-control-plane" ||
      prior.environmentId !== controlPlaneEnvironment
    )
      throw new DeliveryError(
        "CONFLICT",
        "Control-plane acceptance does not name its successful independent operation",
      );
    const snapshot = ControlPlaneUpgradeSnapshotSchema.parse(
      prior.controlPlaneSnapshot,
    );
    if (
      (input.previousImageArtifactId !== undefined &&
        input.previousImageArtifactId !== snapshot.nextArtifact.id) ||
      (input.priorChartArtifactId !== undefined &&
        input.priorChartArtifactId !== snapshot.chartArtifact.id)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Explicit prior control-plane inputs differ from current acceptance",
      );
    return {
      previousArtifact: snapshot.nextArtifact,
      priorChartArtifact: snapshot.chartArtifact,
      priorSelectionManaged: true,
    };
  }
  const previousArtifact = await controlPlaneArtifact(
    tx,
    required(
      input.previousImageArtifactId ?? null,
      "Initial original controller image",
    ),
    "image",
    input.repositoryId,
  );
  const priorChartArtifact = await controlPlaneArtifact(
    tx,
    required(
      input.priorChartArtifactId ?? null,
      "Initial original controller chart",
    ),
    "chart",
    input.repositoryId,
  );
  return {
    previousArtifact: previousArtifact.artifact,
    priorChartArtifact: priorChartArtifact.artifact,
    // The only supported first installation is the qualified-artifact bootstrap,
    // which always pins this exact image parameter. Native preflight must prove it.
    priorSelectionManaged: true,
  };
}

export function requireControlPlaneCompatibility(
  image: ArtifactVersion,
  chart: ArtifactVersion,
) {
  const selected = new Map([
    [image.component, image.digest],
    [chart.component, chart.digest],
  ]);
  for (const selectedArtifact of [image, chart])
    for (const [component, digest] of Object.entries(selectedArtifact.requires))
      if (selected.get(component) !== digest)
        throw new DeliveryError(
          "INVALID",
          "Selected controller image and chart do not satisfy their immutable artifact requirements",
        );
}
