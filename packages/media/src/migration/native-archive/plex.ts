import type { PlexItem } from "#integrations/plex.ts";
import type {
  NativeArchiveScope,
  NativeArchiveNetworkEvidence,
} from "#shared/native-recovery/archive.ts";
import type { NativeQuarantineObserverContext } from "#migration/native-network/quarantine.ts";
import { exactPlexIdentity } from "#migration/handoff-network/plex.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  archiveInventoryPass,
  archivePlexProtection,
  hasArchivePart,
  videoSections,
} from "./inventory.ts";

type Context = Pick<
  NativeQuarantineObserverContext,
  "plex" | "expectedServerMachineId" | "permittedSections"
>;
type File = NativeArchiveScope["files"][number];

function assertSection(
  available: { key: string; type: string }[],
  sectionId: string,
  kind: "movies" | "tv",
) {
  if (
    available.filter(
      (section) =>
        section.key === sectionId &&
        section.type === (kind === "movies" ? "movie" : "show"),
    ).length !== 1
  )
    archivePlexProtection("native_archive_plex_library_changed");
}

function archivePaths(scope: NativeArchiveScope) {
  const groups = scope.files
    .filter((file) => file.role !== "current_playback")
    .map((file) => ({
      assetId: file.assetId,
      libraryKind: file.libraryKind,
      paths: [
        ...new Set([
          file.canonicalPath,
          ...file.subtitles.flatMap((subtitle) =>
            subtitle.path === null ? [] : [subtitle.path],
          ),
        ]),
      ],
    }));
  for (const terminal of scope.terminalDependencies) {
    const paths = terminal.dependency.files
      .filter((file) => file.expectedChecksum === null)
      .map((file) => file.canonicalPath);
    const assetId = terminal.dependency.assetIds[0];
    if (assetId === undefined || paths.length === 0)
      archivePlexProtection("native_archive_terminal_paths_missing");
    const root =
      paths[0]?.startsWith("/data/movies/") === true ? "movies" : "tv";
    if (paths.some((path) => !path.startsWith(`/data/${root}/`)))
      archivePlexProtection("native_archive_terminal_root_ambiguous");
    groups.push({ assetId, libraryKind: root, paths });
  }
  return groups;
}

/** Current C must be freshly playable while every reviewed noncurrent path stays excluded. */
export async function observeArchivePlex(
  context: Context,
  scope: NativeArchiveScope,
  signal: AbortSignal,
): Promise<NativeArchiveNetworkEvidence["plex"]> {
  const server = await context.plex.machineIdentifier(signal);
  if (server !== context.expectedServerMachineId)
    archivePlexProtection("native_archive_plex_server_changed");
  const configured = await context.permittedSections();
  const available = await context.plex.sections(signal);
  const sections = videoSections(available);
  const absent = archivePaths(scope);
  const protectedPaths = new Set([
    ...scope.files.map((file) => file.canonicalPath),
    ...absent.flatMap((group) => group.paths),
  ]);
  const currentPlayback: NativeArchiveNetworkEvidence["plex"]["currentPlayback"] =
    [];
  const archiveAbsence: NativeArchiveNetworkEvidence["plex"]["archiveAbsence"] =
    [];
  const inventory: NativeArchiveNetworkEvidence["plex"]["inventory"] = [];
  const archiveSet = new Set(absent.flatMap((group) => group.paths));
  const first = await archiveInventoryPass(
    context.plex,
    sections,
    archiveSet,
    signal,
  );
  for (const kind of ["movies", "tv"] as const) {
    const files = scope.files.filter(
      (file) => file.libraryKind === kind && file.role === "current_playback",
    );
    if (files.length === 0) continue;
    const sectionId = kind === "movies" ? configured.movie : configured.series;
    assertSection(available, sectionId, kind);
    const observed = first.find((section) => section.sectionId === sectionId);
    if (observed === undefined)
      archivePlexProtection("native_archive_plex_library_changed");
    for (const file of files)
      currentPlayback.push(
        await matchCurrent({
          context,
          scope,
          file,
          server,
          sectionId,
          items: observed.items,
          signal,
        }),
      );
  }
  const second = await archiveInventoryPass(
    context.plex,
    sections,
    archiveSet,
    signal,
  );
  for (const section of second) {
    if (
      section.digest !==
      first.find((item) => item.sectionId === section.sectionId)?.digest
    )
      archivePlexProtection("native_archive_plex_inventory_changed");
    inventory.push({
      sectionId: section.sectionId,
      kind: section.kind,
      itemCount: section.items.length,
      digest: section.digest,
    });
    archiveAbsence.push(
      ...absent.map((group) => ({
        assetId: group.assetId,
        sectionId: section.sectionId,
        paths: group.paths,
        inventoryDigest: section.digest,
      })),
    );
  }
  if (
    snapshotHash(videoSections(await context.plex.sections(signal))) !==
    snapshotHash(sections)
  )
    archivePlexProtection("native_archive_plex_sections_changed");
  assertCoverage(scope, currentPlayback);
  const playback = await assertPlayback({
    context,
    scope,
    currentPlayback,
    protectedPaths,
    signal,
  });
  return { currentPlayback, archiveAbsence, inventory, playback };
}

