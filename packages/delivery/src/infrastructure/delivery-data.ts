import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  ArtifactVersionSchema,
  ConfigurationRevisionSchema,
  EnvironmentSchema,
  VersionSetRevisionSchema,
} from "#shared/contract.ts";
import type { EvidenceInput, ArtifactVersion } from "#shared/contract.ts";
import type { Database } from "./database.ts";
import {
  ARTIFACT_STORES,
  type ArtifactStore,
  artifactStore,
  fingerprint,
  selectionFingerprint,
  wire,
  required,
} from "./delivery-records.ts";

export type Transaction = Prisma.TransactionClient;
/** Ops-model titles and links; service existence and lifecycle live in the record. */
export const index = new ServiceIndex();
export const terminal = new Set(["succeeded", "failed", "canceled"]);
const REGISTERED_STORES: ReadonlySet<string> = new Set(ARTIFACT_STORES);
export const id = () => crypto.randomUUID();
/** Strong uncapped identities cover executions which Temporal Visibility has not indexed yet. */
export async function pendingDeliveryObservations(tx: Transaction) {
  const counts = await Promise.all([
    tx.recoveryIntent.count({ where: { status: "pending" } }),
    tx.recoveryIntent.count({
      where: {
        status: { not: "pending" },
        barrier: { not: Prisma.DbNull },
        barrierRestoredAt: null,
      },
    }),
    tx.forumBaselineIntent.count({
      where: { status: { in: ["pending", "running"] } },
    }),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
}
/** A service exists iff the catalog registered it (C1); retired services admit nothing (S4). */
export async function ensureService(
  tx: Transaction | Database,
  serviceId: string,
) {
  const service = await tx.service.findUnique({ where: { id: serviceId } });
  if (service === null)
    throw new DeliveryError(
      "INVALID",
      "A catalog-registered service identity is required",
    );
  if (service.lifecycle !== "active")
    throw new DeliveryError(
      "INVALID",
      `Service ${serviceId} is ${service.lifecycle} and admits no builds or deployments`,
    );
  return service;
}
/**
 * Row input for a published artifact: its registered store (A6) is derived
 * from its location and origin, and an absent fingerprint stays an absent
 * column.
 */
export function artifactRow<
  T extends {
    uri: string;
    kind: string;
    origin?: { kind: string } | undefined;
    contentFingerprint?: string | undefined;
  },
>(
  input: T,
): Omit<T, "contentFingerprint"> & {
  store: ArtifactStore;
  contentFingerprint?: string;
} {
  const { contentFingerprint, ...fields } = input;
  return {
    ...fields,
    store: artifactStore(input),
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
  if (!REGISTERED_STORES.has(row.store))
    throw new DeliveryError(
      "CONFLICT",
      "Artifact store is not registered; the artifact is not selectable",
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
    store: _store,
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
/** Zero-padded `major.minor`, so string comparison is the model's order key comparison. */
export function orderKey(major: number | null, minor: number | null) {
  return major === null || minor === null
    ? null
    : `${String(major).padStart(10, "0")}.${String(minor).padStart(10, "0")}`;
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
  return VersionSetRevisionSchema.parse(
    wire({
      ...row,
      orderKey: orderKey(row.orderMajor, row.orderMinor),
      components,
    }),
  );
}
export async function environment(
  tx: Transaction | Database,
  environmentId: string,
) {
  const row = required(
    await tx.environment.findUnique({ where: { id: environmentId } }),
    "Environment",
  );
  return EnvironmentSchema.parse(wire(row));
}
/** The catalog revision a new deployment of this service freezes (4.1). */
export async function serviceCatalogRevision(
  tx: Transaction | Database,
  serviceId: string,
) {
  const service = await ensureService(tx, serviceId);
  return service.catalogRevision;
}
/** The key-value content of a configuration revision. */
export async function configurationContent(
  tx: Transaction | Database,
  configurationId: string,
) {
  const configuration = await configurationRevision(tx, configurationId);
  return configuration.content;
}
/** An immutable configuration revision (model 4.8). */
export async function configurationRevision(
  tx: Transaction | Database,
  configurationId: string,
) {
  return ConfigurationRevisionSchema.parse(
    wire(
      required(
        await tx.configuration.findUnique({ where: { id: configurationId } }),
        "Configuration revision",
      ),
    ),
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

/**
 * The set revision an automatic environment should run: the live set of its
 * service (R4: the automatic set revision of the current lineage with the
 * highest order key), or what its promotion source accepted.
 */
export async function automaticTarget(
  database: Database,
  env: { serviceId: string; promotionSourceEnvironmentId: string | null },
) {
  if (env.promotionSourceEnvironmentId === null) {
    const service = await database.service.findUniqueOrThrow({
      where: { id: env.serviceId },
    });
    return database.versionSet.findFirst({
      where: {
        serviceId: env.serviceId,
        lineage: service.lineage,
        automatic: true,
      },
      orderBy: [{ orderMajor: "desc" }, { orderMinor: "desc" }],
    });
  }
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
/**
 * The approval row a deployment needs under its environment's policy:
 * created `pending` with the request, bound to the frozen selection, and
 * decided later by a distinct human act (model H1, D6).
 */
export async function requestApproval(
  tx: Transaction,
  deployment: {
    id: string;
    versionSetRevisionId: string;
    pipelineRevisionId: string;
    configurationId: string;
  },
  options?: { override: boolean },
) {
  await tx.approval.create({
    data: {
      id: id(),
      deploymentId: deployment.id,
      status: "pending",
      // An override approval authorises a non-eligible deploy (H4).
      override: options?.override ?? false,
      boundFingerprint: selectionFingerprint(
        deployment.versionSetRevisionId,
        deployment.pipelineRevisionId,
        deployment.configurationId,
      ),
    },
  });
}
