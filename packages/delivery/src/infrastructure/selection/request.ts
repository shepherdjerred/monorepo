import type { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import {
  CreateDeploymentSchema,
  PipelineRevisionSchema,
  WorkerPoolSnapshotSchema,
  type DeploymentDetail,
  type Environment,
} from "#shared/contract.ts";
import { CreateDeploymentV2Schema } from "#shared/deployment-request-contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  configurationRevision,
  environment,
  version,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { required, wire } from "#infrastructure/delivery-records.ts";
import type { FrozenSelection } from "./selection.ts";

export type DeploymentRequest =
  | z.input<typeof CreateDeploymentV2Schema>
  | z.input<typeof CreateDeploymentSchema>;

export type AdoptionRequest = z.infer<typeof CreateDeploymentSchema>;
export type ModelRequest = z.infer<typeof CreateDeploymentV2Schema>;
export type ParsedRequest = AdoptionRequest | ModelRequest;

/** Host-only worker adoption keeps its v1 shape; every other kind is a model request (4.12). */
export function parseDeploymentRequest(
  raw: DeploymentRequest,
):
  | { adoption: AdoptionRequest; model: null }
  | { adoption: null; model: ModelRequest } {
  return raw.kind === "adopt-worker"
    ? { adoption: CreateDeploymentSchema.parse(raw), model: null }
    : { adoption: null, model: CreateDeploymentV2Schema.parse(raw) };
}

/** The set revision a request will run, when it can be known before the transaction. */
export async function candidateSetRevision(
  this: Delivery,
  input: ParsedRequest,
): Promise<string | undefined> {
  if (input.kind === "deploy" || input.kind === "adopt-worker")
    return input.versionSetRevisionId;
  if (input.kind !== "promote" || input.sourceEnvironmentId === undefined)
    return undefined;
  const source = await environment(this.database, input.sourceEnvironmentId);
  if (source.acceptedDeploymentId === null) return undefined;
  const accepted = await this.database.deployment.findUnique({
    where: { id: source.acceptedDeploymentId },
  });
  return accepted?.versionSetRevisionId;
}

/** Selection for host-only adoption: the named set under the declared binding. */
export async function adoptionSelection(
  tx: Transaction,
  input: AdoptionRequest,
  env: Environment,
): Promise<FrozenSelection> {
  return {
    versionSet: await version(tx, input.versionSetRevisionId),
    pipeline: PipelineRevisionSchema.parse(
      wire(
        required(
          await tx.pipeline.findUnique({
            where: { id: env.pipelineRevisionId },
          }),
          "Recipe",
        ),
      ),
    ),
    configuration: await configurationRevision(tx, env.declaredConfigurationId),
    restoredDeploymentId: null,
    sourceEnvironmentId: null,
    ineligible: [],
  };
}

/** Pre-cutover platform pipelines run only through their typed requests. */
export function refuseLegacyPlatform(selection: FrozenSelection) {
  const definition = selection.pipeline.definition;
  if (
    definition.kind === "root-release" ||
    definition.kind === "control-plane" ||
    (definition.kind === "tofu" && "runnerImage" in definition)
  )
    throw new DeliveryError(
      "INVALID",
      "Specialized control-plane and platform pipelines require their exact typed source, artifact, inventory or saved-plan request",
    );
}

/** A non-eligible deploy needs an approval marked override (H4); an eligible one never asks. */
export function requireEligibleOrOverride(
  input: ParsedRequest,
  selection: FrozenSelection,
) {
  const override = "override" in input && input.override;
  if (!override && selection.ineligible.length > 0)
    throw new DeliveryError(
      "INVALID",
      `Set revision is not eligible: ${selection.ineligible.join("; ")}; a deploy may ask for an override approval`,
    );
  if (override && selection.ineligible.length === 0)
    throw new DeliveryError(
      "INVALID",
      "The set revision is eligible; an override approval is only for a non-eligible deploy",
    );
  return override;
}

export async function requireIdleEnvironment(
  tx: Transaction,
  env: Environment,
  expectedGeneration: number,
) {
  if (env.generation !== expectedGeneration)
    throw new DeliveryError(
      "CONFLICT",
      "Environment generation changed; inspect current state before retrying",
    );
  if (env.activeDeploymentId !== null)
    throw new DeliveryError(
      "CONFLICT",
      "Environment already has an active deployment",
    );
  const pending = await tx.deployment.findFirst({
    where: {
      environmentId: env.id,
      status: { in: ["queued", "awaiting_approval"] },
    },
  });
  if (pending !== null)
    throw new DeliveryError(
      "CONFLICT",
      "Environment already has a pending deployment; cancel it before selecting another revision",
    );
}

/** The worker pool a rollback restores comes from the restored selection's snapshot. */
export async function restoredWorkerSnapshot(
  tx: Transaction,
  restoredDeploymentId: string | null,
) {
  if (restoredDeploymentId === null) return;
  const restored = await tx.deployment.findUniqueOrThrow({
    where: { id: restoredDeploymentId },
  });
  return restored.workerSnapshot === null
    ? undefined
    : {
        deploymentId: restored.id,
        snapshot: WorkerPoolSnapshotSchema.parse(restored.workerSnapshot),
      };
}

/** The same request again under fresh inputs: a retry re-selects, never replays (E2). */
export function retryRequest(detail: DeploymentDetail) {
  const environmentId = detail.environment.id;
  const deployment = detail.deployment;
  switch (deployment.kind) {
    case "deploy":
    case "channel-publish":
    case "operator-run":
      return {
        environmentId,
        kind: deployment.kind,
        versionSetRevisionId: detail.versionSet.id,
      };
    case "promote":
      return {
        environmentId,
        kind: deployment.kind,
        sourceEnvironmentId: required(
          deployment.sourceEnvironmentId,
          "Promotion source",
        ),
      };
    case "rollback":
      return {
        environmentId,
        kind: deployment.kind,
        selectionDeploymentId: required(
          deployment.restoredDeploymentId,
          "Restored deployment",
        ),
      };
    case "rebind":
      return {
        environmentId,
        kind: deployment.kind,
        recipeRevisionId: deployment.pipelineRevisionId,
        configurationRevisionId: deployment.configurationId,
      };
    case "retire-host":
    case "adopt-worker":
    case "repair-trmnl":
    case "upgrade-control-plane":
    case "root-release":
    case "tofu-plan":
    case "tofu-apply":
      throw new DeliveryError(
        "INVALID",
        "Request a new specialized deployment with exact fresh inputs",
      );
  }
}
