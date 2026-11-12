import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { externalLibraryFixture } from "#testing/external-library-fixture.ts";
import { ExternalLibraryRegistrationSchema } from "#shared/external-library/contract.ts";
import { visiblePlayback } from "#infrastructure/visibility/playback.ts";
import {
  readExternalLibraryAvailability,
  EXTERNAL_INVENTORY_FRESHNESS_MS,
} from "./availability.ts";
import { externalLibraryProtected } from "./protection.ts";
import type { MediaIntent } from "#generated/prisma/client.ts";

const h = automationTestHarness();
const JsonObject = z.record(z.string(), z.json());
type ExternalFixture = Awaited<ReturnType<typeof externalLibraryFixture>>;

async function expectReadProjection(
  f: ExternalFixture,
  requestId: string,
  passiveTarget: MediaIntent,
  expected: MediaIntent["availability"],
) {
  const { db } = f;
  const storedBefore = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.media.id },
  });
  expect(storedBefore).toMatchObject({
    availability: f.media.availability,
    version: f.media.version,
  });
  const detail = await f.application.getMedia(f.owner, f.media.id);
  expect(detail.availability).toBe(expected);
  expect(detail.visibility.playback.playable).toBe(false);
  const requests = await f.application.listRequests(f.owner);
  expect(requests.find((row) => row.id === requestId)?.media.availability).toBe(
    expected,
  );
  if (f.media.kind === "episode") {
    const season = await f.application.getMedia(
      f.owner,
      z.uuid().parse(f.media.parentId),
    );
    expect(
      season.children.find((child) => child.id === f.media.id)?.availability,
    ).toBe(expected);
  }
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
  ).toEqual(storedBefore);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toEqual(passiveTarget);
}

async function expectDeniedProjection(f: ExternalFixture, requestId: string) {
  const { db } = f;
  const mapping = await db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: f.owner.id },
  });
  const deniedRequest = async () => {
    const requests = await f.application.listRequests(f.owner);
    expect(
      requests.find((row) => row.id === requestId)?.media.availability,
    ).toBe(f.media.availability);
  };
  await db.plexIdentityMapping.update({
    where: { userId: f.owner.id },
    data: { permittedSectionIds: [] },
  });
  await deniedRequest();
  await expect(
    f.application.getMedia(f.owner, f.media.id),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  const legacySection = f.access.sectionId === "1" ? "2" : "1";
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: {
      externalIds: {
        ...JsonObject.parse(f.media.externalIds),
        plexSectionId: legacySection,
      },
    },
  });
  await db.plexIdentityMapping.update({
    where: { userId: f.owner.id },
    data: { permittedSectionIds: [legacySection] },
  });
  await deniedRequest();
  const historical = await f.application.getMedia(f.owner, f.media.id);
  expect(historical.availability).toBe(f.media.availability);
  expect(historical.visibility.playback).toMatchObject({
    playable: false,
    externalAvailableItems: 0,
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { externalIds: JsonObject.parse(f.media.externalIds) },
  });
  await db.plexIdentityMapping.update({
    where: { userId: f.owner.id },
    data: { permittedSectionIds: mapping.permittedSectionIds },
  });
}

