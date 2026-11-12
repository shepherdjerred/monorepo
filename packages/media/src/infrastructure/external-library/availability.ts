import { z } from "zod";
import type {
  Prisma,
  PlexInventoryObservation,
  ReconciliationScan,
  MediaItem,
  ApplicationEvent,
} from "#generated/prisma/client.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import {
  EXTERNAL_LIBRARY_REGISTERED_EVENT,
  ExternalLibraryRegistrationSchema,
  ExternalLibraryRegistrationEventSchema,
  type ExternalLibraryRegistration,
} from "#shared/external-library/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { CatalogIdentitySchema } from "#shared/acquisition/catalog.ts";
import { canonicalRootId } from "#infrastructure/editions/locks.ts";
import type { MediaActor } from "#application/auth.ts";
import {
  assessVisibilityAccess,
  type visibilityAncestry,
} from "#infrastructure/visibility/access.ts";

// Normal inventory runs every 24 hours and has a one-hour execution bound.
export const EXTERNAL_INVENTORY_FRESHNESS_MS = 25 * 60 * 60 * 1000;
const Properties = z.object({
  externalLibrary: ExternalLibraryRegistrationSchema,
});
const Guids = z.array(z.object({ id: z.string() }));
const Progress = z.object({ section: z.int().min(0).max(4) });
const assetInclude = {
  coverage: {
    where: { current: true },
    take: 26,
    orderBy: { mediaId: "asc" },
    include: { media: { include: { parent: { include: { parent: true } } } } },
  },
} satisfies Prisma.LibraryAssetInclude;
type ExternalAsset = Prisma.LibraryAssetGetPayload<{
  include: typeof assetInclude;
}>;

/** Source collection is complete at phase 2; later phases reconcile owned files only. */
export function externalInventoryMatches(
  registration: Pick<
    ExternalLibraryRegistration,
    "sectionId" | "sectionType" | "canonicalPath"
  > & {
    members: readonly Pick<
      ExternalLibraryRegistration["members"][number],
      "ratingKey" | "guids" | "seasonNumber" | "episodeNumber"
    >[];
  },
  observations: readonly PlexInventoryObservation[],
  scans: readonly ReconciliationScan[],
  now: Date,
): boolean {
  if (
    identityHash(observations.map((row) => row.ratingKey).sort()) !==
    identityHash(registration.members.map((member) => member.ratingKey).sort())
  )
    return false;
  const scanById = new Map(scans.map((scan) => [scan.id, scan]));
  return registration.members.every((member) => {
    const observed = observations.find(
      (row) =>
        row.sectionId === registration.sectionId &&
        row.ratingKey === member.ratingKey &&
        row.path === registration.canonicalPath,
    );
    if (observed === undefined) return false;
    const scan = scanById.get(observed.scanId);
    const progress = Progress.safeParse(scan?.progress);
    const guids = Guids.safeParse(observed.guids);
    const age = now.getTime() - observed.observedAt.getTime();
    return (
      scan?.kind === "inventory" &&
      progress.success &&
      progress.data.section >= 2 &&
      scan.startedAt.getTime() <= observed.observedAt.getTime() &&
      age >= 0 &&
      age <= EXTERNAL_INVENTORY_FRESHNESS_MS &&
      guids.success &&
      identityHash([...new Set(guids.data.map((guid) => guid.id))].sort()) ===
        identityHash([...new Set(member.guids)].sort()) &&
      observed.kind ===
        (registration.sectionType === "movie" ? "movie" : "episode") &&
      observed.seasonNumber === member.seasonNumber &&
      observed.episodeNumber === member.episodeNumber
    );
  });
}

