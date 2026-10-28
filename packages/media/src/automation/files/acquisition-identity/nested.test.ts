import { expect, test } from "vitest";
import { z } from "zod";
import {
  FileIdentityEvidenceSchema,
  type AcquisitionIdentitySnapshot,
} from "#shared/acquisition/identity.ts";
import { TvFileIdentityEvidenceV2Schema } from "#shared/acquisition/tv-file-evidence-v2.ts";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { fileIdentityEvidence, assertFileIdentity } from "./evidence.ts";

const leaf = "28921559-38cb-4a54-85fb-63cc9f12c790";
const series = "131ed072-93ce-44af-abcf-509ba57b928e";
const identity: AcquisitionIdentitySnapshot = {
  schemaVersion: 1,
  source: {
    releaseId: "9f9d799f-9549-411d-a990-80e3be223047",
    candidateDigest: "a".repeat(64),
  },
  proof: {
    kind: "automatic",
    basis: "title_year",
    references: [],
    evidenceHash: "b".repeat(64),
  },
  canonical: {
    kind: "series",
    coordinates: {
      schemaVersion: 1,
      seriesId: series,
      seriesVersion: 1,
      catalogComplete: true,
      fullSeriesNumberingDigest: "c".repeat(64),
      digest: "d".repeat(64),
      episodes: [
        {
          mediaId: leaf,
          mediaVersion: 1,
          seriesId: series,
          seasonNumber: 1,
          episodeNumber: 1,
          tmdbEpisodeId: 101,
          absoluteNumber: null,
          numberingProvenance: { kind: "canonical" },
        },
      ],
    },
  },
  coverage: [leaf],
  sponsorRequestId: "4f65a3a1-ec52-4af2-9f25-c3fb8d3b3a79",
  sponsorAuthority: {
    userId: "ce71ad9e-edbb-4dd4-88be-20ce76871a84",
    actorId: "ce71ad9e-edbb-4dd4-88be-20ce76871a84",
    serverMachineId: "fixture-server",
  },
  birthEpoch: 0,
};
const source = { index: 0, name: "Season 01/01.mkv", size: 20, progress: 1 };

function entry(evidence: unknown) {
  return FilePlanEntrySchema.parse({
    identityEvidence: evidence,
    assetId: crypto.randomUUID(),
    mediaIds: [leaf],
    generations: { [leaf]: 1 },
    libraryKind: "tv",
    downloadPath: source.name,
    libraryPath: "Show/Season 01/Show.S01E01.mkv",
    checksum: "e".repeat(64),
    sizeBytes: "20",
    properties: {},
    operationId: crypto.randomUUID(),
    previousAssetId: null,
    previousChecksum: null,
    previousVersion: null,
    previousSidecars: [],
    embeddedSubtitles: [],
  });
}

test("a shorthand member has a distinct validated TV protocol and rechecks its literal file observation", () => {
  const evidence = fileIdentityEvidence(identity, source);
  expect(evidence).toEqual({
    schemaVersion: 2,
    kind: "tv_season_directory",
    attemptIdentityHash: identityHash(identity),
    numberingDigest: "d".repeat(64),
    sourceFile: {
      torrentFileIndex: 0,
      relativePath: source.name,
      sizeBytes: "20",
    },
    parsedCoordinates: {
      forms: [
        { kind: "season_episodes", season: 1, episodes: [1], form: "single" },
      ],
      invalid: false,
    },
    directory: {
      index: 0,
      segment: "Season 01",
      season: 1,
      member: "01.mkv",
      episode: 1,
    },
    coverage: [leaf],
  });
  expect(() =>
    assertFileIdentity(identity, entry(evidence), [source]),
  ).not.toThrow();
  expect(FileIdentityEvidenceSchema.safeParse(evidence).success).toBe(false);
  expect(TvFileIdentityEvidenceV2Schema.safeParse(evidence).success).toBe(true);
  expect(() =>
    assertFileIdentity(identity, entry(evidence), [
      { ...source, name: "Season01/E01.mkv" },
    ]),
  ).toThrow("file_identity_changed");
  expect(() =>
    assertFileIdentity(identity, entry(evidence), [{ ...source, index: 1 }]),
  ).toThrow("torrent_file_identity_changed");
});

test("TV evidence cannot replace its literal directory, member coordinate or reserved coverage", () => {
  const evidence = TvFileIdentityEvidenceV2Schema.parse(
    fileIdentityEvidence(identity, source),
  );
  expect(
    TvFileIdentityEvidenceV2Schema.safeParse({
      ...evidence,
      sourceFile: {
        ...evidence.sourceFile,
        relativePath: "Season02/Season01/01.mkv",
      },
      directory: { ...evidence.directory, index: 1, segment: "Season01" },
    }).success,
  ).toBe(false);
  expect(
    TvFileIdentityEvidenceV2Schema.safeParse({
      ...evidence,
      directory: { ...evidence.directory, episode: 2 },
    }).success,
  ).toBe(false);
  expect(
    TvFileIdentityEvidenceV2Schema.safeParse({
      ...evidence,
      sourceFile: { ...evidence.sourceFile, relativePath: "Other/01.mkv" },
    }).success,
  ).toBe(false);
  const foreign = { ...identity, coverage: [crypto.randomUUID()] };
  expect(() => fileIdentityEvidence(foreign, source)).toThrow(
    "file_coverage_unreserved",
  );
});

test("literal schema1 plans retain their original basename interpretation while new contradictory members are protected", () => {
  const file = { ...source, name: "Season 02/Show.S01E01.mkv" };
  const original = FileIdentityEvidenceSchema.parse({
    schemaVersion: 1,
    attemptIdentityHash: identityHash(identity),
    numberingDigest: "d".repeat(64),
    sourceFile: {
      torrentFileIndex: 0,
      relativePath: file.name,
      sizeBytes: "20",
    },
    parsedCoordinates: {
      forms: [
        { kind: "season_episodes", season: 1, episodes: [1], form: "single" },
      ],
      invalid: false,
    },
    coverage: [leaf],
  });
  const serialized = JSON.stringify(original);
  expect(() =>
    assertFileIdentity(identity, entry(original), [file]),
  ).not.toThrow();
  expect(JSON.stringify(original)).toBe(serialized);
  expect(() => fileIdentityEvidence(identity, file)).toThrow(
    "coordinate_conflict",
  );
});

test("the original movie schema remains an extendable v1 object with literal movie evidence", () => {
  const movie = {
    ...identity,
    canonical: {
      kind: "movie" as const,
      mediaId: leaf,
      mediaVersion: 1,
      catalogDigest: "f".repeat(64),
    },
  };
  const evidence = fileIdentityEvidence(movie, { ...source, name: "Film.mkv" });
  const MovieSchema = FileIdentityEvidenceSchema.extend({
    parsedCoordinates: z.strictObject({ kind: z.literal("movie") }),
  });
  expect(MovieSchema.parse(evidence)).toEqual({
    schemaVersion: 1,
    attemptIdentityHash: identityHash(movie),
    numberingDigest: null,
    sourceFile: {
      torrentFileIndex: 0,
      relativePath: "Film.mkv",
      sizeBytes: "20",
    },
    parsedCoordinates: { kind: "movie" },
    coverage: [leaf],
  });
});
