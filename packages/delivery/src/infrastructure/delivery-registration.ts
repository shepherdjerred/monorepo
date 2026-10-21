import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  PublishBuildSchema,
  ImportSnapshotSchema,
  ImportedSnapshotSchema,
} from "#shared/contract.ts";
import type {
  ComposeVersionSet,
  PipelineDefinition,
  Principal,
  PublishBuild,
  RegisterEnvironment,
  ArtifactVersion,
  ImportSnapshot,
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

export async function importSnapshot(
  this: Delivery,
  rawInput: ImportSnapshot,
  actor: Principal,
) {
  const input = ImportSnapshotSchema.parse(rawInput);
  ensureService(input.serviceId);
  return this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "import",
    });
    if (prior !== null) {
      const stored = required(
        await tx.importedSnapshot.findUnique({ where: { id: prior.resultId } }),
        "Imported snapshot",
      );
      return ImportedSnapshotSchema.parse(
        wire({
          ...stored,
          environmentId: stored.environmentId ?? undefined,
          verified: false,
        }),
      );
    }
    const row = await tx.importedSnapshot.create({
      data: {
        id: id(),
        ...input,
        environmentId: input.environmentId ?? null,
        capturedAt: new Date(input.capturedAt),
      },
    });
    await remember(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "import",
      resultId: row.id,
    });
    await audit(tx, actor, {
      action: "snapshot.imported",
      entityId: row.id,
      requestId: input.requestId,
    });
    return ImportedSnapshotSchema.parse(
      wire({
        ...row,
        environmentId: row.environmentId ?? undefined,
        verified: false,
      }),
    );
  });
}

export async function importedSnapshots(this: Delivery) {
  const rows = await this.database.importedSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) =>
    ImportedSnapshotSchema.parse(
      wire({
        ...row,
        environmentId: row.environmentId ?? undefined,
        verified: false,
      }),
    ),
  );
}

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
  ensureService(input.serviceId);
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
  return this.database.$transaction(async (tx) => {
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
    const selections = await publicationSelections(tx, input, ci.repositoryId);
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
          create: input.artifacts.map((entry) => artifactRow(entry)),
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
  ensureService(input.serviceId);
  return this.database.$transaction(async (tx) => {
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
    const row = await tx.versionSet.create({
      data: {
        id: id(),
        serviceId: input.serviceId,
        revision: (latest?.revision ?? 0) + 1,
        baseRevisionId: input.baseRevisionId ?? null,
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

export async function registerEnvironment(
  this: Delivery,
  input: RegisterEnvironment,
  actor: Principal,
) {
  ensureService(input.serviceId);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `environment:${input.id}`);
    const pipeline = required(
      await tx.pipeline.findUnique({ where: { id: input.pipelineRevisionId } }),
      "Pipeline",
    );
    const parsed = PipelineRevisionSchema.parse(wire(pipeline));
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
    const data = {
      ...input,
      application: input.application ?? null,
      promotionSourceEnvironmentId: input.promotionSourceEnvironmentId ?? null,
    };
    await tx.environment.upsert({
      where: { id: input.id },
      create: data,
      update: { ...data, generation: { increment: 1 } },
    });
    await audit(tx, actor, {
      action: "environment.registered",
      entityId: input.id,
      requestId: id(),
    });
    return environment(tx, input.id);
  });
}