function registrationForAsset(
  asset: ExternalAsset,
  access: PlexAccess,
  now: Date,
): ExternalLibraryRegistration | null {
  if (
    asset.owned ||
    asset.ownershipEpoch !== -1 ||
    asset.torrentId !== null ||
    asset.checksum !== null ||
    asset.state !== "published" ||
    asset.edition !== "default"
  )
    return null;
  const parsed = Properties.safeParse(asset.properties);
  if (!parsed.success) return null;
  const registration = parsed.data.externalLibrary;
  return registration.serverMachineId !== access.serverMachineId ||
    registration.sectionId !== access.sectionId ||
    registration.sectionType !== access.sectionType ||
    registration.canonicalPath !== asset.path ||
    registration.rootMediaId !== asset.editionRootId ||
    registration.sizeBytes !== asset.sizeBytes.toString() ||
    new Date(registration.registeredAt).getTime() > now.getTime() ||
    identityHash(asset.coverage.map((row) => row.mediaId).sort()) !==
      identityHash(registration.members.map((row) => row.mediaId).sort()) ||
    asset.coverage.some((row) => row.edition !== "default")
    ? null
    : registration;
}

function registrationEventMatches(
  event: ApplicationEvent | null,
  registration: ExternalLibraryRegistration,
): boolean {
  const envelope = ExternalLibraryRegistrationEventSchema.safeParse(
    event?.payload,
  );
  if (
    event?.kind !== EXTERNAL_LIBRARY_REGISTERED_EVENT ||
    event.actorId === null ||
    event.mediaId !== registration.rootMediaId ||
    !envelope.success ||
    envelope.data.registrationHash !== identityHash(registration) ||
    identityHash(envelope.data.registration) !== identityHash(registration)
  )
    return false;
  return true;
}

function membersMatch(
  asset: ExternalAsset,
  registration: ExternalLibraryRegistration,
): boolean {
  return asset.coverage.every((row) => {
    const member = registration.members.find(
      (value) => value.mediaId === row.mediaId,
    );
    return (
      member?.mediaId === row.mediaId &&
      canonicalRootId(row.media) === registration.rootMediaId &&
      row.media.seasonNumber === member.seasonNumber &&
      row.media.episodeNumber === member.episodeNumber
    );
  });
}

function rootMatches(
  root: MediaItem | null,
  registration: ExternalLibraryRegistration,
): boolean {
  if (
    root?.tmdbId !== registration.rootTmdbId ||
    root.year !== registration.rootYear ||
    root.kind !== (registration.sectionType === "movie" ? "movie" : "series")
  )
    return false;
  const catalog = z
    .object({ catalogIdentity: CatalogIdentitySchema })
    .safeParse(root.externalIds);
  return (
    catalog.success &&
    identityHash(catalog.data.catalogIdentity) ===
      registration.rootCatalogIdentityHash &&
    catalog.data.catalogIdentity.references.some(
      (reference) =>
        reference.kind === root.kind &&
        reference.namespace === "tmdb" &&
        reference.value === String(root.tmdbId),
    )
  );
}

function registeredAssets(
  assets: readonly ExternalAsset[],
  access: readonly PlexAccess[],
  now: Date,
) {
  return assets.flatMap((asset) => {
    for (const configured of access) {
      const registration = registrationForAsset(asset, configured, now);
      if (registration !== null && membersMatch(asset, registration))
        return [{ asset, registration }];
    }
    return [];
  });
}

