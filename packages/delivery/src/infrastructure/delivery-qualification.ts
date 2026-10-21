import { DeliveryError } from "#domain/error.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Principal } from "#shared/contract.ts";
import { lock, required, audit } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import { id, type Transaction } from "./delivery-data.ts";
import { composeAutomatic } from "./composition/automatic.ts";
import { replicationPending } from "./artifact-stores/replication.ts";

type BuildRow = Prisma.BuildGetPayload<object>;

/** Rolls a tentative verification back while produced bytes await their replica (PC1). */
class AwaitingReplication extends Error {
  constructor() {
    super("Produced artifacts await their off-cluster replica");
    this.name = "AwaitingReplication";
  }
}

/**
 * The automatic set a verified CI build composes (R2): its new and retained
 * outputs over the live set, keyed by its pipeline number (B4).
 */
async function automaticSet(tx: Transaction, build: BuildRow) {
  if (build.pipelineNumber === null)
    throw new Error("CI build is missing its pipeline number");
  // A newer verified build already stands for this service even when it
  // composed nothing because its digests equalled the live set (R2, R4).
  const newer = await tx.build.findFirst({
    where: {
      serviceId: build.serviceId,
      repositoryId: build.repositoryId,
      status: "verified",
      sourceKind: "ci",
      pipelineNumber: { gt: build.pipelineNumber },
    },
  });
  if (newer !== null) return null;
  const outputs = await tx.buildArtifactSelection.findMany({
    where: { buildId: build.id },
  });
  return composeAutomatic(tx, {
    serviceId: build.serviceId,
    outputs: Object.fromEntries(
      outputs.map((entry) => [entry.component, entry.artifactId]),
    ),
    orderKey: { major: build.pipelineNumber, minor: 0 },
    qualifiedBuildId: build.id,
  });
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
      // Composition runs before the replica check so incompatible outputs fail
      // without waiting; compatible ones verify only once every produced
      // self-hosted byte has an off-cluster replica (PC1).
      if (build.sourceKind === "ci") await automaticSet(tx, build);
      if (await replicationPending(tx, buildId))
        throw new AwaitingReplication();
    });
  } catch (error) {
    if (error instanceof AwaitingReplication) return { status: "pending" };
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
