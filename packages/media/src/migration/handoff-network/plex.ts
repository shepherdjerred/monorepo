import { z } from "zod";
import type { PlexItem } from "#integrations/plex.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { protectedEvidence, type HandoffNetworkContext } from "./context.ts";

type Media = {
  id: string;
  kind: string;
  tmdbId: number | null;
  externalIds: unknown;
  seasonNumber: number | null;
  episodeNumber: number | null;
  parent?: { parent?: { tmdbId: number | null } | null } | null;
};
type File = {
  canonicalPath: string;
  sizeBytes: string;
  mediaIds: string[];
  libraryKind: "movies" | "tv";
};
export type PlexCoverageInput = { media: Media[]; scope: { files: File[] } };
type Context = Pick<
  HandoffNetworkContext,
  "plex" | "expectedServerMachineId" | "permittedSections"
>;
const ExternalIds = z.object({
  imdb: z.string().nullable().optional(),
  seriesTmdb: z.number().int().positive().optional(),
});
export function exactPlexIdentity(
  media: Media,
  item: PlexItem,
  series?: PlexItem,
) {
  const external = ExternalIds.parse(media.externalIds);
  const identity = media.kind === "episode" ? series : item;
  const ids = identity?.Guid?.map((guid) => guid.id) ?? [];
  const expectedTmdb =
    media.kind === "episode"
      ? (media.parent?.parent?.tmdbId ?? external.seriesTmdb)
      : media.tmdbId;
  if (expectedTmdb == null || !ids.includes(`tmdb://${String(expectedTmdb)}`))
    return false;
  if (
    ids.some(
      (id) =>
        id.startsWith("tmdb://") && id !== `tmdb://${String(expectedTmdb)}`,
    )
  )
    return false;
  const imdb = external.imdb;
  return media.kind === "episode"
    ? item.type === "episode" &&
        series?.type === "show" &&
        item.index === media.episodeNumber &&
        item.parentIndex === media.seasonNumber
    : media.kind === "movie" &&
        item.type === "movie" &&
        !(
          imdb != null &&
          ids.some((id) => id.startsWith("imdb://") && id !== `imdb://${imdb}`)
        );
}

async function scanSection(
  context: Context,
  sectionId: string,
  kind: "movie" | "episode",
  signal: AbortSignal,
) {
  const items: PlexItem[] = [];
  let total: number | undefined;
  for (let page = 0; page < 50; page++) {
    signal.throwIfAborted();
    const result = await context.plex.libraryPage(
      { sectionId, kind, offset: items.length, limit: 200 },
      signal,
    );
    if (
      (total !== undefined && result.total !== total) ||
      result.total > 10_000
    )
      throw protectedEvidence("handoff_plex_inventory_changed_or_large");
    total = result.total;
    items.push(...result.items);
    if (
      new Set(items.map((item) => item.ratingKey)).size !== items.length ||
      items.length > total
    )
      throw protectedEvidence("handoff_plex_inventory_ambiguous");
    if (items.length === total) return items;
    if (result.items.length === 0) break;
  }
  throw protectedEvidence("handoff_plex_inventory_incomplete");
}

export async function observePlex(
  context: Context,
  input: PlexCoverageInput,
  signal: AbortSignal,
) {
  const server = await context.plex.machineIdentifier(signal);
  if (server !== context.expectedServerMachineId)
    throw protectedEvidence("handoff_plex_server_changed");
  const sections = await context.permittedSections();
  const available = await context.plex.sections(signal);
  const evidence = [];
  for (const kind of ["movies", "tv"] as const) {
    const files = input.scope.files.filter((file) => file.libraryKind === kind);
    if (files.length === 0) continue;
    const sectionId = kind === "movies" ? sections.movie : sections.series;
    if (
      available.filter(
        (section) =>
          section.key === sectionId &&
          section.type === (kind === "movies" ? "movie" : "show"),
      ).length !== 1
    )
      throw protectedEvidence("handoff_plex_library_changed");
    const items = await scanSection(
      context,
      sectionId,
      kind === "movies" ? "movie" : "episode",
      signal,
    );
    for (const file of files)
      evidence.push(
        ...(await matchFile({
          context,
          input,
          signal,
          server,
          sectionId,
          items,
          file,
        })),
      );
  }
  return evidence;
}

async function matchFile({
  context,
  input,
  signal,
  server,
  sectionId,
  items,
  file,
}: {
  context: Context;
  input: PlexCoverageInput;
  signal: AbortSignal;
  server: string;
  sectionId: string;
  items: PlexItem[];
  file: File;
}) {
  const matches = items.filter(
    (item) =>
      item.Media?.some((media) =>
        media.Part.some((part) => part.file === file.canonicalPath),
      ) === true,
  );
  if (matches.length !== file.mediaIds.length)
    throw protectedEvidence("handoff_plex_coverage_ambiguous");
  const details = [];
  for (const item of matches) {
    signal.throwIfAborted();
    const metadata = await context.plex.metadata(item.ratingKey, signal);
    const series =
      metadata.grandparentRatingKey === undefined
        ? undefined
        : await context.plex.metadata(metadata.grandparentRatingKey, signal);
    details.push({ metadata, series });
  }
  const evidence = [];
  for (const mediaId of file.mediaIds) {
    const media = input.media.find((item) => item.id === mediaId);
    if (!media) throw protectedEvidence("handoff_plex_media_missing");
    const exact = details.filter((detail) =>
      exactPlexIdentity(media, detail.metadata, detail.series),
    );
    const found = exact[0];
    if (!found || exact.length !== 1)
      throw protectedEvidence("handoff_plex_identity_unproved");
    const parts = found.metadata.Media?.flatMap((item) => item.Part) ?? [];
    if (
      parts.length !== 1 ||
      parts[0]?.file !== file.canonicalPath ||
      (parts[0].size !== undefined && String(parts[0].size) !== file.sizeBytes)
    )
      throw protectedEvidence("handoff_plex_path_changed");
    evidence.push({
      mediaId,
      ratingKey: found.metadata.ratingKey,
      sectionId,
      canonicalPath: file.canonicalPath,
      identityHash: snapshotHash({
        server,
        sectionId,
        mediaId,
        ratingKey: found.metadata.ratingKey,
        path: file.canonicalPath,
        guids: found.metadata.Guid ?? [],
        seriesGuids: found.series?.Guid ?? [],
        season: found.metadata.parentIndex ?? null,
        episode: found.metadata.index ?? null,
      }),
    });
  }
  return evidence;
}
