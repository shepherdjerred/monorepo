import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  ArtifactVersionSchema,
  EnvironmentSchema,
  PipelineRevisionSchema,
  VersionSetRevisionSchema,
} from "#shared/contract.ts";
import type {
  CreateDeployment,
  EvidenceInput,
  PipelineDefinition,
  ArtifactVersion,
  Environment,
  VersionSetRevision,
} from "#shared/contract.ts";
import type { Database } from "./database.ts";
import { fingerprint, wire, required } from "./delivery-records.ts";

export type Transaction = Prisma.TransactionClient;
export const index = new ServiceIndex();
export const terminal = new Set(["succeeded", "failed", "canceled"]);
export const id = () => crypto.randomUUID();
/** Strong uncapped identities cover executions which Temporal Visibility has not indexed yet. */
export async function pendingDeliveryObservations(tx: Transaction) {
  const active = { status: { in: ["pending", "running"] } };
  const counts = await Promise.all([
    tx.workerRecoveryIntent.count({ where: active }),
    tx.minecraftRecoveryIntent.count({ where: active }),
    tx.platformRecoveryIntent.count({ where: active }),
    tx.contentRecoveryIntent.count({
      where: {
        OR: [
          { status: "pending" },
          { dispatchBarrier: { not: Prisma.DbNull }, barrierRestoredAt: null },
        ],
      },
    }),
    tx.forumBaselineIntent.count({ where: active }),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
}
export function ensureService(serviceId: string) {
  if (index.byId(serviceId)?.id !== serviceId)
    throw new DeliveryError(
      "INVALID",
      "A canonical service catalog identity is required",
    );
}
export function approvalRequired(
  serviceId: string,
  target: {
    application: string | null;
    name: string;
    pipeline: PipelineDefinition;
  },
) {
  const { application, name, pipeline } = target;
  if (serviceId === "scout-for-lol" && pipeline.kind === "static-site")
    return pipeline.bucket === "scout-frontend";
  const production =
    application?.endsWith("-prod") === true ||
    ["prod", "production"].includes(name.toLowerCase());
  return (
    ["scout-for-lol", "starlight-karma-bot"].includes(serviceId) && production
  );
}
/** Row input for a published artifact; an absent fingerprint stays an absent column. */
export function artifactRow<
  T extends { contentFingerprint?: string | undefined },
>(input: T): Omit<T, "contentFingerprint"> & { contentFingerprint?: string } {
  const { contentFingerprint, ...fields } = input;
  return {
    ...fields,
    ...(contentFingerprint === undefined ? {} : { contentFingerprint }),
  };
}
/**
 * Builds that qualify an artifact for this repository: CI builds owned by it,
 * acquisitions it ran (older rows carry no pipeline), and the licensed or
 * attested bundles that never belong to a repository.
 */
export function qualifiedBuildWhere(
  serviceId: string,
  repositoryId: number,
): Prisma.BuildWhereInput {
  return {
    serviceId,
    status: "verified",
    OR: [
      { sourceKind: "ci", repositoryId },
      // Acquisitions carry the acquiring pipeline (B3); older rows have none.
      {
        sourceKind: "upstream",
        OR: [{ repositoryId }, { repositoryId: null }],
      },
      {
        sourceKind: { in: ["licensed-bundle", "attested"] },
        repositoryId: null,
      },
    ],
  };
}
export async function artifact(tx: Transaction | Database, artifactId: string) {
  const row = required(
    await tx.artifact.findUnique({
      where: { id: artifactId },
      include: { build: true },
    }),
    "Artifact",
  );
  if (row.build.status !== "verified")
    throw new DeliveryError(
      "CONFLICT",
      "Artifact build has not passed CI qualification",
    );
  return artifactView(row);
}
export function artifactView(
  row: Prisma.ArtifactGetPayload<{ include: { build: true } }>,
) {
  const {
    build,
    originKey: _originKey,
    contentFingerprint,
    replication,
    ...fields
  } = row;
  // Null columns are omitted so a reader without the field keeps its shape.
  return ArtifactVersionSchema.parse(
    wire({
      ...fields,
      ...(contentFingerprint === null ? {} : { contentFingerprint }),
      ...(replication === null ? {} : { replication }),
      serviceId: build.serviceId,
      sourceRevision: build.sourceRevision,
    }),
  );
}
export async function version(tx: Transaction | Database, revisionId: string) {
  const row = required(
    await tx.versionSet.findUnique({
      where: { id: revisionId },
      include: { entries: true },
    }),
    "Version set revision",
  );
  const components: Record<string, ArtifactVersion> = {};
  for (const entry of row.entries)
    components[entry.component] = await artifact(tx, entry.artifactId);
  return VersionSetRevisionSchema.parse(wire({ ...row, components }));
}
export async function environment(
  tx: Transaction | Database,
  environmentId: string,
) {
  const row = required(
    await tx.environment.findUnique({ where: { id: environmentId } }),
    "Environment",
  );
  const pipeline = PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({ where: { id: row.pipelineRevisionId } }),
        "Pipeline",
      ),
    ),
  );
  return EnvironmentSchema.parse(
    wire({
      ...row,
      approvalRequired: approvalRequired(row.serviceId, {
        application: row.application,
        name: row.name,
        pipeline: pipeline.definition,
      }),
    }),
  );
}
function storedEvidenceFingerprint(item: {
  kind: string;
  summary: string;
  url: string | null;
  operationId: string | null;
}) {
  return fingerprint({
    kind: item.kind,
    summary: item.summary,
    ...(item.url === null ? {} : { url: item.url }),
    ...(item.operationId === null ? {} : { operationId: item.operationId }),
  });
}

