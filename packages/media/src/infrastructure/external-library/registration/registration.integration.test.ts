import { expect, test, vi } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { externalLibraryFixture } from "#testing/external-library-fixture.ts";
import { ExternalLibraryRegistrationSchema } from "#shared/external-library/contract.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";

const h = automationTestHarness();
const object = z.record(z.string(), z.json());

async function reviewedMovie() {
  const f = await externalLibraryFixture(h.database());
  const preview = await f.service.preview(
    f.owner,
    crypto.randomUUID(),
    f.input,
  );
  return {
    ...f,
    preview,
    applyInput: {
      previewOperationId: preview.operationId,
      previewHash: preview.previewHash,
    },
  };
}

test("a reviewed registration expires at its original deadline and remains bound to its reviewing owner", async () => {
  const f = await reviewedMovie();
  const { db, preview, applyInput: input } = f;
  const other = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Other owner",
      role: "owner",
    },
  });
  await expect(
    f.service.apply(other, crypto.randomUUID(), input),
  ).rejects.toMatchObject({ code: "external_library_preview_required" });
  await expect(
    f.service.preview(
      { ...f.owner, role: "member" },
      crypto.randomUUID(),
      f.input,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.parse(preview.expiresAt));
  try {
    await expect(
      f.service.apply(f.owner, crypto.randomUUID(), input),
    ).rejects.toMatchObject({ code: "external_library_preview_expired" });
  } finally {
    clock.mockRestore();
  }
  expect(
    await db.libraryAsset.count({
      where: { path: preview.plan.observation.canonicalPath },
    }),
  ).toBe(0);
});

test("explicit owner review registers an unmarked movie once without granting automation or changing existing authority", async () => {
  const db = h.database();
  const f = await externalLibraryFixture(db);
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const before = {
    requests: await db.mediaRequest.count(),
    outbox: await db.outboxCommand.count(),
    leases: await db.legacyWriterLease.count(),
    storage: await db.mediaStorageAuthority.count(),
  };
  const previewKey = crypto.randomUUID();
  const preview = await f.service.preview(f.owner, previewKey, f.input);
  expect(preview.plan.disposition).toBe("eligible");
  expect(
    await db.libraryAsset.count({
      where: { path: preview.plan.observation.canonicalPath },
    }),
  ).toBe(0);
  expect(await f.service.preview(f.owner, previewKey, f.input)).toEqual(
    preview,
  );
  const input = {
    previewOperationId: preview.operationId,
    previewHash: preview.previewHash,
  };
  const key = crypto.randomUUID();
  const result = await f.service.apply(f.owner, key, input);
  expect(result.disposition).toBe("registered");
  expect(await f.service.apply(f.owner, key, input)).toEqual(result);
  await expect(
    f.service.apply(f.owner, key, { ...input, previewHash: "0".repeat(64) }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: z.uuid().parse(result.assetId) },
  });
  expect(asset).toMatchObject({
    owned: false,
    ownershipEpoch: -1,
    torrentId: null,
    checksum: null,
    state: "published",
    plexPublishedAt: null,
  });
  expect(
    ExternalLibraryRegistrationSchema.parse(
      object.parse(asset.properties)["externalLibrary"],
    ),
  ).toMatchObject({
    canonicalEdition: null,
    editionConfidence: "unknown",
    observedEditionTitle: null,
  });
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({
    generation: 0,
    automationEpoch: -1,
    desiredPresence: false,
    monitoring: false,
    libraryMonitoring: false,
    profileId: null,
  });
  expect(
    await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toEqual(runtime);
  expect({
    requests: await db.mediaRequest.count(),
    outbox: await db.outboxCommand.count(),
    leases: await db.legacyWriterLease.count(),
    storage: await db.mediaStorageAuthority.count(),
  }).toEqual(before);
  const again = await f.register();
  const detail = await f.application.getMedia(f.owner, f.media.id);
  expect(detail).toMatchObject({
    availability: "available",
    intent: {
      generation: 0,
      desiredPresence: false,
      monitoring: false,
      profileId: null,
    },
    visibility: {
      playback: {
        playable: false,
        externalAvailableItems: 1,
        currentAssetId: null,
      },
    },
  });
  expect(
    await db.plexBindingCurrent.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({
    availability: "wanted",
    automationEpoch: -1,
    generation: 0,
  });
  expect(again.result).toMatchObject({
    disposition: "already_registered",
    assetId: asset.id,
  });
  expect(await db.libraryAsset.count({ where: { path: asset.path } })).toBe(1);
});

test("canonical, owner, inventory and actual Plex identity changes fail before registration effects", async () => {
  const f = await reviewedMovie();
  const { db, preview, applyInput: input } = f;
  const selected = f.plexItems.get(f.input.ratingKey);
  if (selected === undefined) throw new Error("Fixture lost Plex item");
  f.plexItems.set(f.input.ratingKey, {
    ...selected,
    Guid: [{ id: "tmdb://987654321" }],
  });
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), input),
  ).rejects.toMatchObject({ code: "external_library_preview_changed" });
  f.plexItems.set(f.input.ratingKey, selected);
  f.plexItems.set(f.input.ratingKey, { ...selected, year: 2023 });
  await expect(
    f.service.preview(f.owner, crypto.randomUUID(), f.input),
  ).rejects.toMatchObject({ code: "external_library_identity_changed" });
  f.plexItems.set(f.input.ratingKey, selected);
  await db.mediaItem.update({
    where: { id: f.root.id },
    data: { version: { increment: 1 } },
  });
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), input),
  ).rejects.toMatchObject({ code: "external_library_preview_changed" });
  const fresh = await f.service.preview(f.owner, crypto.randomUUID(), f.input);
  await db.mediaUser.update({
    where: { id: f.owner.id },
    data: { restricted: true, version: { increment: 1 } },
  });
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), {
      previewOperationId: fresh.operationId,
      previewHash: fresh.previewHash,
    }),
  ).rejects.toMatchObject({ code: "external_library_owner_changed" });
  expect(
    await db.libraryAsset.count({
      where: { path: preview.plan.observation.canonicalPath },
    }),
  ).toBe(0);
});

