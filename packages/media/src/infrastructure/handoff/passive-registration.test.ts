import { expect, test } from "vitest";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  initialLibraryAssetVersion,
  validatePassiveRegistration,
} from "./passive-registration.ts";
import { MigrationRecordSchema } from "#shared/migration.ts";
import { LibrarySeriesMonitoringV1Schema } from "#shared/handoff/library-v3.ts";
import { canonicalJson } from "#migration/profile-import.ts";

function fixture() {
  const assetId = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  const registrationEventId = crypto.randomUUID();
  const registration = {
    schemaVersion: 1 as const,
    source: "plex" as const,
    registrationEventId,
    registeredAt: "2026-11-13T00:00:00.000Z",
    serverMachineId: "server",
    sectionId: "1",
    sectionType: "movie" as const,
    rootMediaId: mediaId,
    rootTmdbId: 42,
    rootYear: 2020,
    rootCatalogIdentityHash: "a".repeat(64),
    edition: "default" as const,
    observedEditionTitle: null,
    canonicalEdition: null,
    editionConfidence: "unknown" as const,
    members: [
      {
        mediaId,
        ratingKey: "99",
        partId: "101",
        guids: ["tmdb://42"],
        seasonNumber: null,
        episodeNumber: null,
      },
    ],
    canonicalPath: "/movies/Example.mkv",
    sizeBytes: "1000",
  };
  const registrationHash = identityHash(registration);
  return {
    approval: {
      provenanceKey: "b".repeat(64),
      assetId,
      expectedVersion: 0 as const,
      registrationEventId,
      registrationHash,
      registrationRaw: canonicalJson(registration),
    },
    file: {
      assetId,
      existingAssetId: assetId,
      existingAssetVersion: 0,
      canonicalPath: registration.canonicalPath,
      mediaIds: [mediaId],
      sizeBytes: "1000",
      libraryKind: "movies" as const,
      provenanceKey: "b".repeat(64),
    },
    asset: {
      id: assetId,
      version: 0,
      owned: false,
      ownershipEpoch: -1,
      torrentId: null,
      checksum: null,
      sourcePath: null,
      state: "published",
      edition: "default",
      editionRootId: mediaId,
      path: registration.canonicalPath,
      sizeBytes: 1000n,
      properties: { externalLibrary: registration },
      coverage: [{ assetId, mediaId, edition: "default", current: true }],
    },
    event: {
      id: registrationEventId,
      kind: "external_library_registered",
      mediaId,
      payload: { registration, registrationHash },
    },
  };
}

test("only an explicit exact passive registration lineage permits a version-one library parent", () => {
  const value = fixture();
  expect(validatePassiveRegistration(value).members[0]?.partId).toBe("101");
  expect(
    initialLibraryAssetVersion(
      { schemaVersion: 3, registeredAssets: [value.approval] },
      value.file,
    ),
  ).toBe(1);
  expect(() =>
    initialLibraryAssetVersion({ schemaVersion: 3 }, value.file),
  ).toThrow();
  expect(
    initialLibraryAssetVersion(
      { schemaVersion: 2 },
      { ...value.file, existingAssetId: null },
    ),
  ).toBe(0);
  expect(() =>
    initialLibraryAssetVersion(
      { schemaVersion: 3, registeredAssets: [value.approval] },
      { ...value.file, existingAssetVersion: 1 },
    ),
  ).toThrow();
});

test.each([
  { owned: true },
  { ownershipEpoch: 0 },
  { version: 1 },
  { torrentId: "foreign-torrent" },
  { checksum: "c".repeat(64) },
  { sourcePath: "/different.mkv" },
  { state: "quarantined" },
  { edition: "directors_cut" },
  { path: "/movies/moved.mkv" },
  { sizeBytes: 999n },
])(
  "passive promotion rejects altered or already-managed asset case %#",
  (change) => {
    const value = fixture();
    expect(() =>
      validatePassiveRegistration({
        ...value,
        asset: { ...value.asset, ...change },
      }),
    ).toThrow();
  },
);

test("passive promotion rejects substituted registration events, hashes and incomplete shared coverage", () => {
  const value = fixture();
  expect(() =>
    validatePassiveRegistration({
      ...value,
      event: { ...value.event, kind: "handoff_applied" },
    }),
  ).toThrow();
  expect(() =>
    validatePassiveRegistration({
      ...value,
      approval: { ...value.approval, registrationHash: "f".repeat(64) },
    }),
  ).toThrow();
  expect(() =>
    validatePassiveRegistration({
      ...value,
      asset: { ...value.asset, coverage: [] },
    }),
  ).toThrow();
  expect(() =>
    validatePassiveRegistration({
      ...value,
      asset: {
        ...value.asset,
        coverage: value.asset.coverage.map((item) => ({
          ...item,
          current: false,
        })),
      },
    }),
  ).toThrow();
});

test("new migration metadata does not materialize absent historical hash fields", () => {
  const request = {
    kind: "request",
    sourceId: "1",
    requesterSourceId: "2",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: 42 },
    scope: "movie",
    seasons: [],
    active: true,
  };
  expect(identityHash(MigrationRecordSchema.parse(request))).toBe(
    identityHash(request),
  );
  const policy = {
    schemaVersion: 1,
    seriesId: crypto.randomUUID(),
    title: "Example",
    provenanceKey: "a".repeat(64),
    includeFutureEpisodes: true,
    includeSpecials: false,
  };
  expect(identityHash(LibrarySeriesMonitoringV1Schema.parse(policy))).toBe(
    identityHash(policy),
  );
});
