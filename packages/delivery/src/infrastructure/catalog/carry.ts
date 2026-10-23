import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import {
  catalogComponentOf,
  catalogOwnerOf,
} from "@shepherdjerred/ops-model/delivery-catalog/migration.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  ArtifactOriginSchema,
  type MigratedFrom,
} from "#shared/artifact-contract.ts";
import type { CatalogDocument } from "#shared/model/catalog-contract.ts";
import type { Principal } from "#shared/contract.ts";
import {
  artifact as qualifiedArtifact,
  evidence,
  id,
  validateRequirements,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { audit } from "#infrastructure/delivery-records.ts";

type CatalogService = CatalogDocument["services"][number];
type OldEntry = Prisma.VersionSetEntryGetPayload<{
  include: { artifact: { include: { build: true } } };
}>;
type Owner = { serviceId: string; component: string };
/** One entry of the carried set: an artifact kept as is, or one moved to its catalog identity. */
type Planned =
  | { component: string; artifactId: string }
  | { component: string; source: OldEntry; owner: Owner };

const RequiresSchema = z.record(z.string(), z.string());
/** The catalog revision the model v2 migration gave every v1 deployment. */
const V1_BACKFILL = "v1-backfill";
/** Deployments of retired v1 platform kinds froze no selection to carry. */
const UNSELECTED_KINDS = new Set([
  "root-release",
  "tofu-plan",
  "tofu-apply",
  "upgrade-control-plane",
]);

function refuse(reason: string): never {
  throw new DeliveryError("CONFLICT", reason);
}

/** Services declaring each component first-party; two owners of one name is ambiguous. */
function firstPartyOwners(document: CatalogDocument) {
  const owners = new Map<string, string[]>();
  for (const service of document.services)
    for (const component of service.components)
      if (component.producer === "first-party")
        owners.set(component.name, [
          ...(owners.get(component.name) ?? []),
          service.id,
        ]);
  return owners;
}

/** The old entries by the catalog name each becomes; two becoming one is refused. */
function entriesByCatalogName(old: { id: string; entries: OldEntry[] }) {
  const byName = new Map<string, OldEntry>();
  for (const entry of old.entries) {
    const name = catalogComponentOf(entry.component);
    const other = byName.get(name);
    if (other !== undefined)
      refuse(
        `Set revision ${old.id} carries ${other.component} and ${entry.component} onto one component ${name}`,
      );
    byName.set(name, entry);
  }
  return byName;
}

/**
 * How one accepted selection meets its service's declared components: each
 * declared component's old entry, kept when its owner and name already match
 * and moved otherwise. Null when nothing moves, or when the old set lacks a
 * declared component (the producers compose that service's first set).
 */
function carryPlan(
  old: { id: string; serviceId: string; entries: OldEntry[] },
  service: CatalogService,
  owners: ReadonlyMap<string, string[]>,
): Planned[] | null {
  const byName = entriesByCatalogName(old);
  const planned: Planned[] = [];
  let moved = old.serviceId !== service.id;
  for (const component of service.components) {
    const source = byName.get(component.name);
    if (source === undefined) return null;
    const declaring = owners.get(component.name) ?? [];
    if (component.producer === "first-party" && declaring.length !== 1)
      refuse(
        `${source.component} in ${old.id} would become ${component.name} of ${declaring.join(" and ")}`,
      );
    const owner = catalogOwnerOf(service, component);
    if (
      source.artifact.build.serviceId === owner.serviceId &&
      source.artifact.component === owner.component
    ) {
      planned.push({
        component: component.name,
        artifactId: source.artifactId,
      });
      continue;
    }
    moved = true;
    planned.push({ component: component.name, source, owner });
  }
  return moved ? planned : null;
}

/**
 * The old artifact under its catalog identity: a `migrated` build of the
 * owning service holding the same bytes, digest, URI, origin and source
 * revision, recording the v1 artifact it stands for. It counts as qualified
 * because the original build qualified; it claims no CI run.
 */
async function moveArtifact(
  tx: Transaction,
  oldSetId: string,
  source: OldEntry,
  owner: Owner,
) {
  const original = source.artifact;
  const key = createHash("sha256")
    .update([oldSetId, owner.serviceId, original.id].join("\n"))
    .digest("hex")
    .slice(0, 32);
  const migratedFrom: MigratedFrom = {
    artifactId: original.id,
    serviceId: original.build.serviceId,
    component: original.component,
    buildId: original.buildId,
  };
  const artifactId = `migrated/${owner.serviceId}/${key}`;
  const build = await tx.build.create({
    data: {
      id: id(),
      requestId: `catalog-migration/${key}`,
      serviceId: owner.serviceId,
      sourceRevision: original.build.sourceRevision,
      sourceKind: "migrated",
      status: "verified",
      verifiedAt: original.build.verifiedAt,
      artifacts: {
        create: {
          id: artifactId,
          component: owner.component,
          kind: original.kind,
          uri: original.uri,
          store: original.store,
          digest: original.digest,
          runtimeDigests: original.runtimeDigests,
          requires: Object.fromEntries(
            Object.entries(RequiresSchema.parse(original.requires)).map(
              ([name, digest]) => [catalogComponentOf(name), digest],
            ),
          ),
          version: original.version,
          origin: ArtifactOriginSchema.parse(original.origin),
          contentFingerprint: original.contentFingerprint,
          replication: original.replication ?? Prisma.DbNull,
          migratedFrom,
        },
      },
    },
  });
  return { artifactId, buildId: build.id };
}

/** The carried set: the first set revision of the service's current lineage (R0). */
async function recordCarried(
  tx: Transaction,
  environment: { serviceId: string },
  old: { id: string; orderMajor: number | null; orderMinor: number | null },
  planned: Planned[],
) {
  const service = await tx.service.findUniqueOrThrow({
    where: { id: environment.serviceId },
  });
  const entries: { component: string; artifactId: string }[] = [];
  let qualifiedBuildId: string | null = null;
  for (const entry of planned) {
    if ("artifactId" in entry) {
      entries.push(entry);
      continue;
    }
    const moved = await moveArtifact(tx, old.id, entry.source, entry.owner);
    entries.push({ component: entry.component, artifactId: moved.artifactId });
    if (entry.owner.serviceId === service.id)
      qualifiedBuildId ??= moved.buildId;
  }
  const selected = Object.fromEntries(
    await Promise.all(
      entries.map(
        async (entry) =>
          [
            entry.component,
            await qualifiedArtifact(tx, entry.artifactId),
          ] as const,
      ),
    ),
  );
  validateRequirements(selected);
  const highest = await tx.versionSet.aggregate({
    where: { serviceId: service.id },
    _max: { revision: true },
  });
  return tx.versionSet.create({
    data: {
      id: id(),
      serviceId: service.id,
      revision: (highest._max.revision ?? 0) + 1,
      lineage: service.lineage,
      // The carried selection keeps its place in the producers' order (R4).
      orderMajor: old.orderMajor ?? 0,
      orderMinor: old.orderMinor ?? 0,
      automatic: true,
      qualifiedBuildId,
      migratedFromId: old.id,
      entries: { create: entries },
    },
  });
}

/** The environment's pointers at the v1 set follow it to the carried one. */
async function pointAtCarried(
  tx: Transaction,
  environmentId: string,
  oldId: string,
  carriedId: string,
) {
  const env = await tx.environment.findUniqueOrThrow({
    where: { id: environmentId },
  });
  const follow = (pointer: string | null) =>
    pointer === oldId ? carriedId : pointer;
  await tx.environment.update({
    where: { id: environmentId },
    data: {
      acceptedVersionSetRevisionId: follow(env.acceptedVersionSetRevisionId),
      desiredVersionSetRevisionId: follow(env.desiredVersionSetRevisionId),
      observedVersionSetRevisionId: follow(env.observedVersionSetRevisionId),
    },
  });
}

type CarriedFrom = {
  id: string;
  versionSetRevisionId: string;
  pipelineRevisionId: string;
  configurationId: string;
};
type CarryContext = { catalogRevision: string; actor: Principal };

/**
 * Section 7, L1: a selection is identified by the deployment that froze it,
 * so the carried set is accepted through a `carry` deployment. It freezes the
 * carried set with the v1 acceptance's recipe and configuration, has no
 * stages and no effects, and becomes the environment's accepted deployment;
 * every reader of the accepted selection (its view, promotion, admission,
 * the cold-start snapshot, rollback candidates) then names the carried set.
 * The v1 deployment stays immutable history.
 */
async function acceptCarried(
  tx: Transaction,
  carry: {
    env: { id: string; serviceId: string; generation: number };
    accepted: CarriedFrom;
    carriedId: string;
  },
  context: CarryContext,
) {
  const { env, accepted, carriedId } = carry;
  const now = new Date();
  const deployment = await tx.deployment.create({
    data: {
      id: id(),
      requestId: `catalog-carry/${env.id}/${carriedId}`,
      environmentId: env.id,
      serviceId: env.serviceId,
      versionSetRevisionId: carriedId,
      pipelineRevisionId: accepted.pipelineRevisionId,
      configurationId: accepted.configurationId,
      catalogRevision: context.catalogRevision,
      expectedGeneration: env.generation,
      kind: "carry",
      status: "succeeded",
      requestedBy: context.actor.id,
      message: `Carried the selection ${accepted.id} accepted onto the catalog's identities (section 7)`,
      previousAcceptedDeploymentId: accepted.id,
      previousAcceptedVersionSetRevisionId: accepted.versionSetRevisionId,
      // The carried bytes are the ones the v1 acceptance settled.
      monitorState: "unmonitored",
      monitorSettledAt: now,
      startedAt: now,
      finishedAt: now,
    },
  });
  await evidence(
    tx,
    deployment.id,
    [
      {
        kind: "acceptance",
        operationId: deployment.id,
        summary: JSON.stringify({
          adapter: "catalog-carry",
          carriedFromDeploymentId: accepted.id,
          carriedFromVersionSetRevisionId: accepted.versionSetRevisionId,
          versionSetRevisionId: carriedId,
        }),
      },
    ],
    "finish",
  );
  // An acceptance moves the accepted pointer and the binding generation (V1).
  await tx.environment.update({
    where: { id: env.id },
    data: {
      acceptedDeploymentId: deployment.id,
      generation: { increment: 1 },
    },
  });
  await pointAtCarried(tx, env.id, accepted.versionSetRevisionId, carriedId);
  await audit(tx, context.actor, {
    action: "deployment.carried",
    entityId: deployment.id,
    requestId: deployment.requestId,
    metadata: { environmentId: env.id, carriedFromDeploymentId: accepted.id },
  });
}

/**
 * Section 7: every v1 accepted selection the catalog migration carried keeps
 * its bytes but takes the component names and owners the catalog declares,
 * recorded as the first set revision of its service's lineage and accepted
 * through a `carry` deployment. Idempotent; an ambiguous mapping refuses
 * the whole reconcile.
 */
export async function carrySelections(
  tx: Transaction,
  document: CatalogDocument,
  result: { catalogRevision: string; environments: { carried: string[] } },
  actor: Principal,
) {
  const context = { catalogRevision: result.catalogRevision, actor };
  const services = new Map(
    document.services.map((service) => [service.id, service]),
  );
  const owners = firstPartyOwners(document);
  const environments = await tx.environment.findMany({
    where: { lifecycle: "active", acceptedDeploymentId: { not: null } },
    orderBy: { id: "asc" },
  });
  for (const env of environments) {
    const service = services.get(env.serviceId);
    const accepted = await tx.deployment.findUniqueOrThrow({
      where: { id: env.acceptedDeploymentId ?? "" },
    });
    // Only a v1 acceptance is carried: its bytes settled under v1, so the
    // carry may record them unmonitored. A v2 acceptance keeps its monitor
    // state; a later component move starts a new lineage instead (C4, R0).
    if (
      service === undefined ||
      accepted.catalogRevision !== V1_BACKFILL ||
      UNSELECTED_KINDS.has(accepted.kind)
    )
      continue;
    const old = await tx.versionSet.findUniqueOrThrow({
      where: { id: accepted.versionSetRevisionId },
      include: {
        entries: { include: { artifact: { include: { build: true } } } },
      },
    });
    if (old.migratedFromId !== null) continue;
    const existing = await tx.versionSet.findUnique({
      where: {
        migratedFromId_serviceId: {
          migratedFromId: old.id,
          serviceId: env.serviceId,
        },
      },
    });
    // Another environment of this service may already carry the same set.
    let carriedId = existing?.id;
    if (carriedId === undefined) {
      const planned = carryPlan(old, service, owners);
      if (planned === null) continue;
      const carried = await recordCarried(tx, env, old, planned);
      carriedId = carried.id;
    }
    await acceptCarried(tx, { env, accepted, carriedId }, context);
    result.environments.carried.push(env.id);
  }
}
