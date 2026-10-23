import { DeliveryError } from "#domain/error.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { PlatformChangesSchema } from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import { lock, required, audit } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import { id, type Transaction } from "./delivery-data.ts";
import type { Database } from "./database.ts";
import { composeVerifiedBuild } from "./composition/verified-build.ts";
import { replicationPending } from "./artifact-stores/replication.ts";

type BuildRow = Prisma.BuildGetPayload<object>;

/** Rolls a tentative verification back while produced bytes await their replica (PC1). */
class AwaitingReplication extends Error {
  constructor() {
    super("Produced artifacts await their off-cluster replica");
    this.name = "AwaitingReplication";
  }
}

/** Rolls a tentative verification back while a retained original's build is pending (B2). */
class AwaitingRetainedBuild extends Error {
  constructor() {
    super("Retained artifacts await their producing build's qualification");
    this.name = "AwaitingRetainedBuild";
  }
}

/** Artifact ids a platform source names without producing: root charts and site archives. */
function platformReferenceIds(build: BuildRow) {
  const changes =
    build.platformChanges === null
      ? undefined
      : PlatformChangesSchema.parse(build.platformChanges);
  return [
    ...Object.values(changes?.rootArtifacts ?? {}),
    ...(changes?.sites ?? []).map((site) => site.artifactId),
  ];
}

/**
 * Artifacts a build references without producing them: its retained
 * selections, and a platform source's root charts and site archives.
 */
async function referencedArtifacts(
  tx: Transaction | Database,
  build: BuildRow,
) {
  return tx.artifact.findMany({
    where: {
      buildId: { not: build.id },
      OR: [
        { selections: { some: { buildId: build.id } } },
        { id: { in: platformReferenceIds(build) } },
      ],
    },
    include: { build: true },
    orderBy: { id: "asc" },
  });
}

/**
 * Whether the qualifier will fail this build: it, or a pending build it
 * references through any chain of pending builds, has a failed reference.
 * A carried (`migrated`) original is verified, so it never dooms a build.
 */
export async function doomed(
  tx: Transaction | Database,
  build: BuildRow,
  seen = new Set<string>(),
): Promise<boolean> {
  seen.add(build.id);
  for (const { build: source } of await referencedArtifacts(tx, build)) {
    if (source.status === "failed") return true;
    if (
      source.status === "pending" &&
      !seen.has(source.id) &&
      (await doomed(tx, source, seen))
    )
      return true;
  }
  return false;
}

/** Whether `source` precedes `build` in the order key: pipeline, then registration (B4). */
function precedes(source: BuildRow, build: BuildRow) {
  if (
    source.sourceKind !== "ci" ||
    source.repositoryId !== build.repositoryId ||
    source.pipelineNumber === null ||
    build.pipelineNumber === null
  )
    return false;
  return source.pipelineNumber === build.pipelineNumber
    ? source.registrationSequence !== null &&
        build.registrationSequence !== null &&
        source.registrationSequence < build.registrationSequence
    : source.pipelineNumber < build.pipelineNumber;
}

/**
 * A build verifies only after every build whose artifact it references has
 * (B1, B2), including a platform source's same-pipeline root and site
 * producers. A pending reference defers this build; any failed reference
 * fails it, naming the artifact, so the next pipeline rebuilds instead of
 * retaining it. Only a build that precedes this one in the order key is
 * awaited; any other pending reference is refused, so a build never waits on
 * itself or on a later build and waits cannot form a cycle.
 */
async function requireQualifiedReferences(tx: Transaction, build: BuildRow) {
  let awaiting = false;
  for (const reference of await referencedArtifacts(tx, build)) {
    const { id: artifactId, component, build: source } = reference;
    if (source.status === "verified") continue;
    if (source.status === "failed")
      throw new DeliveryError(
        "INVALID",
        `Retained artifact ${artifactId} (${component}) belongs to build ${source.id}, which failed qualification`,
      );
    if (!precedes(source, build))
      throw new DeliveryError(
        "INVALID",
        `Retained artifact ${artifactId} (${component}) belongs to pending build ${source.id}, which does not precede this build in its pipeline series`,
      );
    awaiting = true;
  }
  if (awaiting) throw new AwaitingRetainedBuild();
}

export async function pendingQualification(this: Delivery) {
  return {
    builds: await this.database.build.findMany({
      where: { status: "pending", sourceKind: "ci" },
      select: { id: true, serviceId: true, sourceRevision: true, ciUrl: true },
      orderBy: [
        { qualificationCheckedAt: { sort: "asc", nulls: "first" } },
        { createdAt: "asc" },
      ],
      take: 100,
    }),
  };
}

export async function findBuild(this: Delivery, buildId: string) {
  return required(
    await this.database.build.findUnique({ where: { id: buildId } }),
    "Build",
  );
}

export async function markQualificationAttempt(
  this: Delivery,
  buildId: string,
) {
  await this.database.build.update({
    where: { id: buildId },
    data: { qualificationCheckedAt: new Date() },
  });
}

export async function qualify(
  this: Delivery,
  ...args: [
    buildId: string,
    status: "pending" | "verified" | "failed",
    actor: Principal,
    reason?: string,
  ]
) {
  const [
    buildId,
    status,
    actor,
    reason = "CI pipeline did not pass exact main push verification",
  ] = args;
  const build = await this.build(buildId);
  if (build.status !== "pending") return { status: build.status };
  if (status === "pending") return { status };
  try {
    await this.database.$transaction(async (tx) => {
      await lock(tx, `qualification:${build.serviceId}`);
      const changed = await tx.build.updateMany({
        where: { id: buildId, status: "pending" },
        data: {
          status,
          verifiedAt: new Date(),
          ...(status === "failed" ? { qualificationReason: reason } : {}),
        },
      });
      if (changed.count === 0) return;
      await audit(tx, actor, {
        action: `build.${status}`,
        entityId: buildId,
        requestId: id(),
      });
      if (status !== "verified") return;
      await requireQualifiedReferences(tx, build);
      // Composition runs before the replica check so incompatible outputs fail
      // without waiting; compatible ones verify only once every produced
      // self-hosted byte has an off-cluster replica (PC1).
      if (build.sourceKind === "ci") await composeVerifiedBuild(tx, build);
      if (await replicationPending(tx, buildId))
        throw new AwaitingReplication();
    });
  } catch (error) {
    if (
      error instanceof AwaitingReplication ||
      error instanceof AwaitingRetainedBuild
    )
      return { status: "pending" };
    if (!(error instanceof DeliveryError && error.code === "INVALID"))
      throw error;
    await this.database.$transaction(async (tx) => {
      await tx.build.updateMany({
        where: { id: buildId, status: "pending" },
        data: { status: "failed", qualificationReason: error.message },
      });
      await audit(tx, actor, {
        action: "build.incompatible",
        entityId: buildId,
        requestId: id(),
      });
    });
    return { status: "failed" };
  }
  return { status };
}
