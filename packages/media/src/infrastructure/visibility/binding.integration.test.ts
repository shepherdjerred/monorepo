import { expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import {
  plexBindingFixture,
  bindingTestExecution,
} from "#automation/plex-binding/test-fixture.ts";
import { captureExistingPlexBindingExpected } from "#infrastructure/plex-binding/cold.ts";
import {
  preparePlexBindingLockScope,
  lockPlexBindingScope,
} from "#infrastructure/plex-binding/authority.ts";
import { invalidatePlexBindings } from "#infrastructure/plex-binding/commit.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { visibilityPublicationContext } from "./plex.test-support.ts";
import { completeTvObservation } from "./tv.test-support.ts";
import { mixedVisibilityFixture } from "./mixed.test-support.ts";
import { visibilityFixture } from "./test-fixture.ts";

const h = automationTestHarness();

test("actual verified playback remains independent of another subject's pending choice; cleared proof never falls back to timestamps", async () => {
  const db = h.database();
  const f = await plexBindingFixture(db, h.context(), {
    publicationPending: true,
  });
  try {
    await completeTvObservation(
      db,
      await db.torrent.findUniqueOrThrow({
        where: { id: z.uuid().parse(f.published.attempt.torrentId) },
      }),
    );
    const app = new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
      movieSectionId: "1",
    });
    const unverified = await app.getMedia(f.files.user, f.files.media.id);
    expect(unverified.visibility.playback).toMatchObject({
      playable: false,
      currentAssetId: null,
      association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 1 },
    });
    const network = await visibilityPublicationContext(db, f.context, [
      f.files.media.id,
    ]);
    expect(
      await createPublicationActivities(network.context).publishMediaToPlex(
        f.published.input,
      ),
    ).toMatchObject({ status: "available" });
    const pending = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Pending choice subject",
      },
    });
    await grantTestRequesterAccess(db, pending.id, "fixture-server");
    const request = await app.createRequest(pending, crypto.randomUUID(), {
      mediaId: f.files.media.id,
      subtitleLanguages: [],
      includeSpecials: false,
    });
    const current = await app.getMedia(pending, f.files.media.id);
    expect(current.visibility.playback).toMatchObject({
      playable: true,
      currentAssetId: f.asset.id,
      currentVersion: f.asset.version,
      association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 0 },
    });
    expect(current.visibility.movieRequests).toEqual([
      {
        requestId: request.requestId,
        edition: "default",
        fulfillment: {
          status: "pending_choice",
          reason: "movie_edition_choice_required",
        },
      },
    ]);
    expect(JSON.stringify(current)).not.toContain(f.files.user.id);
    const original = await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    });
    expect(original.plexPublishedAt).not.toBeNull();
    const access = await f.context.plexAccess("movie");
    const execution = bindingTestExecution();
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: execution.expiresAtMs,
      guards: [execution],
    });
    const prepared = await db.$transaction(async (tx) => {
      const expected = await captureExistingPlexBindingExpected(tx, {
        assetIds: [f.asset.id],
        access: [access],
      });
      return {
        expected,
        locks: await preparePlexBindingLockScope(tx, expected),
      };
    });
    await db.$transaction(async (tx) => {
      await lockPlexBindingScope(tx, prepared.locks, freshness);
      await invalidatePlexBindings(
        tx,
        { expected: prepared.expected, reason: "identity_changed" },
        freshness,
      );
    });
    const cleared = await app.getMedia(pending, f.files.media.id);
    expect(cleared.visibility.playback).toMatchObject({
      playable: false,
      currentAssetId: null,
      association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 1 },
    });
    expect(cleared.visibility.movieRequests).toEqual(
      current.visibility.movieRequests,
    );
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(original);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("complete shared-file authority protects its visible member while an unrelated collection group remains ready", async () => {
  const db = h.database();
  const f = await mixedVisibilityFixture(db);
  try {
    const network = await visibilityPublicationContext(
      db,
      h.context(),
      f.mediaIds,
    );
    expect(
      await createPublicationActivities(network.context).publishMediaToPlex(
        f.acquired.input,
      ),
    ).toMatchObject({ status: "available" });
    const requested: string[] = [];
    const app = new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
      plexAccess: (kind) => {
        requested.push(kind);
        if (kind !== "show")
          throw new Error("TV read attempted to resolve movie configuration");
        return Promise.resolve({
          serverMachineId: "fixture-server",
          sectionId: "2",
          sectionType: kind,
        });
      },
    });
    const initial = await app.getMedia(f.file.user, f.series.id);
    expect(initial.visibility.playback).toMatchObject({
      playableItems: 3,
      visibleItems: 3,
      association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 0 },
    });
    const shared = f.coverage.find(
      (row) =>
        f.coverage.filter((other) => other.assetId === row.assetId).length ===
        2,
    );
    if (shared === undefined) throw new Error("Actual shared asset missing");
    const hidden = await db.mediaItem.findUniqueOrThrow({
      where: { id: shared.mediaId },
    });
    // Deliberate read-scope and ownership faults after real complete publication.
    await db.mediaItem.update({
      where: { id: hidden.id },
      data: {
        externalIds: {
          ...z.record(z.string(), z.json()).parse(hidden.externalIds),
          plexSectionId: "9",
        },
      },
    });
    await db.libraryAsset.update({
      where: { id: shared.assetId },
      data: { owned: false },
    });
    const detail = await app.getMedia(f.file.user, f.series.id);
    expect(detail.visibility.playback).toMatchObject({
      scope: "collection",
      playable: true,
      playableItems: 1,
      visibleItems: 2,
      currentAssetId: null,
      currentVersion: null,
      association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 1 },
    });
    expect(JSON.stringify(detail)).not.toContain(hidden.id);
    expect(JSON.stringify(detail)).not.toContain(hidden.title);
    expect(requested).toEqual(["show", "show"]);
    expect(
      await db.plexBindingCurrent.count({
        where: { mediaId: { in: f.mediaIds }, evidenceId: { not: null } },
      }),
    ).toBe(3);
  } finally {
    await rm(f.file.directory, { recursive: true, force: true });
  }
});

test("legacy labels require current ownership and canonical identity; missing assets remain ordinary pending reads", async () => {
  const f = await visibilityFixture(h.database());
  const pending = await f.app.getMedia(f.member, f.media.id);
  expect(pending.visibility.playback.association).toEqual({
    legacyUnverifiedItems: 0,
    reconciliationRequiredItems: 0,
  });
  const asset = await f.publish();
  const legacy = await f.app.getMedia(f.member, f.media.id);
  expect(legacy.visibility.playback).toMatchObject({
    playable: false,
    currentAssetId: null,
    association: { legacyUnverifiedItems: 1, reconciliationRequiredItems: 0 },
  });
  await f.db.libraryAsset.update({
    where: { id: asset.id },
    data: { state: "quarantined" },
  });
  const quarantined = await f.app.getMedia(f.member, f.media.id);
  expect(quarantined.visibility.playback).toMatchObject({
    playable: false,
    association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 1 },
  });
  expect(
    await f.db.plexBindingCurrent.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
  expect(
    await f.db.plexAssociationEvidence.count({
      where: { mediaId: f.media.id },
    }),
  ).toBe(0);
});
