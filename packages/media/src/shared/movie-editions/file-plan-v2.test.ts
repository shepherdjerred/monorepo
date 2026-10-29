import { expect, test } from "vitest";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import { parseMovieCutV2 } from "#domain/editions/parse-v2.ts";
import { MovieFilePlanV2Schema } from "./file-plan-v2.ts";
import { movieEditionDefinition, type MovieEditionKey } from "./registry.ts";

const mediaId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const choiceId = "10000000-0000-4000-8000-000000000004";
const attemptId = "10000000-0000-4000-8000-000000000005";
const assetId = "10000000-0000-4000-8000-000000000006";
const operationId = "10000000-0000-4000-8000-000000000007";

function plan(edition: MovieEditionKey = "extended_cut") {
  const definition = movieEditionDefinition(mediaId, edition);
  const title = `Example.Film.2026.${definition.plexLabel}.1080p`;
  const relativePath = `${title}.mkv`;
  const canonical = {
    rootMediaId: mediaId,
    title: "Example Film",
    aliases: [],
    digest: "a".repeat(64),
  };
  const candidate = parseMovieCutV2({
    source: {
      kind: "provider",
      providerId: "knaben",
      providerReleaseId: "synthetic",
    },
    sourceDigest: "b".repeat(64),
    canonical,
    attribution: "provider_texts",
    texts: [
      { text: title, provenance: { kind: "release-title", field: "title" } },
    ],
  });
  const member = parseMovieCutV2({
    source: { kind: "member", attemptId, torrentFileIndex: 0 },
    sourceDigest: "c".repeat(64),
    canonical,
    attribution: "torrent_member",
    texts: [
      {
        text: relativePath,
        provenance: { kind: "release-title", field: "member.relativePath" },
      },
    ],
  });
  return {
    schemaVersion: 2,
    attemptId,
    scope: { rootMediaId: mediaId, mediaId, edition },
    birth: {
      schemaVersion: 1,
      choiceId,
      choiceRevision: 1,
      sponsorRequestId: requestId,
      requestVersionAtCapture: 1,
      rootMediaId: mediaId,
      mediaId,
      edition,
      definitionVersion: 0,
      definitionDigest: "d".repeat(64),
      targetGenerationAtCapture: 2,
      actorId: userId,
      subjectUserId: userId,
    },
    entries: [
      {
        assetId,
        mediaIds: [mediaId],
        generations: { [mediaId]: 2 },
        libraryKind: "movies",
        downloadPath: `${attemptId}/${relativePath}`,
        libraryPath: `synthetic/${relativePath}`,
        checksum: "e".repeat(64),
        sizeBytes: "12",
        properties: {},
        operationId,
        previousAssetId: null,
        previousChecksum: null,
        previousVersion: null,
        previousSidecars: [],
        embeddedSubtitles: [],
        identityEvidence: {
          schemaVersion: 1,
          attemptIdentityHash: "f".repeat(64),
          numberingDigest: null,
          sourceFile: { torrentFileIndex: 0, relativePath, sizeBytes: "12" },
          parsedCoordinates: { kind: "movie" },
          coverage: [mediaId],
        },
        editionEvidence: { candidate, member },
      },
    ],
  };
}

test("a new movie plan binds its explicit choice, exact file and matching cut evidence", () => {
  const input = plan();
  expect(MovieFilePlanV2Schema.parse(input)).toEqual(input);
  expect(MovieFilePlanV2Schema.parse(plan("default")).scope.edition).toBe(
    "default",
  );
});

test.each([
  "birth",
  "generation",
  "index",
  "path",
  "size",
  "coverage",
  "cut",
  "canonical",
])(
  "a %s substitution cannot borrow an otherwise valid movie file plan",
  (change) => {
    const input = MovieFilePlanV2Schema.parse(plan());
    const entry = input.entries[0];
    if (change === "birth") input.birth.edition = "directors_cut";
    if (change === "generation") entry.generations[mediaId] = 3;
    if (change === "index")
      entry.identityEvidence.sourceFile.torrentFileIndex = 1;
    if (change === "path")
      entry.identityEvidence.sourceFile.relativePath = "Other.mkv";
    if (change === "size") entry.identityEvidence.sourceFile.sizeBytes = "13";
    if (change === "coverage") entry.mediaIds.push(userId);
    if (change === "cut")
      entry.editionEvidence.member.conclusion = {
        kind: "named",
        cut: "final_cut",
      };
    if (change === "canonical")
      entry.editionEvidence.member.canonicalDigest = "0".repeat(64);
    expect(MovieFilePlanV2Schema.safeParse(input).success).toBe(false);
  },
);

test("versioned plans cannot be confused with or silently replace literal historical entries", () => {
  const input = MovieFilePlanV2Schema.parse(plan());
  const { editionEvidence: _editionEvidence, ...legacy } = input.entries[0];
  const historical = JSON.stringify(legacy);
  expect(FilePlanEntrySchema.parse(legacy)).toEqual(legacy);
  expect(MovieFilePlanV2Schema.safeParse([legacy]).success).toBe(false);
  expect(
    MovieFilePlanV2Schema.safeParse({ ...input, schemaVersion: 3 }).success,
  ).toBe(false);
  expect(
    MovieFilePlanV2Schema.safeParse({ ...input, grantOverride: true }).success,
  ).toBe(false);
  expect(JSON.stringify(legacy)).toBe(historical);
});
