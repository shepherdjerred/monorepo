import { DeliveryError } from "#domain/error.ts";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { IdentifierSchema } from "#shared/contract.ts";
import type { Principal, ArtifactVersion } from "#shared/contract.ts";
import { lock, required, audit } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import {
  id,
  artifact,
  validateRequirements,
  type Transaction,
} from "./delivery-data.ts";
import { replicationPending } from "./artifact-stores/replication.ts";

type BuildRow = Prisma.BuildGetPayload<object>;

/** Rolls a tentative verification back while produced bytes await their replica (PC1). */
class AwaitingReplication extends Error {
  constructor() {
    super("Produced artifacts await their off-cluster replica");
    this.name = "AwaitingReplication";
  }
}

async function qualifiedBase(
  tx: Transaction,
  source: { serviceId: string; repositoryId: number | null },
) {
  const matches = z.array(z.object({ id: IdentifierSchema })).parse(
    await tx.$queryRaw`
    SELECT version."id" FROM "VersionSet" version
    JOIN "Build" build ON build."id" = version."qualifiedBuildId"
    WHERE version."serviceId" = ${source.serviceId}
      AND build."serviceId" = ${source.serviceId}
      AND build."repositoryId" = ${source.repositoryId}
      AND build."status" = 'verified'
      AND build."sourceKind" = 'ci'
    ORDER BY version."revision" DESC LIMIT 1
  `,
  );
  const selected = matches[0];
  return selected === undefined
    ? null
    : tx.versionSet.findUniqueOrThrow({
        where: { id: selected.id },
        include: { entries: true },
      });
}

/**
 * The automatic set a verified CI build composes: its outputs over the latest
 * qualified base. Null when a strictly newer CI build of this service already
 * verified, so sibling builds of one pipeline all compose, and null when every
 * component's digest equals the base (R2): the new rows stay unselected.
 */
async function automaticSet(tx: Transaction, build: BuildRow) {
  if (build.pipelineNumber === null)
    throw new Error("CI build is missing its pipeline number");
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
  await lock(tx, `versionSet:${build.serviceId}`);
  const outputs = await tx.buildArtifactSelection.findMany({
    where: { buildId: build.id },
  });
  const base = await qualifiedBase(tx, build);
  const highest = await tx.versionSet.aggregate({
    where: { serviceId: build.serviceId },
    _max: { revision: true },
  });
  const components = {
    ...Object.fromEntries(
      (base?.entries ?? []).map((entry) => [entry.component, entry.artifactId]),
    ),
    ...Object.fromEntries(
      outputs.map((entry) => [entry.component, entry.artifactId]),
    ),
  };
  const selectedComponents: Record<string, ArtifactVersion> = {};
  for (const [component, artifactId] of Object.entries(components))
    selectedComponents[component] = await artifact(tx, artifactId);
  validateRequirements(selectedComponents);
  if (base !== null && base.entries.length === Object.keys(components).length) {
    let unchanged = true;
    for (const entry of base.entries) {
      const original = await artifact(tx, entry.artifactId);
      if (selectedComponents[entry.component]?.digest !== original.digest) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return null;
  }
  const service = await tx.service.findUniqueOrThrow({
    where: { id: build.serviceId },
  });
  // A ci build's order key is its pipeline number with a zero minor key;
  // attested builds take the registration sequence as minor (B4).
  return {
    id: id(),
    qualifiedBuildId: build.id,
    serviceId: build.serviceId,
    revision: (highest._max.revision ?? 0) + 1,
    baseRevisionId: base?.id ?? null,
    lineage: service.lineage,
    orderMajor: build.pipelineNumber,
    orderMinor: 0,
    entries: {
      create: Object.entries(components).map(([component, artifactId]) => ({
        component,
        artifactId,
      })),
    },
  };
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
      const composed =
        build.sourceKind === "ci" ? await automaticSet(tx, build) : null;
      // Incompatible outputs fail above without waiting for a replica; compatible
      // ones verify only once every produced self-hosted byte has one (PC1).
      if (await replicationPending(tx, buildId))
        throw new AwaitingReplication();
      if (composed !== null) await tx.versionSet.create({ data: composed });
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