async function existingEvidence(
  tx: Transaction,
  evidenceId: string,
  legacy?: { deploymentId: string; scope: string; item: EvidenceInput },
) {
  const existing = await tx.evidence.findUnique({ where: { id: evidenceId } });
  if (existing !== null || legacy === undefined) return existing;
  // Preserve and replay existing indexed controller receipts without changing their IDs.
  return tx.evidence.findFirst({
    where: {
      deploymentId: legacy.deploymentId,
      id: { startsWith: legacy.scope },
      kind: legacy.item.kind,
      summary: legacy.item.summary,
      url: legacy.item.url ?? null,
      operationId: legacy.item.operationId ?? null,
    },
  });
}

export async function evidence(
  tx: Transaction,
  deploymentId: string,
  items: EvidenceInput[],
  target: string | { prefix: string; appendOnly: true },
) {
  const { prefix, appendOnly } =
    typeof target === "string" ? { prefix: target, appendOnly: false } : target;
  for (const [offset, item] of items.entries()) {
    const scope = `${deploymentId}/${prefix}/`;
    const evidenceId = `${scope}${appendOnly ? fingerprint(item) : String(offset)}`;
    const existing = await existingEvidence(
      tx,
      evidenceId,
      appendOnly ? { deploymentId, scope, item } : undefined,
    );
    if (existing === null) {
      await tx.evidence.create({
        data: {
          id: evidenceId,
          deploymentId,
          kind: item.kind,
          summary: item.summary,
          url: item.url ?? null,
          operationId: item.operationId ?? null,
        },
      });
    } else {
      if (storedEvidenceFingerprint(existing) !== fingerprint(item))
        throw new DeliveryError("CONFLICT", "Evidence cannot be rewritten");
    }
  }
}

export async function validateSelection(
  tx: Transaction,
  input: CreateDeployment,
  env: Environment,
  selected: VersionSetRevision,
) {
  if (input.kind === "promote") {
    if (input.sourceEnvironmentId === undefined)
      throw new DeliveryError(
        "INVALID",
        "Promotion requires a source environment",
      );
    const source = await environment(tx, input.sourceEnvironmentId);
    if (
      source.serviceId !== env.serviceId ||
      source.acceptedVersionSetRevisionId !== selected.id ||
      (env.promotionSourceEnvironmentId !== null &&
        env.promotionSourceEnvironmentId !== source.id)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Promotion requires the selected revision to be accepted in the configured source environment",
      );
  } else if (
    env.promotionSourceEnvironmentId !== null &&
    input.kind !== "rollback" &&
    input.kind !== "adopt-worker"
  )
    throw new DeliveryError(
      "INVALID",
      "This environment requires promotion from its configured source",
    );
  if (input.kind === "rollback") {
    const accepted = await tx.deployment.findFirst({
      where: {
        environmentId: env.id,
        versionSetRevisionId: selected.id,
        status: "succeeded",
        kind: { notIn: ["adopt-worker", "repair-trmnl"] },
      },
    });
    if (accepted === null)
      throw new DeliveryError(
        "INVALID",
        "Rollback target has never passed acceptance in this environment",
      );
  }
}

export async function automaticTarget(
  database: Database,
  env: { serviceId: string; promotionSourceEnvironmentId: string | null },
) {
  if (env.promotionSourceEnvironmentId === null)
    return database.versionSet.findFirst({
      where: { serviceId: env.serviceId, qualifiedBuildId: { not: null } },
      orderBy: { revision: "desc" },
    });
  const source = await database.environment.findUnique({
    where: { id: env.promotionSourceEnvironmentId },
  });
  return source?.acceptedVersionSetRevisionId === null ||
    source?.acceptedVersionSetRevisionId === undefined
    ? null
    : database.versionSet.findUnique({
        where: { id: source.acceptedVersionSetRevisionId },
      });
}
export function validateRequirements(
  components: Record<string, ArtifactVersion>,
) {
  for (const entry of Object.values(components)) {
    for (const [component, digest] of Object.entries(entry.requires)) {
      if (components[component]?.digest !== digest)
        throw new DeliveryError(
          "INVALID",
          `${entry.component} requires exact ${component} digest ${digest}`,
        );
    }
  }
}
