import { rm } from "node:fs/promises";
import { afterAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { assessMovieCutV2, assertMovieCutV2 } from "./cut-v2.ts";

const h = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const db = h.database();
  const files = await mappedPublicationFixture(db);
  directories.push(files.directory);
  const published = await preparePhysicalPublication(files);
  const original = await db.releaseCandidate.findUniqueOrThrow({
    where: { id: published.attempt.releaseId },
  });
  const release = await db.releaseCandidate.create({
    data: {
      providerId: "knaben",
      providerReleaseId: crypto.randomUUID(),
      title: `${files.media.title}.2026.Extended.Cut.1080p.WEB-DL`,
      mediaIds: [files.media.id],
      attributes: PublicReleaseAttributesSchema.parse(original.attributes),
      evaluation: {},
      sourceEvidence: { infoHash: "a".repeat(40) },
    },
  });
  const scope = MovieEditionScopeSchema.parse({
    rootMediaId: files.media.id,
    mediaId: files.media.id,
    edition: "extended_cut",
  });
  return { db, files, published, release, scope };
}

test("an actual current unmarked publication is not a predecessor of a separate named edition", async () => {
  const f = await fixture();
  const before = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.published.entry.assetId },
  });
  const result = await assertMovieCutV2(f.db, {
    scope: f.scope,
    releaseId: f.release.id,
    predecessorAssetIds: [],
    phase: "candidate",
    members: [],
  });
  expect(result.decision).toMatchObject({
    accepted: true,
    reasons: [],
    current: [],
    members: [],
  });
  expect(result.candidate.conclusion).toEqual({
    kind: "named",
    cut: "extended_cut",
  });
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: before.id } }),
  ).toEqual(before);
  expect(
    await f.db.libraryAsset.count({
      where: { editionRootId: f.scope.rootMediaId, edition: "extended_cut" },
    }),
  ).toBe(0);
});

test("a real unmarked asset cannot be borrowed as a named predecessor", async () => {
  const f = await fixture();
  await expect(
    assertMovieCutV2(f.db, {
      scope: f.scope,
      releaseId: f.release.id,
      predecessorAssetIds: [f.published.entry.assetId],
      phase: "candidate",
      members: [],
    }),
  ).rejects.toMatchObject({ code: "movie_edition_asset_mismatch" });
  const current = await assessMovieCutV2(f.db, {
    scope: { ...f.scope, edition: "default" },
    releaseId: f.release.id,
    predecessorAssetIds: [],
    phase: "candidate",
    members: [],
  });
  expect(current.current.length).toBeGreaterThan(0);
  expect(current.decision.accepted).toBe(false);
  expect(current.decision.reasons).toContain("edition_candidate_incompatible");
});

test("physical label policy retains the exact member digest and refuses a conflicting cut", async () => {
  const f = await fixture();
  const member = {
    attemptId: crypto.randomUUID(),
    torrentFileIndex: 2,
    relativePath: `${f.release.title}.mkv`,
    sizeBytes: "123",
  };
  const result = await assertMovieCutV2(f.db, {
    scope: f.scope,
    releaseId: f.release.id,
    predecessorAssetIds: [],
    phase: "physical",
    members: [member],
  });
  expect(result.members).toHaveLength(1);
  expect(result.members[0]?.source).toEqual({
    kind: "member",
    attemptId: member.attemptId,
    torrentFileIndex: 2,
  });
  expect(result.members[0]?.texts[0]?.text).toBe(member.relativePath);
  await expect(
    assertMovieCutV2(f.db, {
      scope: f.scope,
      releaseId: f.release.id,
      predecessorAssetIds: [],
      phase: "physical",
      members: [
        {
          ...member,
          relativePath: member.relativePath.replace(
            "Extended.Cut",
            "Final.Cut",
          ),
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "edition_evidence_conflict" });
});
