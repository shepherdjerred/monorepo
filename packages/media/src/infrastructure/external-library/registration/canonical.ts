import type { Prisma } from "#generated/prisma/client.ts";
import { externalCatalog } from "./catalog.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  readExternalLibraryAvailability,
  externalInventoryMatches,
} from "#infrastructure/external-library/availability.ts";
import {
  ExternalRegistrationPlanSchema,
  type ExternalPlexObservation,
} from "./contract.ts";

export async function assertExternalLibraryOwner(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  lock = false,
) {
  requireOwner(actor);
  if (lock)
    await db.$queryRaw`SELECT id FROM "MediaUser" WHERE id=${actor.id} FOR SHARE`;
  const current = await db.mediaUser.findUniqueOrThrow({
    where: { id: actor.id },
  });
  requireOwner(current);
  if (
    current.restricted ||
    actor.restricted ||
    current.version !== actor.version ||
    current.plexAccountId !== actor.plexAccountId
  )
    throw new MediaError(
      "external_library_owner_changed",
      "Current unrestricted owner authentication is required",
      403,
    );
}

function preservationReason(input: {
  reservations: number;
  owned: boolean;
  existing: boolean;
}): string | null {
  if (input.reservations > 0) return "acquisition_active";
  if (input.owned) return "owned_asset_preserved";
  return input.existing ? "existing_asset_preserved" : null;
}

/** Canonical catalog rows are created by catalog.adopt/refresh, never inferred from a file title. */
export async function captureExternalRegistrationPlan(
  tx: Prisma.TransactionClient,
  observed: ExternalPlexObservation,
) {
  const { root, catalog, members } = await externalCatalog(tx, observed);
  const ids = members.map((member) => member.mediaId);
  const latest = await tx.reconciliationScan.findFirst({
    where: { kind: "inventory", progress: { path: ["section"], gte: 2 } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  const inventory =
    latest === null
      ? []
      : await tx.plexInventoryObservation.findMany({
          where: {
            sectionId: observed.sectionId,
            path: observed.canonicalPath,
            scanId: latest.id,
          },
          take: 26,
        });
  if (
    inventory.length !== observed.members.length ||
    identityHash(inventory.map((row) => row.ratingKey).sort()) !==
      identityHash(observed.members.map((row) => row.ratingKey).sort()) ||
    !externalInventoryMatches(
      observed,
      inventory,
      latest === null ? [] : [latest],
      new Date(),
    )
  )
    throw new MediaError(
      "external_library_inventory_changed",
      "Plex source collection or complete physical coverage changed; review again",
      409,
    );
  const targets = await tx.mediaIntent.findMany({
    where: { mediaId: { in: ids }, edition: "default" },
    orderBy: { mediaId: "asc" },
  });
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId: { in: ids }, current: true },
    include: { asset: true },
    orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
  });
  const pathAsset = await tx.libraryAsset.findUnique({
    where: { path: observed.canonicalPath },
  });
  const reservations = await tx.acquisitionReservation.findMany({
    where: { mediaId: { in: ids } },
    orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
  });
  const ownedHistory = await tx.assetCoverage.count({
    where: { mediaId: { in: ids }, asset: { owned: true } },
  });
  let reason = preservationReason({
    reservations: reservations.length,
    owned:
      ownedHistory > 0 ||
      pathAsset?.owned === true ||
      coverage.some((row) => row.asset.owned),
    existing: pathAsset !== null || coverage.length > 0,
  });
  let disposition: "eligible" | "already_registered" | "protected" =
    reason === null ? "eligible" : "protected";
  if (
    reason !== null &&
    pathAsset !== null &&
    ownedHistory === 0 &&
    reservations.length === 0
  ) {
    const available = await readExternalLibraryAvailability(tx, pathAsset.id, {
      serverMachineId: observed.serverMachineId,
      sectionId: observed.sectionId,
      sectionType: observed.sectionType,
    });
    if (
      available !== null &&
      identityHash([...available].sort()) === identityHash([...ids].sort())
    ) {
      disposition = "already_registered";
      reason = null;
    }
  }
  return ExternalRegistrationPlanSchema.parse({
    observation: observed,
    root: {
      id: root.id,
      version: root.version,
      tmdbId: root.tmdbId,
      year: root.year,
      catalogIdentityHash: identityHash(catalog),
    },
    members,
    disposition,
    reason,
    existingAssetId: pathAsset?.id ?? null,
    databaseHash: identityHash({
      root: {
        id: root.id,
        version: root.version,
        externalIds: root.externalIds,
        year: root.year,
      },
      members,
      targets: targets.map((target) => ({
        mediaId: target.mediaId,
        edition: target.edition,
        editionRootId: target.editionRootId,
        version: target.version,
        generation: target.generation,
        automationEpoch: target.automationEpoch,
        desiredPresence: target.desiredPresence,
        monitoring: target.monitoring,
        libraryMonitoring: target.libraryMonitoring,
        profileId: target.profileId,
        intentionallyRemovedAt:
          target.intentionallyRemovedAt?.toISOString() ?? null,
      })),
      reservations: reservations.map((reservation) => ({
        mediaId: reservation.mediaId,
        edition: reservation.edition,
        attemptId: reservation.attemptId,
        generation: reservation.generation,
      })),
      ownedHistory,
      coverage: coverage.map((row) => ({
        mediaId: row.mediaId,
        assetId: row.assetId,
        current: row.current,
        assetVersion: row.asset.version,
        owned: row.asset.owned,
      })),
      pathAsset:
        pathAsset === null
          ? null
          : {
              id: pathAsset.id,
              version: pathAsset.version,
              owned: pathAsset.owned,
              state: pathAsset.state,
              propertiesHash: identityHash(pathAsset.properties),
            },
    }),
  });
}
