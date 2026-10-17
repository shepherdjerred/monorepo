import { MediaError } from "#application/errors.ts";
import type { PlexItem } from "#integrations/plex.ts";
import type { NativeQuarantineObserverContext } from "#migration/native-network/quarantine.ts";
import { exactPlexIdentity } from "#migration/handoff-network/plex.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  archiveInventoryPass,
  hasArchivePart,
  videoSections,
} from "#migration/native-archive/inventory.ts";
import type {
  NativeCompensationScope,
  NativeCompensationNetworkEvidence,
} from "#shared/native-recovery/compensation.ts";
import { PublicationPathSchema } from "#shared/publication-proof/effects.ts";
import { canonicalCompensationEntries } from "./canonical.ts";

type Context = Pick<
  NativeQuarantineObserverContext,
  "plex" | "expectedServerMachineId" | "permittedSections"
>;
type PlexEvidence = NativeCompensationNetworkEvidence["plex"];

function protect(reason: string): never {
  throw new MediaError(
    reason,
    "Interrupted publication Plex evidence changed or is incomplete",
    409,
  );
}

function canonicalPath(
  scope: NativeCompensationScope,
  entry: NativeCompensationScope["entries"][number],
) {
  const relative = PublicationPathSchema.parse({
    root: "library",
    path: entry.entry.libraryPath,
  });
  const root = `/data/${entry.entry.libraryKind}`;
  const path = `${root}/${relative.path}`;
  if (
    !scope.storageRoots.some((item) => item.rootPath === root) ||
    entry.predecessor?.path !== path ||
    !entry.participants.some(
      (item) =>
        item.assetId === entry.predecessor?.id &&
        item.role === "video" &&
        item.physical.root === "library" &&
        item.physical.path === relative.path &&
        item.physical.state === "present" &&
        item.physical.sha256 === entry.predecessor.checksum,
    )
  )
    protect("compensation_canonical_path_unproved");
  return path;
}

/** C or D may occupy a canonical path; inventory proves identity, never which bytes are present. */
export async function observeCompensationPlex(
  context: Context,
  scope: NativeCompensationScope,
  signal: AbortSignal,
): Promise<PlexEvidence> {
  const server = await context.plex.machineIdentifier(signal);
  if (server !== context.expectedServerMachineId)
    protect("compensation_plex_server_changed");
  const configured = await context.permittedSections();
  const sections = videoSections(await context.plex.sections(signal));
  const absence = new Set(
    scope.requiredAbsences.map((item) => item.canonicalPath),
  );
  const first = await archiveInventoryPass(
    context.plex,
    sections,
    absence,
    signal,
  );
  const canonicalPaths: PlexEvidence["canonicalPaths"] = [];
  for (const { file, entry } of canonicalCompensationEntries(
    scope.files,
    scope.entries,
  )) {
    const predecessor = entry.predecessor;
    if (predecessor === null) protect("compensation_predecessor_missing");
    const sectionId =
      entry.entry.libraryKind === "movies"
        ? configured.movie
        : configured.series;
    const kind = entry.entry.libraryKind === "movies" ? "movie" : "episode";
    const section = first.find(
      (item) => item.sectionId === sectionId && item.kind === kind,
    );
    if (section === undefined) protect("compensation_plex_library_changed");
    const path = canonicalPath(scope, entry);
    if (file.canonicalPath !== path)
      protect("compensation_canonical_scope_changed");
    canonicalPaths.push({
      assetId: predecessor.id,
      mediaIds: file.mediaIds,
      canonicalPath: path,
      sectionId,
      items: await canonicalItems({
        context,
        scope,
        entry,
        inventory: section.items,
        server,
        sectionId,
        signal,
      }),
    });
  }
  const second = await archiveInventoryPass(
    context.plex,
    sections,
    absence,
    signal,
  );
  const { inventory, retainedAbsence } = retainedInventory(
    scope,
    first,
    second,
  );
  if (
    snapshotHash(videoSections(await context.plex.sections(signal))) !==
    snapshotHash(sections)
  )
    protect("compensation_plex_sections_changed");
  const playback = await assertPlayback({
    context,
    scope,
    canonicalPaths,
    absence,
    signal,
  });
  return { canonicalPaths, retainedAbsence, inventory, playback };
}

