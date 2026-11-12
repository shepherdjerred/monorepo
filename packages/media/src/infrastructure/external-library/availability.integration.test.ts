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

const h = automationTestHarness();
const JsonObject = z.record(z.string(), z.json());

test.each(["movie", "episode"] as const)(
  "owner-registered %s availability is observational, and stale or changed proof stays protected without owned playback",
  async (kind) => {
    const db = h.database();
    const f = await externalLibraryFixture(db, kind);
    const { result } = await f.register();
    const assetId = z.uuid().parse(result.assetId);
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
    await db.plexInventoryObservation.update({
      where,
      data: { observedAt: observation.observedAt },
    });
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
