import type { PlexClient, PlexItem } from "#integrations/plex.ts";
import type { NativeQuarantineScope } from "#shared/native-recovery/quarantine.ts";
import { snapshotHash } from "#migration/profile-import.ts";

type Context = {
  plex: Pick<
    PlexClient,
    "machineIdentifier" | "sections" | "libraryPage" | "activeSessions"
  >;
  expectedServerMachineId: string;
  permittedSections: () => Promise<{ movie: string; series: string }>;
};

/** Complete path inventory proves location only. Missing Plex metadata never proves watched. */
export async function observeQuarantinePlex(
  context: Context,
  scope: NativeQuarantineScope,
  signal: AbortSignal,
) {
  const server = await context.plex.machineIdentifier(signal);
  if (server !== context.expectedServerMachineId)
    throw new Error("Native quarantine Plex server changed");
  const sections = await context.permittedSections();
  const available = await context.plex.sections(signal);
  const protectedPaths = new Set(
    scope.files.flatMap((file) => [
      file.canonicalPath,
      `/data/${file.libraryKind}/.media-control/quarantine/${file.quarantineId}`,
      ...file.sidecars.flatMap((sidecar) => [
        `/data/${file.libraryKind}/${sidecar.libraryPath}`,
        `/data/${file.libraryKind}/.media-control/quarantine/${sidecar.quarantineId}`,
      ]),
    ]),
  );
  const evidence = [];
  for (const kind of ["movies", "tv"] as const) {
    const files = scope.files.filter((file) => file.libraryKind === kind);
    if (files.length === 0) continue;
    const sectionId = kind === "movies" ? sections.movie : sections.series;
    if (
      available.filter(
        (item) =>
          item.key === sectionId &&
          item.type === (kind === "movies" ? "movie" : "show"),
      ).length !== 1
    )
      throw new Error("Native quarantine Plex library changed");
    const items = await completeInventory(
      context,
      { sectionId, kind: kind === "movies" ? "movie" : "episode" },
      signal,
    );
    if (items.some((item) => hasProtectedPart(item, protectedPaths)))
      throw new Error("Native quarantine still has a Plex Part reference");
    for (const file of files)
      evidence.push(...fileAbsence({ scope, file, sectionId, server }));
  }
  assertNoPlayback(
    await context.plex.activeSessions(signal),
    scope,
    protectedPaths,
  );
  signal.throwIfAborted();
  return evidence;
}

function fileAbsence({
  scope,
  file,
  sectionId,
  server,
}: {
  scope: NativeQuarantineScope;
  file: NativeQuarantineScope["files"][number];
  sectionId: string;
  server: string;
}) {
  return file.mediaIds.map((mediaId) => {
    const media = scope.media.find((item) => item.id === mediaId);
    if (media === undefined)
      throw new Error("Native quarantine canonical media missing");
    const catalogId =
      media.kind === "movie" ? media.tmdbId : media.parent?.parent?.tmdbId;
    if (
      catalogId == null ||
      (media.kind === "episode" &&
        (media.seasonNumber === null || media.episodeNumber === null))
    )
      throw new Error("Native quarantine catalog identity is unproven");
    return {
      mediaId,
      sectionId,
      canonicalPath: file.canonicalPath,
      state: "quarantined_absent" as const,
      activePlayback: false as const,
      identityHash: snapshotHash({
        server,
        sectionId,
        mediaId,
        kind: media.kind,
        catalogId,
        season: media.seasonNumber,
        episode: media.episodeNumber,
        canonicalPath: file.canonicalPath,
        groupHash: file.groupHash,
      }),
    };
  });
}

function assertNoPlayback(
  sessions: PlexItem[],
  scope: NativeQuarantineScope,
  protectedPaths: ReadonlySet<string>,
) {
  const knownRatingKeys = new Set(
    scope.media.flatMap((item) => {
      const ids = item.externalIds;
      return typeof ids === "object" &&
        ids !== null &&
        !Array.isArray(ids) &&
        typeof ids["plexRatingKey"] === "string"
        ? [ids["plexRatingKey"]]
        : [];
    }),
  );
  if (
    sessions.some(
      (item) =>
        knownRatingKeys.has(item.ratingKey) ||
        hasProtectedPart(item, protectedPaths) ||
        item.Media === undefined ||
        item.Media.length === 0 ||
        item.Media.some((media) => media.Part.length === 0),
    )
  )
    throw new Error("Native quarantine playback is active or unproven");
}

function hasProtectedPart(item: PlexItem, paths: ReadonlySet<string>) {
  return (
    item.Media?.some((media) =>
      media.Part.some((part) => paths.has(part.file)),
    ) === true
  );
}

async function completeInventory(
  context: Context,
  input: { sectionId: string; kind: "movie" | "episode" },
  signal: AbortSignal,
) {
  const items: PlexItem[] = [];
  let expected: number | undefined;
  for (let page = 0; page < 50; page++) {
    const current = await context.plex.libraryPage(
      { ...input, offset: items.length, limit: 200 },
      signal,
    );
    if (
      current.total > 10_000 ||
      (expected !== undefined && current.total !== expected)
    )
      throw new Error(
        "Native quarantine Plex inventory changed or exceeds bound",
      );
    expected = current.total;
    items.push(...current.items);
    if (
      items.length > expected ||
      new Set(items.map((item) => item.ratingKey)).size !== items.length
    )
      throw new Error("Native quarantine Plex inventory is ambiguous");
    if (items.length === expected) return items;
    if (current.items.length === 0) break;
  }
  throw new Error("Native quarantine Plex inventory is incomplete");
}
