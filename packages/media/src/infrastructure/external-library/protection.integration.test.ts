import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { reserveCandidate } from "#automation/acquisition-reservation.ts";
import { loadProfile } from "#automation/acquisition-candidates.ts";
import { externalLibraryProtected } from "./protection.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { reconcileMovieIntentV4 } from "#automation/movie-editions/reconcile.ts";
import type { Database } from "#infrastructure/database.ts";
import type { LibraryAsset } from "#generated/prisma/client.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";

const h = automationTestHarness();

function unverifiedExternalAsset(db: Database, mediaId: string) {
  return db.libraryAsset.create({
    data: {
      path: `/external/${crypto.randomUUID()}.mkv`,
      sizeBytes: 1000n,
      state: "published",
      owned: false,
      ownershipEpoch: -1,
      checksum: null,
      torrentId: null,
      properties: {},
      coverage: { create: { mediaId, current: true } },
    },
  });
}

async function expectExternalUnchanged(
  db: Database,
  mediaId: string,
  asset: LibraryAsset,
) {
  expect(
    await db.acquisitionAttempt.count({
      where: { mediaIds: { has: mediaId } },
    }),
  ).toBe(0);
  expect(await db.acquisitionReservation.count({ where: { mediaId } })).toBe(0);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ).toEqual(asset);
}

test.each(["movie", "episode"] as const)(
  "even an unverified external %s is protected from provider search and locked reservation, without receiving ownership",
  async (kind) => {
    const db = h.database();
    const f = await h.fixture("123", { kind });
    const asset = await unverifiedExternalAsset(db, f.media.id);
    const before = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    // This context throws on every tracker/qBit call: reaching either is a failure.
    const context = h.context();
    expect(
      await createAcquisitionActivities(context).reconcileMediaIntent(f.input),
    ).toMatchObject({
      status: "blocked",
      attemptId: null,
      reason: "external_library_protected",
    });
    const profile = await loadProfile(db, f.media.id);
    if (profile === null) throw new Error("Fixture lost its real profile");
    await expect(
      reserveCandidate(context, f.input, {
        releaseId: f.release.id,
        profile,
        epoch: 0,
      }),
    ).rejects.toMatchObject({ code: "external_library_protected" });
    expect(await externalLibraryProtected(db, [f.media.id])).toBe(true);
    await expectExternalUnchanged(db, f.media.id, asset);
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      }),
    ).toEqual(before);
  },
);

test("real V4 movie consent cannot turn an external library file into a new acquisition", async () => {
  const db = h.database();
  const f = await h.fixture("321", {
    kind: "movie",
    chooseMovieEdition: false,
  });
  await grantTestRequesterAccess(db, f.user.id, "fixture-server");
  const asset = await unverifiedExternalAsset(db, f.media.id);
  const command = await requestTestMovieV4(db, f.user, f.media.id, "default");
  const result = await reconcileMovieIntentV4(h.context(), command.input);
  expect(result).toMatchObject({
    status: "blocked",
    reason: "external_library_protected",
    attemptId: null,
  });
  await expectExternalUnchanged(db, f.media.id, asset);
});

test("a TV candidate cannot reserve an externally managed sibling that was not the requested primary episode", async () => {
  const db = h.database();
  const f = await h.fixture("456", { kind: "episode" });
  const sibling = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Already in Plex",
      parentId: f.media.parentId,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(sibling.id)], { createMissing: true }),
  );
  const targetWhere = {
    mediaId_edition: { mediaId: sibling.id, edition: "default" },
  };
  const passiveTarget = await db.mediaIntent.findUniqueOrThrow({
    where: targetWhere,
  });
  await unverifiedExternalAsset(db, sibling.id);
  await db.releaseCandidate.update({
    where: { id: f.release.id },
    data: { mediaIds: [f.media.id, sibling.id] },
  });
  const profile = await loadProfile(db, f.media.id);
  if (profile === null) throw new Error("Fixture lost its real profile");
  await expect(
    reserveCandidate(h.context(), f.input, {
      releaseId: f.release.id,
      profile,
      epoch: 0,
    }),
  ).rejects.toMatchObject({ code: "external_library_protected" });
  expect(
    await db.acquisitionReservation.count({
      where: { mediaId: { in: [f.media.id, sibling.id] } },
    }),
  ).toBe(0);
  expect(
    await db.mediaIntent.findUniqueOrThrow({ where: targetWhere }),
  ).toEqual(passiveTarget);
});
