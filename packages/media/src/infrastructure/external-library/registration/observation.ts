import { z } from "zod";
import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { PlexItem } from "#integrations/plex.ts";
import type { ExternalLibraryPreviewInput } from "#shared/external-library/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { externalInventoryMatches } from "#infrastructure/external-library/availability.ts";
import {
  ExternalPlexObservationSchema,
  type ExternalLibrarySettings,
} from "./contract.ts";

function protectedPlex(message: string): never {
  throw new MediaError("external_library_identity_changed", message, 409);
}
function plexValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? parsed.data
    : protectedPlex("Plex hierarchy or coordinate is missing or invalid");
}
function guids(item: PlexItem) {
  return [...new Set((item.Guid ?? []).map((guid) => guid.id))].sort();
}
function physical(
  item: PlexItem,
  sectionId: string,
  kind: "movie" | "episode",
) {
  if (
    item.type !== kind ||
    String(item.librarySectionID) !== sectionId ||
    item.Media?.length !== 1 ||
    item.Media[0]?.Part.length !== 1
  )
    return protectedPlex(
      "Select one exact configured Plex item with one physical Part",
    );
  const part = item.Media[0].Part[0];
  if (
    part === undefined ||
    !Number.isSafeInteger(part.id) ||
    part.id <= 0 ||
    !z.int().positive().safeParse(part.size).success
  )
    return protectedPlex("Plex Part identity or exact byte size is missing");
  const root = kind === "movie" ? "/data/movies/" : "/data/tv/";
  if (
    !part.file.startsWith(root) ||
    path.posix.normalize(part.file) !== part.file ||
    part.file.split("/").includes(".media-control") ||
    /[\0\r\n\\]/u.test(part.file)
  )
    return protectedPlex("Plex Part is outside the canonical visible library");
  return {
    partId: String(part.id),
    canonicalPath: part.file,
    sizeBytes: String(part.size),
  };
}
function rootTmdb(item: PlexItem): number {
  const ids = guids(item).filter((guid) => guid.startsWith("tmdb://"));
  if (ids.length !== 1)
    return protectedPlex(
      "Plex must expose one unambiguous canonical TMDB GUID before registration",
    );
  const match = /^tmdb:\/\/([1-9]\d*)$/u.exec(ids[0] ?? "");
  const id = Number(match?.[1]);
  return !Number.isSafeInteger(id) || id <= 0
    ? protectedPlex("Plex TMDB GUID is invalid")
    : id;
}

/** Fresh PMS facts plus the complete normal-inventory path cohort; no file or ownership writes. */
export async function observeExternalLibrary(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  input: ExternalLibraryPreviewInput,
  settings: ExternalLibrarySettings,
) {
  const plex = await settings.ownerClient(actor);
  const signal = AbortSignal.timeout(20_000);
  const configured = await settings.sections();
  const sectionId =
    input.sectionType === "movie" ? configured.movie : configured.series;
  const [machine, sections] = await Promise.all([
    plex.machineIdentifier(signal),
    plex.sections(signal),
  ]);
  if (
    machine !== settings.serverMachineId ||
    sections.filter(
      (section) =>
        section.key === sectionId && section.type === input.sectionType,
    ).length !== 1
  )
    return protectedPlex("Configured Plex server or section changed");
  const cache = new Map<string, Promise<PlexItem>>();
  const metadata = (id: string) => {
    const existing = cache.get(id);
    if (existing !== undefined) return existing;
    const read = plex.metadata(id, signal);
    cache.set(id, read);
    return read;
  };
  const kind = input.sectionType === "movie" ? "movie" : "episode";
  const selected = await metadata(input.ratingKey);
  const selectedPart = physical(selected, sectionId, kind);
  const latest = await db.reconciliationScan.findFirst({
    where: { kind: "inventory", progress: { path: ["section"], gte: 2 } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  if (latest === null)
    return protectedPlex("Normal Plex source collection has not completed");
  const cohort = await db.plexInventoryObservation.findMany({
    where: { sectionId, path: selectedPart.canonicalPath, scanId: latest.id },
    orderBy: { ratingKey: "asc" },
    take: 26,
  });
  if (
    cohort.length === 0 ||
    cohort.length > 25 ||
    !cohort.some((row) => row.ratingKey === input.ratingKey)
  )
    return protectedPlex(
      "Complete bounded Plex inventory coverage is required",
    );
  const items = await Promise.all(cohort.map((row) => metadata(row.ratingKey)));
  const { root, members } = await observeMembers(
    items,
    { kind, sectionId, selectedPart },
    metadata,
  );
  const observed = ExternalPlexObservationSchema.parse({
    serverMachineId: machine,
    sectionId,
    sectionType: input.sectionType,
    canonicalPath: selectedPart.canonicalPath,
    sizeBytes: selectedPart.sizeBytes,
    observedEditionTitle:
      kind === "movie" ? (selected.editionTitle ?? null) : null,
    root: {
      ratingKey: root.ratingKey,
      kind: kind === "movie" ? "movie" : "series",
      tmdbId: rootTmdb(root),
      title: root.title,
      year: root.year ?? null,
      guids: guids(root),
    },
    members,
  });
  return externalInventoryMatches(observed, cohort, [latest], new Date())
    ? observed
    : protectedPlex(
        "Normal Plex source collection is incomplete, stale or differs from fresh metadata",
      );
}

async function observeMembers(
  items: PlexItem[],
  context: {
    kind: "movie" | "episode";
    sectionId: string;
    selectedPart: ReturnType<typeof physical>;
  },
  metadata: (id: string) => Promise<PlexItem>,
) {
  const { kind, sectionId, selectedPart } = context;
  let root: PlexItem | undefined;
  const members = [];
  for (const item of items) {
    const part = physical(item, sectionId, kind);
    if (
      part.canonicalPath !== selectedPart.canonicalPath ||
      part.sizeBytes !== selectedPart.sizeBytes
    )
      return protectedPlex(
        "Inventory members no longer share the same exact physical Part",
      );
    const show =
      kind === "episode" ? await episodeRoot(item, sectionId, metadata) : item;
    if (root !== undefined && identityHash(root) !== identityHash(show))
      return protectedPlex("Physical coverage spans different canonical roots");
    root = show;
    members.push({
      ratingKey: item.ratingKey,
      partId: part.partId,
      guids: guids(item),
      parentRatingKey: item.parentRatingKey ?? null,
      seasonNumber:
        kind === "episode"
          ? plexValue(z.int().nonnegative(), item.parentIndex)
          : null,
      episodeNumber:
        kind === "episode"
          ? plexValue(z.int().nonnegative(), item.index)
          : null,
    });
  }
  if (root === undefined)
    throw new Error("External physical cohort lost its root");
  return { root, members };
}

async function episodeRoot(
  item: PlexItem,
  sectionId: string,
  metadata: (id: string) => Promise<PlexItem>,
) {
  const parentKey = plexValue(
    z.string().regex(/^[1-9]\d*$/u),
    item.parentRatingKey,
  );
  const showKey = plexValue(
    z.string().regex(/^[1-9]\d*$/u),
    item.grandparentRatingKey,
  );
  const season = await metadata(parentKey);
  const show = await metadata(showKey);
  return season.type !== "season" ||
    show.type !== "show" ||
    season.parentRatingKey !== show.ratingKey ||
    season.index !== item.parentIndex ||
    String(season.librarySectionID) !== sectionId ||
    String(show.librarySectionID) !== sectionId
    ? protectedPlex("Plex episode, season and show hierarchy changed")
    : show;
}