/** One shared inventory/event/catalog read for a bounded page of unique physical groups. */
async function availableAssets(
  tx: Prisma.TransactionClient,
  assets: readonly ExternalAsset[],
  access: readonly PlexAccess[],
  now: Date,
): Promise<Map<string, readonly string[]>> {
  const selected = registeredAssets(assets, access, now);
  const available = new Map<string, readonly string[]>();
  if (selected.length === 0) return available;
  const latest = await tx.reconciliationScan.findFirst({
    where: { kind: "inventory", progress: { path: ["section"], gte: 2 } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  if (latest === null) return available;
  const events = await tx.applicationEvent.findMany({
    where: {
      id: {
        in: selected.map(
          ({ registration }) => registration.registrationEventId,
        ),
      },
    },
  });
  const roots = await tx.mediaItem.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            selected.map(({ registration }) => registration.rootMediaId),
          ),
        ],
      },
    },
  });
  const coverage = await tx.assetCoverage.findMany({
    where: {
      current: true,
      mediaId: {
        in: [
          ...new Set(
            selected.flatMap(({ registration }) =>
              registration.members.map((member) => member.mediaId),
            ),
          ),
        ],
      },
    },
    select: { mediaId: true, assetId: true },
  });
  const observations = await tx.plexInventoryObservation.findMany({
    where: {
      scanId: latest.id,
      OR: selected.map(({ registration }) => ({
        sectionId: registration.sectionId,
        path: registration.canonicalPath,
      })),
    },
    take: selected.length * 26 + 1,
    orderBy: [{ sectionId: "asc" }, { path: "asc" }, { ratingKey: "asc" }],
  });
  // An overflowing page cannot prove a complete physical cohort.
  if (observations.length > selected.length * 26) return available;
  const eventById = new Map(events.map((event) => [event.id, event]));
  const rootById = new Map(roots.map((root) => [root.id, root]));
  for (const { asset, registration } of selected) {
    const ids = registration.members.map((member) => member.mediaId);
    if (
      !registrationEventMatches(
        eventById.get(registration.registrationEventId) ?? null,
        registration,
      ) ||
      !rootMatches(
        rootById.get(registration.rootMediaId) ?? null,
        registration,
      ) ||
      coverage.some(
        (row) => ids.includes(row.mediaId) && row.assetId !== asset.id,
      )
    )
      continue;
    const cohort = observations.filter(
      (row) =>
        row.sectionId === registration.sectionId &&
        row.path === registration.canonicalPath,
    );
    if (externalInventoryMatches(registration, cohort, [latest], now))
      available.set(asset.id, ids);
  }
  return available;
}

/** Generic Plex presence only. This grants no edition fulfillment or file authority. */
export async function readExternalLibraryAvailability(
  tx: Prisma.TransactionClient,
  assetId: string,
  access: PlexAccess,
  now = new Date(),
): Promise<readonly string[] | null> {
  const asset = await tx.libraryAsset.findUnique({
    where: { id: assetId },
    include: assetInclude,
  });
  if (asset === null) return null;
  const available = await availableAssets(tx, [asset], [access], now);
  return available.get(asset.id) ?? null;
}

/** Read overlay only: lifecycle and intent rows remain exactly as recorded. */
export async function externalAvailableMediaIds(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
  access: readonly PlexAccess[],
): Promise<ReadonlySet<string>> {
  if (mediaIds.length === 0 || access.length === 0) return new Set();
  const assets = await tx.libraryAsset.findMany({
    where: {
      owned: false,
      coverage: {
        some: {
          current: true,
          edition: "default",
          mediaId: { in: [...mediaIds] },
        },
      },
    },
    include: assetInclude,
  });
  const available = await availableAssets(tx, assets, access, new Date());
  const requested = new Set(mediaIds);
  return new Set(
    [...available.values()].flat().filter((id) => requested.has(id)),
  );
}

type ExternalRequest = Prisma.MediaRequestGetPayload<{
  include: { media: { include: typeof visibilityAncestry } };
}>;

/** Request cards retain their existing read scope; only new presence claims need current access. */
export async function projectExternalRequests(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  requests: ExternalRequest[],
  options: {
    access: readonly PlexAccess[];
    serverMachineId: string | undefined;
  },
): Promise<ExternalRequest[]> {
  const { access, serverMachineId } = options;
  if (access.length === 0) return requests;
  const sections: { movie?: string; series?: string } = {};
  for (const library of access)
    sections[library.sectionType === "movie" ? "movie" : "series"] =
      library.sectionId;
  const { reader, user } = await assessVisibilityAccess(tx, actor, {
    serverMachineId,
    sections,
  });
  if (reader === null) return requests;
  const permitted = access.filter(
    (library) =>
      user.plexIdentity?.permittedSectionIds.includes(library.sectionId) ===
        true &&
      user.plexIdentity.permittedMediaKinds.includes(
        library.sectionType === "movie" ? "movie" : "series",
      ),
  );
  const external = await externalAvailableMediaIds(
    tx,
    requests
      .filter((request) => reader.visible(request.media))
      .map((request) => request.mediaId),
    permitted,
  );
  return requests.map((request) => ({
    ...request,
    media: {
      ...request.media,
      availability: external.has(request.mediaId)
        ? "available"
        : request.media.availability,
    },
  }));
}
