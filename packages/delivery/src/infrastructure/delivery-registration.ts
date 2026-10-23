import { DeliveryError } from "#domain/error.ts";
import {
  LegacyPipelineRevisionSchema,
  PipelineRevisionSchema,
  PublishBuildSchema,
  RegisterEnvironmentSchema,
} from "#shared/contract.ts";
import type {
  ComposeVersionSet,
  PipelineDefinition,
  Principal,
  PublishBuild,
  RegisterEnvironmentInput,
  ArtifactVersion,
} from "#shared/contract.ts";
import {
  fingerprint,
  wire,
  lock,
  required,
  audit,
  request,
  remember,
  validateStaticTarget,
} from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import {
  index,
  id,
  ensureService,
  artifact,
  artifactRow,
  version,
  environment,
  validateRequirements,
} from "./delivery-data.ts";
import { validateWorkerPipeline } from "./worker-pool/baseline.ts";
import { publicationSelections } from "./artifact-publication.ts";
import { validatePlatformEnvironment } from "./platform/policy.ts";
import { validateControlPlaneEnvironment } from "./control-plane/policy.ts";
import {
  validateScoutSitePipeline,
  validateScoutSiteEnvironment,
} from "./scout-site-policy.ts";

export async function publish(
  this: Delivery,
  rawInput: PublishBuild,
  actor: Principal,
  ci: { repositoryId: number; pipelineNumber: number },
) {
  const input = PublishBuildSchema.parse(rawInput);
  // Qualification time is established by the server, so a callback's wall
  // clock does not change the identity of an otherwise identical publication.
  const requestInput = { ...input, verifiedAt: "pending" };
  if (input.platformChanges !== undefined && input.serviceId !== "gitops")
    throw new DeliveryError(
      "INVALID",
      "Platform source publication must use the canonical gitops service",
    );
  if (
    new Set(input.artifacts.map((entry) => entry.id)).size !==
      input.artifacts.length ||
    new Set(input.artifacts.map((entry) => entry.component)).size !==
      input.artifacts.length
  )
    throw new DeliveryError(
      "INVALID",
      "Build artifact IDs and components must be unique",
    );
  // Every artifact names its registered store before any row exists (A6).
  const artifacts = input.artifacts.map((entry) => artifactRow(entry));
  return this.database.$transaction(async (tx) => {
    await ensureService(tx, input.serviceId);
    const previous = await request(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "build",
    });
    if (previous !== null)
      return {
        buildId: previous.resultId,
        artifacts: [
          ...input.artifacts.map((entry) => entry.id),
          ...input.retainedArtifactIds,
        ],
      };
    const buildId = id();
    const selections = await publicationSelections(tx, input, ci);
    await tx.build.create({
      data: {
        id: buildId,
        requestId: input.requestId,
        serviceId: input.serviceId,
        sourceRevision: input.sourceRevision,
        ciUrl: input.ciUrl,
        verifiedAt: new Date(input.verifiedAt),
        ...ci,
        ...(input.platformChanges === undefined
          ? {}
          : { platformChanges: input.platformChanges }),
        artifacts: {
          create: artifacts,
        },
      },
    });
    await tx.buildArtifactSelection.createMany({
      data: selections.map((entry) => ({ buildId, ...entry })),
    });
    await remember(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "build",
      resultId: buildId,
    });
    await audit(tx, actor, {
      action: "build.published",
      entityId: buildId,
      requestId: input.requestId,
      metadata: {
        serviceId: input.serviceId,
        sourceRevision: input.sourceRevision,
      },
    });
    return { buildId, artifacts: selections.map((entry) => entry.artifactId) };
  });
}

export async function compose(
  this: Delivery,
  input: ComposeVersionSet,
  actor: Principal,
) {
  return this.database.$transaction(async (tx) => {
    const service = await ensureService(tx, input.serviceId);
    const previous = await request(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "versionSet",
    });
    if (previous !== null) return version(tx, previous.resultId);
    await lock(tx, `versionSet:${input.serviceId}`);
    const base =
      input.baseRevisionId === undefined
        ? null
        : await version(tx, input.baseRevisionId);
    if (base !== null && base.serviceId !== input.serviceId)
      throw new DeliveryError(
        "INVALID",
        "Base revision belongs to another service",
      );
    const components = {
      ...Object.fromEntries(
        Object.entries(base?.components ?? {}).map(([key, entry]) => [
          key,
          entry.id,
        ]),
      ),
      ...input.components,
    };
    const selectedComponents: Record<string, ArtifactVersion> = {};
    for (const [key, artifactId] of Object.entries(components)) {
      const selected = await artifact(tx, artifactId);
      if (selected.serviceId !== input.serviceId || selected.component !== key)
        throw new DeliveryError(
          "INVALID",
          `Artifact does not belong to service/component ${input.serviceId}/${key}`,
        );
      selectedComponents[key] = selected;
    }
    validateRequirements(selectedComponents);
    const latest = await tx.versionSet.findFirst({
      where: { serviceId: input.serviceId },
      orderBy: { revision: "desc" },
    });
    // A manual set revision carries the current lineage and no order key:
    // it never becomes the base of an automatic one (model R3).
    const row = await tx.versionSet.create({
      data: {
        id: id(),
        serviceId: input.serviceId,
        revision: (latest?.revision ?? 0) + 1,
        baseRevisionId: input.baseRevisionId ?? null,
        lineage: service.lineage,
        entries: {
          create: Object.entries(components).map(([component, artifactId]) => ({
            component,
            artifactId,
          })),
        },
      },
    });
    await remember(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "versionSet",
      resultId: row.id,
    });
    await audit(tx, actor, {
      action: "versionSet.composed",
      entityId: row.id,
      requestId: input.requestId,
    });
    return version(tx, row.id);
  });
}

