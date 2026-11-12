import { randomInt } from "node:crypto";
import type { Database } from "#infrastructure/database.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";
import { CatalogIdentitySchema } from "#shared/acquisition/catalog.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PrismaExternalLibraryRegistration } from "#infrastructure/external-library/registration/service.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";

/** Real registration and canonical rows; only the external Plex HTTP transport is synthetic. */
export async function externalLibraryFixture(
  db: Database,
  kind: "movie" | "episode" = "movie",
) {
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "External library owner",
      role: "owner",
    },
  });
  const rootKind = kind === "movie" ? "movie" : "series";
  const tmdbId = randomInt(1_000_000, 2_000_000_000);
  const catalogIdentity = CatalogIdentitySchema.parse({
    schemaVersion: 1,
    references: [{ kind: rootKind, namespace: "tmdb", value: String(tmdbId) }],
    originalTitle: "External Example",
    aliases: [],
    evidenceDigest: identityHash({ tmdbId }),
  });
  const root = await db.mediaItem.create({
    data: {
      kind: rootKind,
      title: "External Example",
      year: 2024,
      tmdbId,
      externalIds: { catalogIdentity },
    },
  });
  const season =
    kind === "movie"
      ? null
      : await db.mediaItem.create({
          data: {
            kind: "season",
            title: "Season 1",
            parentId: root.id,
            seasonNumber: 1,
          },
        });
  const media =
    season === null
      ? root
      : await db.mediaItem.create({
          data: {
            kind: "episode",
            title: "Episode 1",
            parentId: season.id,
            seasonNumber: 1,
            episodeNumber: 1,
            tmdbId: tmdbId + 1,
          },
        });
  const sectionId = kind === "movie" ? "1" : "2";
  const sectionType: "movie" | "show" = kind === "movie" ? "movie" : "show";
  const canonicalPath =
    kind === "movie"
      ? `/data/movies/External Example ${root.id} (2024)/External Example.mkv`
      : `/data/tv/External Example ${root.id}/Season 01/External Example S01E01.mkv`;
  const selected: PlexItem = {
    ratingKey: "100",
    type: kind,
    title: media.title,
    year: 2024,
    librarySectionID: Number(sectionId),
    Guid: [{ id: `tmdb://${String(media.tmdbId)}` }],
    Media: [{ Part: [{ id: 1000, file: canonicalPath, size: 12_345 }] }],
    ...(kind === "episode"
      ? {
          parentRatingKey: "200",
          grandparentRatingKey: "300",
          parentIndex: 1,
          index: 1,
        }
      : {}),
  };
  const plexItems = new Map<string, PlexItem>([[selected.ratingKey, selected]]);
  if (season !== null) {
    plexItems.set("200", {
      ratingKey: "200",
      type: "season",
      title: season.title,
      librarySectionID: 2,
      parentRatingKey: "300",
      index: 1,
    });
    plexItems.set("300", {
      ratingKey: "300",
      type: "show",
      title: root.title,
      year: 2024,
      librarySectionID: 2,
      Guid: [{ id: `tmdb://${String(tmdbId)}` }],
    });
  }
  const sourceScan = await db.reconciliationScan.create({
    data: {
      id: crypto.randomUUID(),
      kind: "inventory",
      state: "running",
      progress: { section: 2, offset: 0 },
    },
  });
  await db.plexInventoryObservation.create({
    data: {
      sectionId,
      ratingKey: selected.ratingKey,
      path: canonicalPath,
      kind,
      guids: selected.Guid ?? [],
      seasonNumber: kind === "episode" ? 1 : null,
      episodeNumber: kind === "episode" ? 1 : null,
      scanId: sourceScan.id,
    },
  });
  const serverMachineId = "external-fixture-server";
  await grantTestRequesterAccess(db, owner.id, serverMachineId);
  const plex = new PlexClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "external-fixture",
    },
    (url) => {
      if (url.pathname === "/identity")
        return Promise.resolve(
          Response.json({
            MediaContainer: { machineIdentifier: serverMachineId },
          }),
        );
      if (url.pathname === "/library/sections")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 2,
              Directory: [
                { key: "1", type: "movie", title: "Movies" },
                { key: "2", type: "show", title: "TV" },
              ],
            },
          }),
        );
      const item = plexItems.get(url.pathname.split("/").at(-1) ?? "");
      if (item === undefined)
        throw new Error(`Unexpected Plex fixture request: ${url.pathname}`);
      return Promise.resolve(
        Response.json({ MediaContainer: { size: 1, Metadata: [item] } }),
      );
    },
  );
  const service = new PrismaExternalLibraryRegistration(db, {
    serverMachineId,
    sections: () => Promise.resolve({ movie: "1", series: "2" }),
    ownerClient: () => Promise.resolve(plex),
  });
  const input = { sectionType, ratingKey: selected.ratingKey };
  return {
    db,
    owner,
    service,
    application: new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId,
      visibilitySections: { movie: "1", series: "2" },
    }),
    input,
    plexItems,
    root,
    media,
    sourceScan,
    access: { serverMachineId, sectionId, sectionType },
    register: async () => {
      const preview = await service.preview(owner, crypto.randomUUID(), input);
      const result = await service.apply(owner, crypto.randomUUID(), {
        previewOperationId: preview.operationId,
        previewHash: preview.previewHash,
      });
      return { preview, result };
    },
  };
}
