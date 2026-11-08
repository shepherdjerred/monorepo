import { expect, test } from "vitest";
import { z } from "zod";
import { buildMigrationBundle } from "#migration/bundle.ts";
import {
  captureFixture,
  mediaFixture,
} from "#migration/bundle-test-fixtures.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { BundleReviewProtocolSchema } from "#shared/handoff/library-bundle.ts";
import {
  libraryBatchEntries,
  libraryProfileBindings,
  libraryProfileGroups,
} from "#client/library-import/selection.ts";
import { importResolvedProfiles } from "#migration/profile-import.ts";
import snapshot from "#migration/fixtures/resolved-profiles.json";

function fixture(profileSourceId: string | null = null) {
  const series = mediaFixture("series:1", "series", { tmdb: 42 });
  series.profileSourceId = profileSourceId;
  const episodes = [1, 2].map((episode) => ({
    ...series,
    sourceId: `episode:${String(episode)}`,
    mediaKind: "episode" as const,
    externalIds: {},
    parentSourceId: series.sourceId,
    season: 1,
    episode,
  }));
  const files = episodes.map((episode) => ({
    kind: "file" as const,
    sourceId: `file:${episode.sourceId}`,
    mediaSourceIds: [episode.sourceId],
    path: `/tv/${episode.sourceId}.mkv`,
    sizeBytes: 100,
    checksum: null,
    downloadHash: null,
    qualitySourceId: null,
  }));
  const tv = captureFixture("sonarr", [series, ...episodes, ...files]);
  const reference = (sourceMediaId: string) => ({
    kind: "sonarr" as const,
    sourceInstanceId: tv.sourceInstanceId,
    sourceMediaId,
    binding: "owner_declared" as const,
  });
  const captions: MigrationRecord[] = files.map((file, index) => ({
    kind: "subtitle",
    sourceId: `caption:${String(index + 1)}`,
    mediaSourceId: episodes[index]?.sourceId ?? "missing",
    managerReference: reference(episodes[index]?.sourceId ?? "missing"),
    videoPath: file.path,
    path: `${file.path}.en.srt`,
    language: "en",
    checksum: null,
    provenance: "provider",
  }));
  const first = captions[0];
  if (first?.kind !== "subtitle") throw new Error("Missing caption fixture");
  captions.push({
    ...first,
    sourceId: "foreign",
    managerReference: {
      ...reference("episode:1"),
      sourceInstanceId: "f".repeat(64),
    },
  });
  captions.push({
    kind: "subtitle_preference",
    sourceId: "policy:1",
    mediaSourceId: series.sourceId,
    languages: ["en"],
    hearingImpaired: false,
    forced: false,
    managerReference: reference(series.sourceId),
  });
  const targets = [series, ...episodes].map((item) => ({
    mediaId: crypto.randomUUID(),
    kind: item.mediaKind,
    externalIds: item.externalIds,
    seriesExternalIds: { tmdb: 42 },
    season: item.season,
    episode: item.episode,
    checksum: null,
  }));
  const bundle = buildMigrationBundle(
    [
      { id: crypto.randomUUID(), snapshot: captureFixture("radarr") },
      { id: crypto.randomUUID(), snapshot: tv },
      { id: crypto.randomUUID(), snapshot: captureFixture("bazarr", captions) },
    ],
    { targets, requesters: [] },
    "initial_library",
  );
  return BundleReviewProtocolSchema.parse({
    id: crypto.randomUUID(),
    bundleId: crypto.randomUUID(),
    status: "approved",
    version: 1,
    recoveryEpoch: 0,
    runtimeVersion: 0,
    createdAt: "2026-10-27T08:00:00Z",
    selection: [],
    ...bundle,
  });
}

test("a TV file batch carries only its exact captions and parent policy", () => {
  const review = fixture();
  const file = review.report.entries.find(
    (entry) => entry.sourceId === "file:episode:1",
  );
  if (file === undefined) throw new Error("Missing file fixture");
  const batch = libraryBatchEntries(review, [file.provenanceKey]);
  expect(batch.entries.map((entry) => entry.sourceId).toSorted()).toEqual([
    "caption:1",
    "file:episode:1",
    "policy:1",
  ]);
  expect(batch.media.map((entry) => entry.sourceId).toSorted()).toEqual([
    "episode:1",
    "series:1",
  ]);
  expect(() =>
    libraryBatchEntries(review, [file.provenanceKey, file.provenanceKey]),
  ).toThrow("changed");
  expect(() => libraryBatchEntries(review, ["0".repeat(64)])).toThrow(
    "changed",
  );
});

test("a captured source cycle cannot select a batch", () => {
  const review = fixture();
  const file = review.report.entries.find((entry) => entry.kind === "file");
  const series = review.report.entries.find(
    (entry) => entry.sourceId === "series:1",
  );
  if (file === undefined || series?.sourceRecord.kind !== "media")
    throw new Error("Missing fixture hierarchy");
  series.sourceRecord.parentSourceId = series.sourceId;
  expect(() => libraryBatchEntries(review, [file.provenanceKey])).toThrow(
    "hierarchy is invalid",
  );
});

test("quality bindings retain the imported snapshot and version and require a choice for multiple matches", () => {
  const resolved = importResolvedProfiles(snapshot).find(
    (item) => item.source === "sonarr",
  )?.profiles[0];
  if (resolved === undefined)
    throw new Error("Missing imported profile fixture");
  const review = fixture(String(resolved.profile.id));
  const file = review.report.entries.find((entry) => entry.kind === "file");
  if (file === undefined) throw new Error("Missing file fixture");
  const media = libraryBatchEntries(review, [file.provenanceKey]).media;
  const rules = {
    qualities: ["WEB-1080p"],
    rejectedCodecs: [],
    requiredAudioLanguages: [],
    minimumBytes: 1,
    maximumBytes: 10_000_000,
    minimumScore: 0,
    tagScores: {},
    cutoffQuality: "WEB-1080p",
    cutoffScore: 0,
  };
  const imported = {
    id: crypto.randomUUID(),
    name: "Imported TV",
    version: 3,
    rules: z.json().parse({ ...rules, resolved }),
  };
  const generic = {
    id: crypto.randomUUID(),
    name: "Generic",
    version: 0,
    rules,
  };
  const groups = libraryProfileGroups(review, media, [generic, imported]);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.options).toHaveLength(1);
  expect(libraryProfileBindings(groups, {})).toMatchObject([
    { profileId: imported.id, version: 3, snapshotHash: resolved.snapshotHash },
  ]);
  expect(() =>
    libraryProfileBindings(groups, {
      [groups[0]?.key ?? "missing"]: generic.id,
    }),
  ).toThrow("Import and select");
  const ambiguous = libraryProfileGroups(review, media, [
    imported,
    { ...imported, id: crypto.randomUUID() },
  ]);
  expect(() => libraryProfileBindings(ambiguous, {})).toThrow(
    "Import and select",
  );
});