export async function registerPipeline(
  this: Delivery,
  pipelineId: string,
  definition: PipelineDefinition,
  actor: Principal,
) {
  if (
    definition.kind === "argocd" &&
    definition.minecraftUpgrade !== undefined &&
    (definition.application !== "minecraft-tsmc" ||
      definition.namespace !== "minecraft-tsmc" ||
      definition.chartName !== "minecraft" ||
      definition.chartComponent !== "chart:minecraft" ||
      definition.workerRollout !== undefined ||
      definition.forumRelease !== undefined)
  )
    throw new DeliveryError(
      "INVALID",
      "Minecraft upgrade policy requires the fixed TSMC application, namespace, chart and image binding",
    );
  validateWorkerPipeline(definition);
  validateScoutSitePipeline(definition);
  if (
    definition.kind === "argocd" &&
    ["apps", "argocd"].includes(definition.application)
  )
    throw new DeliveryError(
      "INVALID",
      "Root and Argo lifecycle changes require the guarded root release workflow",
    );
  return this.database.$transaction(async (tx) => {
    await lock(tx, `pipeline:${pipelineId}`);
    const existing = await tx.pipeline.findUnique({
      where: { id: pipelineId },
    });
    if (
      existing !== null &&
      fingerprint(existing.definition) !== fingerprint(definition)
    )
      throw new DeliveryError("CONFLICT", "Pipeline revisions are immutable");
    const row =
      existing ??
      (await tx.pipeline.create({ data: { id: pipelineId, definition } }));
    if (existing === null)
      await audit(tx, actor, {
        action: "pipeline.registered",
        entityId: pipelineId,
        requestId: pipelineId,
      });
    return PipelineRevisionSchema.parse(wire(row));
  });
}

/** A configuration revision is immutable once registered (model F1). */
export async function registerConfiguration(
  tx: Parameters<typeof environment>[0],
  input: { id: string; content: Record<string, string> },
) {
  const existing = await tx.configuration.findUnique({
    where: { id: input.id },
  });
  if (existing === null)
    return tx.configuration.create({
      data: { id: input.id, content: input.content },
    });
  if (fingerprint(existing.content) !== fingerprint(input.content))
    throw new DeliveryError(
      "CONFLICT",
      `Configuration revision ${input.id} already carries different content; register a new revision`,
    );
  return existing;
}

export async function registerEnvironment(
  this: Delivery,
  rawInput: RegisterEnvironmentInput,
  actor: Principal,
) {
  const input = RegisterEnvironmentSchema.parse(rawInput);
  return this.database.$transaction(async (tx) => {
    await ensureService(tx, input.serviceId);
    await lock(tx, `environment:${input.id}`);
    const pipeline = required(
      await tx.pipeline.findUnique({ where: { id: input.pipelineRevisionId } }),
      "Pipeline",
    );
    const parsed = LegacyPipelineRevisionSchema.parse(wire(pipeline));
    if (
      input.application !== undefined &&
      index.byArgoApp(input.application)?.id !== input.serviceId
    )
      throw new DeliveryError(
        "INVALID",
        "Argo application does not belong to this service in the catalog",
      );
    if (
      parsed.definition.kind === "argocd" &&
      parsed.definition.application !== input.application
    )
      throw new DeliveryError(
        "INVALID",
        "Pipeline application differs from environment application",
      );
    validateStaticTarget(input, parsed.definition);
    validateScoutSiteEnvironment(input, parsed.definition);
    validatePlatformEnvironment(input, parsed.definition);
    validateControlPlaneEnvironment(input, parsed.definition);
    const existing = await tx.environment.findUnique({
      where: { id: input.id },
    });
    if (
      existing?.activeDeploymentId !== null &&
      existing?.activeDeploymentId !== undefined
    )
      throw new DeliveryError(
        "CONFLICT",
        "Cannot update environment during deployment",
      );
    const pending = await tx.deployment.findFirst({
      where: {
        environmentId: input.id,
        status: { in: ["awaiting_approval", "queued"] },
      },
    });
    if (pending !== null)
      throw new DeliveryError(
        "CONFLICT",
        "Cancel the pending deployment before changing environment configuration",
      );
    if (
      existing !== null &&
      (existing.serviceId !== input.serviceId ||
        existing.application !== (input.application ?? null))
    )
      throw new DeliveryError("CONFLICT", "Environment ownership is immutable");
    const configuration = await registerConfiguration(tx, {
      id: input.configurationRevision,
      content: input.configuration,
    });
    const {
      configurationRevision: _revision,
      configuration: _content,
      ...declared
    } = input;
    // Registration declares a binding; it never bumps the generation and
    // has no effect on any running system (model C3, E1).
    const data = {
      ...declared,
      application: input.application ?? null,
      promotionSourceEnvironmentId: input.promotionSourceEnvironmentId ?? null,
      declaredConfigurationId: configuration.id,
    };
    await tx.environment.upsert({
      where: { id: input.id },
      create: data,
      update: data,
    });
    await audit(tx, actor, {
      action: "environment.registered",
      entityId: input.id,
      requestId: id(),
    });
    return environment(tx, input.id);
  });
}
