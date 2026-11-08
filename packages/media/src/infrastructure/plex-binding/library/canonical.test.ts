import { expect, test } from "vitest";
import { buildMigrationBundle } from "#migration/bundle.ts";
import {
  captureFixture,
  mediaFixture,
} from "#migration/bundle-test-fixtures.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { PlexCanonicalTargetSchema } from "#shared/plex-binding/canonical.ts";
import {
  assertLibraryCanonicalBirth,
  libraryCanonicalBirth,
} from "./canonical.ts";

function fixture(kind: "movie" | "episode") {
  const root = mediaFixture("root:1", kind === "movie" ? "movie" : "series", {
    tmdb: 42,
  });
  const leaves: MigrationRecord[] =
    kind === "movie"
      ? [root]
      : [1, 2].map((episode) => ({
          ...root,
          mediaKind: "episode",
          sourceId: `episode:${String(episode)}`,
          parentSourceId: root.sourceId,
          externalIds: {},
          season: 0,
          episode,
        }));
  const source: MigrationRecord = {
    kind: "file",
    sourceId: "file:1",
    mediaSourceIds: leaves.map((leaf) => leaf.sourceId),
    path: "/library/title.mkv",
    sizeBytes: 128,
    checksum: null,
    downloadHash: null,
    qualitySourceId: null,
  };
  const media = kind === "movie" ? leaves : [root, ...leaves];
  const targets = media.map((record) => {
    if (record.kind !== "media") throw new Error("Expected fixture media");
    return {
      mediaId: crypto.randomUUID(),
      kind: record.mediaKind,
      externalIds: record.externalIds,
      seriesExternalIds: root.externalIds,
      season: record.season,
      episode: record.episode,
      checksum: null,
    };
  });
  const bundle = buildMigrationBundle(
    [
      {
        id: crypto.randomUUID(),
        snapshot: captureFixture(
          "radarr",
          kind === "movie" ? [...media, source] : [],
        ),
      },
      {
        id: crypto.randomUUID(),
        snapshot: captureFixture(
          "sonarr",
          kind === "episode" ? [...media, source] : [],
        ),
      },
    ],
    { targets, requesters: [] },
    "initial_library",
  );
  const entry = bundle.report.entries.find(
    (item) => item.sourceId === source.sourceId,
  );
  if (entry === undefined) throw new Error("Expected normalized file");
  const entries = bundle.report.entries.filter(
    (item) => item.captureHash === entry.captureHash,
  );
  const file = {
    provenanceKey: entry.provenanceKey,
    sourcePath: source.path,
    sizeBytes: String(source.sizeBytes),
    libraryKind: kind === "movie" ? ("movies" as const) : ("tv" as const),
    mediaIds: entry.mediaIds,
  };
  const rootId = targets[0]?.mediaId;
  const canonical = entry.mediaIds.map((mediaId) => {
    const target = targets.find((item) => item.mediaId === mediaId);
    if (target === undefined) throw new Error("Expected canonical target");
    return PlexCanonicalTargetSchema.parse({
      kind,
      scope: { mediaId, edition: "default" },
      canonicalRootId: rootId,
      references: [{ kind: root.mediaKind, namespace: "tmdb", value: "42" }],
      canonicalIdentityHash: "a".repeat(64),
      numberingHash: "b".repeat(64),
      ...(kind === "movie"
        ? {}
        : {
            coordinate: {
              mediaId,
              mediaVersion: 4,
              seriesId: rootId,
              seasonNumber: target.season,
              episodeNumber: target.episode,
              tmdbEpisodeId: null,
              absoluteNumber: null,
              numberingProvenance: { kind: "canonical" },
            },
          }),
    });
  });
  return { file, entries, canonical };
}

test.each(["movie", "episode"] as const)(
  "%s birth accepts catalog refresh and rejects work remapping",
  (kind) => {
    const f = fixture(kind);
    const birth = libraryCanonicalBirth(f.file, f.entries);
    expect(() => assertLibraryCanonicalBirth(birth, f.canonical)).not.toThrow();
    f.canonical[0]?.references.push({
      kind: kind === "movie" ? "movie" : "series",
      namespace: "imdb",
      value: "tt123",
    });
    expect(() => assertLibraryCanonicalBirth(birth, f.canonical)).not.toThrow();
    const reference = f.canonical[0]?.references[0];
    if (reference === undefined)
      throw new Error("Expected canonical reference");
    reference.value = "43";
    expect(() => assertLibraryCanonicalBirth(birth, f.canonical)).toThrow(
      PlexBindingProtection,
    );
  },
);

test("one physical TV file requires every original special episode and exact numbering", () => {
  const f = fixture("episode");
  const birth = libraryCanonicalBirth(f.file, f.entries);
  expect(birth).toHaveLength(2);
  expect(() =>
    assertLibraryCanonicalBirth(birth, f.canonical.slice(0, 1)),
  ).toThrow(PlexBindingProtection);
  const first = f.canonical[0];
  if (first?.kind !== "episode") throw new Error("Expected episode");
  first.coordinate.seasonNumber = 1;
  expect(() => assertLibraryCanonicalBirth(birth, f.canonical)).toThrow(
    PlexBindingProtection,
  );
  expect(() =>
    libraryCanonicalBirth(
      { ...f.file, mediaIds: [first.scope.mediaId] },
      f.entries,
    ),
  ).toThrow("file changed");
});

test("partial catalog enrichment accepts a shared source ID and rejects a conflicting provider ID", () => {
  const f = fixture("movie");
  const birth = libraryCanonicalBirth(f.file, f.entries);
  const original = birth[0];
  const current = f.canonical[0];
  if (original === undefined || current === undefined)
    throw new Error("Expected movie birth");
  original.references.tvdb = 99;
  expect(() => assertLibraryCanonicalBirth(birth, f.canonical)).not.toThrow();
  current.references.push({ kind: "movie", namespace: "tvdb", value: "100" });
  expect(() => assertLibraryCanonicalBirth(birth, f.canonical)).toThrow(
    PlexBindingProtection,
  );
});

test("source IDs cannot resolve through a foreign capture or duplicate record", () => {
  const f = fixture("episode");
  const root = f.entries.find(
    (entry) =>
      entry.sourceRecord.kind === "media" &&
      entry.sourceRecord.mediaKind === "series",
  );
  if (root === undefined) throw new Error("Expected source root");
  expect(() =>
    libraryCanonicalBirth(
      f.file,
      f.entries.filter((entry) => entry !== root),
    ),
  ).toThrow("absent or ambiguous");
  expect(() => libraryCanonicalBirth(f.file, [...f.entries, root])).toThrow(
    "absent or ambiguous",
  );
});

test("a source cycle and changed literal source bytes cannot supply birth identity", () => {
  const f = fixture("episode");
  const root = f.entries.find(
    (entry) =>
      entry.sourceRecord.kind === "media" &&
      entry.sourceRecord.mediaKind === "series",
  );
  if (root?.sourceRecord.kind !== "media")
    throw new Error("Expected source root");
  root.sourceRecord.parentSourceId = root.sourceId;
  expect(() => libraryCanonicalBirth(f.file, f.entries)).toThrow(
    "absent or ambiguous",
  );
  root.observationHash = snapshotHash(z.json().parse(root.sourceRecord));
  expect(() => libraryCanonicalBirth(f.file, f.entries)).toThrow(
    "hierarchy changed",
  );
});