function retainedInventory(
  scope: NativeCompensationScope,
  first: Awaited<ReturnType<typeof archiveInventoryPass>>,
  second: Awaited<ReturnType<typeof archiveInventoryPass>>,
) {
  const inventory: PlexEvidence["inventory"] = [];
  const retainedAbsence: PlexEvidence["retainedAbsence"] = [];
  const groups = new Map<string, string[]>();
  for (const item of scope.requiredAbsences) {
    const paths = groups.get(item.assetId) ?? [];
    paths.push(item.canonicalPath);
    groups.set(item.assetId, paths);
  }
  for (const section of second) {
    if (
      section.digest !==
      first.find((item) => item.sectionId === section.sectionId)?.digest
    )
      protect("compensation_plex_inventory_changed");
    inventory.push({
      sectionId: section.sectionId,
      kind: section.kind,
      itemCount: section.items.length,
      digest: section.digest,
    });
    for (const [assetId, paths] of groups)
      retainedAbsence.push({
        assetId,
        sectionId: section.sectionId,
        paths: [...new Set(paths)].sort(),
        inventoryDigest: section.digest,
      });
  }
  return { inventory, retainedAbsence };
}

async function assertPlayback({
  context,
  scope,
  canonicalPaths,
  absence,
  signal,
}: {
  context: Context;
  scope: NativeCompensationScope;
  canonicalPaths: PlexEvidence["canonicalPaths"];
  absence: ReadonlySet<string>;
  signal: AbortSignal;
}): Promise<PlexEvidence["playback"]> {
  const paths = new Set([
    ...absence,
    ...canonicalPaths.map((item) => item.canonicalPath),
  ]);
  const keys = new Set(
    canonicalPaths.flatMap((item) => item.items.map((part) => part.ratingKey)),
  );
  for (const media of scope.media) {
    const ids = media.externalIds;
    if (
      ids !== null &&
      typeof ids === "object" &&
      !Array.isArray(ids) &&
      typeof ids["plexRatingKey"] === "string"
    )
      keys.add(ids["plexRatingKey"]);
  }
  const sessions = await context.plex.activeSessions(signal);
  if (
    sessions.some(
      (item) =>
        keys.has(item.ratingKey) ||
        hasArchivePart(item, paths) ||
        item.Media === undefined ||
        item.Media.length === 0 ||
        item.Media.some((media) => media.Part.length === 0),
    )
  )
    protect("compensation_playback_active_or_unknown");
  signal.throwIfAborted();
  return {
    state: "clear",
    checkedAt: new Date().toISOString(),
    scopeHash: snapshotHash({
      paths: [...paths].sort(),
      keys: [...keys].sort(),
    }),
  };
}

async function canonicalItems({
  context,
  scope,
  entry,
  inventory,
  server,
  sectionId,
  signal,
}: {
  context: Context;
  scope: NativeCompensationScope;
  entry: NativeCompensationScope["entries"][number];
  inventory: PlexItem[];
  server: string;
  sectionId: string;
  signal: AbortSignal;
}) {
  const path = canonicalPath(scope, entry);
  const matches = inventory.filter(
    (item) =>
      item.Media?.some((media) =>
        media.Part.some((part) => part.file === path),
      ) === true,
  );
  if (matches.length === 0) return [];
  if (matches.length !== entry.entry.mediaIds.length)
    protect("compensation_plex_coverage_ambiguous");
  const details: { metadata: PlexItem; series: PlexItem | undefined }[] = [];
  for (const item of matches) {
    const metadata = await context.plex.metadata(item.ratingKey, signal);
    const series =
      metadata.grandparentRatingKey === undefined
        ? undefined
        : await context.plex.metadata(metadata.grandparentRatingKey, signal);
    details.push({ metadata, series });
  }
  const result = entry.entry.mediaIds.map((mediaId) => {
    const media = scope.media.find((item) => item.id === mediaId);
    if (media === undefined)
      return protect("compensation_canonical_media_missing");
    const exact = details.filter((item) =>
      exactPlexIdentity(media, item.metadata, item.series),
    );
    const found = exact[0];
    if (found === undefined || exact.length !== 1)
      return protect("compensation_plex_identity_unproved");
    const parts = found.metadata.Media?.flatMap((item) => item.Part) ?? [];
    const sizes = [entry.predecessor?.sizeBytes, entry.entry.sizeBytes];
    if (
      parts.length !== 1 ||
      parts[0]?.file !== path ||
      (parts[0].size !== undefined && !sizes.includes(String(parts[0].size)))
    )
      return protect("compensation_plex_path_changed");
    return {
      ratingKey: found.metadata.ratingKey,
      identityHash: snapshotHash({
        server,
        sectionId,
        mediaId,
        path,
        ratingKey: found.metadata.ratingKey,
        guids: found.metadata.Guid ?? [],
        seriesGuids: found.series?.Guid ?? [],
        season: found.metadata.parentIndex ?? null,
        episode: found.metadata.index ?? null,
      }),
    };
  });
  if (new Set(result.map((item) => item.ratingKey)).size !== result.length)
    protect("compensation_plex_coverage_ambiguous");
  return result;
}
