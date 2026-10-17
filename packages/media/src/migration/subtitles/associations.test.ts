import { expect, test } from "vitest";
import {
  captureFixture,
  mediaFixture,
} from "#migration/bundle-test-fixtures.ts";
import { buildMigrationBundle } from "#migration/bundle.ts";
import { normalizeCapture } from "#migration/normalize.ts";
import type { MigrationRecord } from "#shared/migration.ts";

function fixture(
  change: {
    wrongInstance?: boolean;
    videoPath?: string;
    missingBinding?: boolean;
  } = {},
) {
  const manager = captureFixture("radarr", [
    mediaFixture("7", "movie", { tmdb: 33 }),
    {
      kind: "file",
      sourceId: "f1",
      mediaSourceIds: ["7"],
      path: "/movies/Example.mkv",
      sizeBytes: 100,
      checksum: "a".repeat(64),
      downloadHash: null,
      qualitySourceId: "3",
    },
  ]);
  const subtitle: MigrationRecord = {
    kind: "subtitle",
    sourceId: "radarr:s1",
    mediaSourceId: "radarr:7",
    language: "en",
    path: "/movies/Example.en.srt",
    videoPath: change.videoPath ?? "/movies/Example.mkv",
    checksum: "b".repeat(64),
    provenance: "unknown",
    managerReference: {
      kind: "radarr",
      sourceMediaId: "7",
      sourceInstanceId:
        change.missingBinding === true
          ? null
          : change.wrongInstance === true
            ? "c".repeat(64)
            : manager.sourceInstanceId,
      binding: "owner_declared",
    },
  };
  const bazarr = captureFixture("bazarr", [subtitle]);
  const targets = [
    {
      mediaId: crypto.randomUUID(),
      kind: "movie" as const,
      externalIds: { tmdb: 33 },
      season: null,
      episode: null,
      checksum: "a".repeat(64),
    },
  ];
  const captures = [
    manager,
    bazarr,
    captureFixture("sonarr"),
    captureFixture("seerr"),
    captureFixture("qbittorrent"),
  ].map((snapshot) => ({ id: crypto.randomUUID(), snapshot }));
  return {
    bazarr,
    targets,
    bundle: buildMigrationBundle(captures, { targets, requesters: [] }),
  };
}
test("bundle joins subtitle only through declared exact manager instance, source ID and video path", () => {
  const valid = fixture().bundle.report.entries.find(
    (entry) => entry.kind === "subtitle",
  );
  expect(valid).toMatchObject({
    confidence: "exact",
    state: "protected_exact",
    owned: false,
  });
  expect(valid?.reasons).not.toContain("checksum_not_verified");
  for (const change of [
    { wrongInstance: true },
    { videoPath: "/movies/Other.mkv" },
    { missingBinding: true },
  ])
    expect(
      fixture(change).bundle.report.entries.find(
        (entry) => entry.kind === "subtitle",
      )?.confidence,
    ).toBe("unknown");
});
test("a subtitle checksum is never compared with its video's checksum", () => {
  const f = fixture();
  const report = normalizeCapture(f.bazarr, { targets: f.targets });
  expect(report.entries[0]?.reasons).toContain(
    "subtitle_content_proof_required",
  );
  expect(report.entries[0]?.reasons).not.toContain("checksum_not_verified");
});