test("changed physical Part and incomplete latest source inventory refuse a reviewed apply", async () => {
  const f = await reviewedMovie();
  const { db, applyInput: input } = f;
  const selected = f.plexItems.get(f.input.ratingKey);
  const part = selected?.Media?.[0]?.Part[0];
  if (selected === undefined || part === undefined)
    throw new Error("Fixture lost exact Part");
  f.plexItems.set(f.input.ratingKey, {
    ...selected,
    Media: [{ Part: [{ ...part, id: part.id + 1 }] }],
  });
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), input),
  ).rejects.toMatchObject({ code: "external_library_preview_changed" });
  f.plexItems.set(f.input.ratingKey, selected);
  await db.reconciliationScan.create({
    data: {
      id: crypto.randomUUID(),
      kind: "inventory",
      progress: { section: 2 },
      startedAt: new Date(Date.now() + 1),
    },
  });
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), input),
  ).rejects.toMatchObject({ code: "external_library_identity_changed" });
  expect(await db.libraryAsset.count({ where: { path: part.file } })).toBe(0);
});

test("existing owned path and scope are reported protected and remain byte-for-byte unchanged", async () => {
  const db = h.database();
  const f = await externalLibraryFixture(db);
  const observed = await f.service.preview(
    f.owner,
    crypto.randomUUID(),
    f.input,
  );
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(f.media.id)], { createMissing: true }),
  );
  const owned = await db.libraryAsset.create({
    data: {
      path: observed.plan.observation.canonicalPath,
      sizeBytes: 12_345n,
      checksum: "a".repeat(64),
      owned: true,
      ownershipEpoch: 0,
      state: "published",
      properties: {},
      editionRootId: f.root.id,
      coverage: {
        create: { mediaId: f.media.id, edition: "default", current: true },
      },
    },
  });
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), {
      previewOperationId: observed.operationId,
      previewHash: observed.previewHash,
    }),
  ).rejects.toMatchObject({ code: "external_library_preview_changed" });
  const current = await f.register();
  expect(current.result).toMatchObject({
    disposition: "protected",
    reason: "owned_asset_preserved",
  });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: owned.id } }),
  ).toEqual(owned);
  expect(
    await db.assetCoverage.count({
      where: { mediaId: f.media.id, current: true },
    }),
  ).toBe(1);
});

test("shared physical TV episodes retain individual Part identities and exact canonical coordinates", async () => {
  const db = h.database();
  const f = await externalLibraryFixture(db, "episode");
  const selected = f.plexItems.get(f.input.ratingKey);
  const part = selected?.Media?.[0]?.Part[0];
  if (selected === undefined || part === undefined)
    throw new Error("Fixture lost episode Part");
  const episode2 = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Episode 2",
      parentId: f.media.parentId,
      seasonNumber: 1,
      episodeNumber: 2,
      tmdbId: z.number().parse(f.media.tmdbId) + 1,
    },
  });
  f.plexItems.set("101", {
    ...selected,
    ratingKey: "101",
    index: 2,
    Guid: [{ id: `tmdb://${String(episode2.tmdbId)}` }],
    Media: [{ Part: [{ ...part, id: 1001 }] }],
  });
  await db.plexInventoryObservation.create({
    data: {
      sectionId: "2",
      ratingKey: "101",
      path: part.file,
      kind: "episode",
      guids: [{ id: `tmdb://${String(episode2.tmdbId)}` }],
      seasonNumber: 1,
      episodeNumber: 2,
      scanId: f.sourceScan.id,
    },
  });
  const { result } = await f.register();
  expect(result.disposition).toBe("registered");
  expect(result.mediaIds).toEqual([f.media.id, episode2.id]);
  const episodeDetail = await f.application.getMedia(f.owner, episode2.id);
  expect(episodeDetail).toMatchObject({
    availability: "available",
    visibility: {
      playback: {
        playable: false,
        externalAvailableItems: 1,
        currentAssetId: null,
      },
    },
  });
  const seriesDetail = await f.application.getMedia(f.owner, f.root.id);
  expect(seriesDetail).toMatchObject({
    availability: f.root.availability,
    visibility: {
      playback: {
        scope: "collection",
        playable: false,
        playableItems: 0,
        externalAvailableItems: 2,
        visibleItems: 2,
      },
    },
  });
  expect(seriesDetail.children).toHaveLength(1);
  const seasonDetail = await f.application.getMedia(
    f.owner,
    z.uuid().parse(f.media.parentId),
  );
  expect(seasonDetail.children.map((child) => child.availability)).toEqual([
    "available",
    "available",
  ]);
  // An ordinary request-card read uses the same generic leaf presence.
  const request = await db.mediaRequest.create({
    data: { mediaId: episode2.id, userId: f.owner.id },
  });
  expect(await f.application.listRequests(f.owner)).toContainEqual(
    expect.objectContaining({
      id: request.id,
      media: expect.objectContaining({
        id: episode2.id,
        availability: "available",
      }),
    }),
  );
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: z.uuid().parse(result.assetId) },
  });
  expect(
    ExternalLibraryRegistrationSchema.parse(
      object.parse(asset.properties)["externalLibrary"],
    ).members.map((member) => [member.partId, member.episodeNumber]),
  ).toEqual([
    ["1000", 1],
    ["1001", 2],
  ]);
});