function assertCoverage(
  scope: NativeArchiveScope,
  currentPlayback: NativeArchiveNetworkEvidence["plex"]["currentPlayback"],
) {
  if (
    currentPlayback.length !== scope.currentPlayback.length ||
    scope.currentPlayback.some((expected) => {
      const actual = currentPlayback.find(
        (item) => item.assetId === expected.assetId,
      );
      return (
        actual?.mediaIds.length !== expected.mediaIds.length ||
        expected.mediaIds.some((id) => !actual.mediaIds.includes(id))
      );
    })
  )
    archivePlexProtection("native_archive_current_coverage_changed");
}

async function assertPlayback({
  context,
  scope,
  currentPlayback,
  protectedPaths,
  signal,
}: {
  context: Context;
  scope: NativeArchiveScope;
  currentPlayback: NativeArchiveNetworkEvidence["plex"]["currentPlayback"];
  protectedPaths: ReadonlySet<string>;
  signal: AbortSignal;
}): Promise<NativeArchiveNetworkEvidence["plex"]["playback"]> {
  const keys = new Set(
    currentPlayback.flatMap((file) => file.items.map((item) => item.ratingKey)),
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
        hasArchivePart(item, protectedPaths) ||
        item.Media === undefined ||
        item.Media.length === 0 ||
        item.Media.some((media) => media.Part.length === 0),
    )
  )
    archivePlexProtection("native_archive_playback_active_or_unknown");
  signal.throwIfAborted();
  return {
    state: "clear",
    checkedAt: new Date().toISOString(),
    scopeHash: snapshotHash({
      paths: [...protectedPaths].sort(),
      keys: [...keys].sort(),
    }),
  };
}

async function matchCurrent(input: {
  context: Context;
  scope: NativeArchiveScope;
  file: File;
  server: string;
  sectionId: string;
  items: PlexItem[];
  signal: AbortSignal;
}) {
  const { context, scope, file, server, sectionId, signal } = input;
  const matches = input.items.filter(
    (item) =>
      item.Media?.some((media) =>
        media.Part.some((part) => part.file === file.canonicalPath),
      ) === true,
  );
  if (matches.length !== file.mediaIds.length)
    archivePlexProtection("native_archive_plex_coverage_ambiguous");
  const details: { metadata: PlexItem; series: PlexItem | undefined }[] = [];
  for (const item of matches) {
    const metadata = await context.plex.metadata(item.ratingKey, signal);
    const series =
      metadata.grandparentRatingKey === undefined
        ? undefined
        : await context.plex.metadata(metadata.grandparentRatingKey, signal);
    details.push({ metadata, series });
  }
  const items = file.mediaIds.map((mediaId) => {
    const media = scope.media.find((row) => row.id === mediaId);
    if (media === undefined)
      return archivePlexProtection("native_archive_canonical_media_missing");
    const exact = details.filter((detail) =>
      exactPlexIdentity(media, detail.metadata, detail.series),
    );
    const found = exact[0];
    if (found === undefined || exact.length !== 1)
      return archivePlexProtection("native_archive_plex_identity_unproved");
    const parts = found.metadata.Media?.flatMap((entry) => entry.Part) ?? [];
    if (
      parts.length !== 1 ||
      parts[0]?.file !== file.canonicalPath ||
      (parts[0].size !== undefined && String(parts[0].size) !== file.sizeBytes)
    )
      return archivePlexProtection("native_archive_plex_path_changed");
    return {
      mediaId,
      ratingKey: found.metadata.ratingKey,
      sectionId,
      canonicalPath: file.canonicalPath,
      identityHash: snapshotHash({
        server,
        sectionId,
        mediaId,
        path: file.canonicalPath,
        ratingKey: found.metadata.ratingKey,
        guids: found.metadata.Guid ?? [],
        seriesGuids: found.series?.Guid ?? [],
        season: found.metadata.parentIndex ?? null,
        episode: found.metadata.index ?? null,
      }),
    };
  });
  if (new Set(items.map((item) => item.ratingKey)).size !== items.length)
    archivePlexProtection("native_archive_plex_coverage_ambiguous");
  return {
    assetId: file.assetId,
    assetVersion: file.assetVersion,
    checksum: file.checksum,
    mediaIds: file.mediaIds,
    items,
  };
}
