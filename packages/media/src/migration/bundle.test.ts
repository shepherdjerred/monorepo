import { expect, test } from "vitest";
import { buildMigrationBundle, validateBundleSelection } from "./bundle.ts";
import { captureFixture, mediaFixture } from "./bundle-test-fixtures.ts";

function captures() {
  return (["radarr", "sonarr", "seerr", "bazarr", "qbittorrent"] as const).map(
    (kind) => ({
      id: crypto.randomUUID(),
      snapshot: captureFixture(
        kind,
        kind === "radarr" ? [mediaFixture("1", "movie", { tmdb: 33 })] : [],
      ),
    }),
  );
}
function context() {
  return {
    requesters: [],
    targets: [
      {
        mediaId: crypto.randomUUID(),
        kind: "movie" as const,
        externalIds: { tmdb: 33 },
        season: null,
        episode: null,
        checksum: null,
      },
    ],
  };
}
test("combined review requires every source role, stable evidence and exact immutable selection", () => {
  const sources = captures();
  const ctx = context();
  const combined = buildMigrationBundle(sources, ctx);
  expect(combined.report).toMatchObject({
    complete: true,
    stable: true,
    mayTransferOwnership: false,
  });
  expect(buildMigrationBundle([...sources].reverse(), ctx)).toEqual(combined);
  const entry = combined.report.entries[0];
  if (entry === undefined) throw new Error("Missing fixture record");
  const selection = [
    { provenanceKey: entry.provenanceKey, evidenceHash: entry.observationHash },
  ];
  expect(validateBundleSelection(combined.report, selection)).toEqual(
    selection,
  );
  expect(() =>
    validateBundleSelection(combined.report, [
      { ...selection[0], evidenceHash: "f".repeat(64) },
    ]),
  ).toThrow("changed");
  const partial = buildMigrationBundle(sources.slice(0, 4), ctx);
  expect(partial.report.complete).toBe(false);
  expect(() => validateBundleSelection(partial.report, selection)).toThrow(
    "protected",
  );
  const first = sources[0];
  if (first === undefined) throw new Error("Missing fixture capture");
  expect(() =>
    buildMigrationBundle(
      [...sources, { ...first, id: crypto.randomUUID() }],
      ctx,
    ),
  ).toThrow("same source instance");
});
test("proposed root mappings bind exact capture and mount identity without granting filesystem authority", () => {
  const sources = captures();
  const first = sources[0];
  if (first === undefined) throw new Error("Missing fixture capture");
  const mapping = {
    captureId: first.id,
    sourceMountIdentity: "d".repeat(64),
    sourceRoot: "/movies",
    canonicalRoot: "/data/movies",
    verified: false as const,
  };
  const bundle = buildMigrationBundle(sources, {
    ...context(),
    rootMappings: [mapping],
  });
  expect(bundle.manifest.rootMappings).toEqual([mapping]);
  expect(bundle.report.mayTransferOwnership).toBe(false);
  expect(() =>
    buildMigrationBundle(sources, {
      ...context(),
      rootMappings: [{ ...mapping, captureId: crypto.randomUUID() }],
    }),
  ).toThrow("outside this bundle");
});