test.each(["movie", "episode"] as const)(
  "owner-registered %s availability is observational, and stale or changed proof stays protected without owned playback",
  async (kind) => {
    const db = h.database();
    const f = await externalLibraryFixture(db, kind);
    const { result } = await f.register();
    const assetId = z.uuid().parse(result.assetId);
    expect(
      await db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
    ).toEqual(f.media);
    const passiveTarget = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    const request = await db.mediaRequest.create({
      data: { mediaId: f.media.id, userId: f.owner.id },
    });
    const projectedAvailability = (expected: MediaIntent["availability"]) =>
      expectReadProjection(f, request.id, passiveTarget, expected);
    await projectedAvailability("available");
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: assetId },
    });
    const properties = JsonObject.parse(asset.properties);
    const registration = ExternalLibraryRegistrationSchema.parse(
      properties["externalLibrary"],
    );
    expect(asset).toMatchObject({
      owned: false,
      ownershipEpoch: -1,
      checksum: null,
      torrentId: null,
    });
    if (kind === "movie")
      expect(registration).toMatchObject({
        canonicalEdition: null,
        editionConfidence: "unknown",
      });
    const available = () =>
      readExternalLibraryAvailability(db, assetId, f.access);
    expect(await available()).toEqual([f.media.id]);
    expect(await visiblePlayback(db, [f.media], f.access)).toEqual({
      playable: [],
      externalAvailableItems: 1,
      association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 0 },
    });
    expect(
      await readExternalLibraryAvailability(db, assetId, {
        ...f.access,
        serverMachineId: "changed-server",
      }),
    ).toBeNull();
    expect(
      await readExternalLibraryAvailability(db, assetId, {
        ...f.access,
        sectionId: "99",
      }),
    ).toBeNull();
    const protectedUnavailable = async () => {
      expect(await available()).toBeNull();
      expect(await externalLibraryProtected(db, [f.media.id])).toBe(true);
      const visibility = await visiblePlayback(db, [f.media], f.access);
      expect(visibility.playable).toEqual([]);
    };

    // A catalog/file row without an explicit matching owner event is not registration.
    await db.libraryAsset.update({
      where: { id: assetId },
      data: { properties: {} },
    });
    await protectedUnavailable();
    await db.libraryAsset.update({
      where: { id: assetId },
      data: { properties },
    });
    const event = await db.applicationEvent.findUniqueOrThrow({
      where: { id: registration.registrationEventId },
    });
    const originalPayload = JsonObject.parse(event.payload);
    await db.applicationEvent.update({
      where: { id: event.id },
      data: {
        payload: { ...originalPayload, registrationHash: "f".repeat(64) },
      },
    });
    await protectedUnavailable();
    await db.applicationEvent.update({
      where: { id: event.id },
      data: { payload: originalPayload },
    });

    await db.mediaItem.update({
      where: { id: f.root.id },
      data: { year: (f.root.year ?? 0) + 1 },
    });
    await protectedUnavailable();
    await db.mediaItem.update({
      where: { id: f.root.id },
      data: { year: f.root.year },
    });
    const observation = await db.plexInventoryObservation.findUniqueOrThrow({
      where: {
        sectionId_ratingKey_path: {
          sectionId: f.access.sectionId,
          ratingKey: f.input.ratingKey,
          path: asset.path,
        },
      },
    });
    const where = {
      sectionId_ratingKey_path: {
        sectionId: observation.sectionId,
        ratingKey: observation.ratingKey,
        path: observation.path,
      },
    };
    await db.plexInventoryObservation.update({
      where,
      data: {
        observedAt: new Date(Date.now() - EXTERNAL_INVENTORY_FRESHNESS_MS - 1),
      },
    });
    await protectedUnavailable();
    await projectedAvailability(f.media.availability);
    await db.plexInventoryObservation.update({
      where,
      data: { observedAt: observation.observedAt },
    });
    await projectedAvailability("available");
    await db.plexInventoryObservation.update({
      where,
      data: { guids: [{ id: "tmdb://999999" }] },
    });
    await protectedUnavailable();
    await db.plexInventoryObservation.update({
      where,
      data: { guids: z.array(z.json()).parse(observation.guids) },
    });
    await db.plexInventoryObservation.update({
      where,
      data: { episodeNumber: (observation.episodeNumber ?? 0) + 1 },
    });
    await protectedUnavailable();
    await db.plexInventoryObservation.update({
      where,
      data: { episodeNumber: observation.episodeNumber },
    });

    const extra = { ...observation, ratingKey: "999999" };
    await db.plexInventoryObservation.create({
      data: { ...extra, guids: z.array(z.json()).parse(extra.guids) },
    });
    await protectedUnavailable();
    await db.plexInventoryObservation.delete({
      where: {
        sectionId_ratingKey_path: {
          sectionId: extra.sectionId,
          ratingKey: extra.ratingKey,
          path: extra.path,
        },
      },
    });
    expect(await available()).toEqual([f.media.id]);

    // A later complete collection that no longer contains this path invalidates the old row.
    const newer = await db.reconciliationScan.create({
      data: {
        id: crypto.randomUUID(),
        kind: "inventory",
        progress: { section: 2, offset: 0 },
        startedAt: new Date(Date.now() + 1),
      },
    });
    await protectedUnavailable();
    await db.reconciliationScan.delete({ where: { id: newer.id } });
    await projectedAvailability("available");
    await expectDeniedProjection(f, request.id);
    await projectedAvailability("available");
    expect(await available()).toEqual([f.media.id]);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: assetId } }),
    ).toEqual(asset);
    expect(
      await db.acquisitionAttempt.count({
        where: { mediaIds: { has: f.media.id } },
      }),
    ).toBe(0);
  },
);
