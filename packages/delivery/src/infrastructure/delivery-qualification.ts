import { DeliveryError } from "#domain/error.ts";
import { z } from "zod";
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
      if (status === "verified" && build.sourceKind === "ci") {
        const latest = await tx.build.findFirst({
          where: {
            serviceId: build.serviceId,
            repositoryId: build.repositoryId,
            status: "verified",
            sourceKind: "ci",
          },
          orderBy: { pipelineNumber: "desc" },
        });
        if (latest?.id !== buildId) return;
        await lock(tx, `versionSet:${build.serviceId}`);
        const outputs = await tx.buildArtifactSelection.findMany({
          where: { buildId },
        });
        const base = await qualifiedBase(tx, build);
        const highest = await tx.versionSet.aggregate({
          where: { serviceId: build.serviceId },
          _max: { revision: true },
        });
        const components = {
          ...Object.fromEntries(
            (base?.entries ?? []).map((entry) => [
              entry.component,
              entry.artifactId,
            ]),
          ),
          ...Object.fromEntries(
            outputs.map((entry) => [entry.component, entry.artifactId]),
          ),
        };
        const selectedComponents: Record<string, ArtifactVersion> = {};
        for (const [component, artifactId] of Object.entries(components))
          selectedComponents[component] = await artifact(tx, artifactId);
        validateRequirements(selectedComponents);
        if (
          base !== null &&
          base.entries.length === Object.keys(components).length &&
          base.entries.every(
            (entry) => components[entry.component] === entry.artifactId,
          )
        )
          return;
        await tx.versionSet.create({
          data: {
            id: id(),
            qualifiedBuildId: buildId,
            serviceId: build.serviceId,
            revision: (highest._max.revision ?? 0) + 1,
            baseRevisionId: base?.id ?? null,
            entries: {
              create: Object.entries(components).map(
                ([component, artifactId]) => ({ component, artifactId }),
              ),
            },
          },
        });
      }
    });
  } catch (error) {
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
