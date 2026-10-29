import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { visibilityPublicationContext } from "./plex.test-support.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";

const h = automationTestHarness();

test("real verified publication remains playable during a newly submitted upgrade, while promotion and recovery uncertainty do not", async () => {
  const db = h.database();
  const f = await identityFixture(db, h.context(), false, {
    fileFactory: mappedPublicationFixture,
  });
  try {
    const first = await f.acquire();
    const torrent = await db.torrent.findUniqueOrThrow({
      where: { id: z.uuid().parse(first.attempt.torrentId) },
    });
    const observed = await f.network.qbittorrent.observe(torrent.infoHash);
    if (observed === null)
      throw new Error("Actual fixture submission was not observed");
    const stored = z
      .object({ files: z.array(z.json()) })
      .parse(torrent.observation);
    await db.torrent.update({
      where: { id: torrent.id },
      data: {
        observation: {
          torrent: {
            ...observed,
            progress: 1,
            save_path: storedFilePath(f.files.context, "tv", "downloads", ""),
          },
          files: stored.files,
        },
      },
    });
    const files = createMediaFileActivities(f.files.context);
    expect(await files.inspectAndStageMedia(first.input)).toEqual({
      status: "staged",
    });
    expect(await files.promoteMediaFiles(first.input)).toEqual({
      status: "published",
    });
    const old = await db.libraryAsset.findFirstOrThrow({
      where: {
        coverage: { some: { mediaId: f.files.media.id, current: true } },
      },
    });
    expect(old.plexPublishedAt).toBeNull();
    const unverified = await f.service.getMedia(f.actor, f.files.media.id);
    expect(unverified.visibility.playback.playable).toBe(false);
    const network = await visibilityPublicationContext(
      db,
      h.context(),
      first.attempt.mediaIds,
    );
    const publication = createPublicationActivities(network.context);
    expect(await publication.publishMediaToPlex(first.input)).toMatchObject({
      status: "available",
    });
    await publication.finalizeMediaAcquisition(first.input);
    const verified = await f.service.getMedia(f.actor, f.files.media.id);
    expect(verified.visibility.playback).toMatchObject({
      playable: true,
      currentAssetId: old.id,
      currentVersion: old.version,
      upgradeInProgress: false,
      association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 0 },
    });

    f.source.providerReleaseId = crypto.randomUUID();
    f.source.title = "Example.Show.2020.S01E01.2160p.WEB-DL.H264.ENG";
    f.source.infoHash = randomBytes(20).toString("hex");
    f.source.download.value = `magnet:?xt=urn:btih:${f.source.infoHash}`;
    const profile = await loadProfile(db, f.files.media.id);
    if (profile === null) throw new Error("Fixture profile missing");
    const found = await searchCandidates(f.network, f.files.media.id, profile);
    expect(found).toHaveLength(1);
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.files.media.id },
    });
    const selected = await f.service.act(
      f.actor,
      crypto.randomUUID(),
      media.id,
      {
        action: "select_release",
        releaseId: z.uuid().parse(found[0]),
        expectedVersion: media.version,
      },
    );
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(selected.operationId) },
    });
    const input = z
      .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
      .parse(operation.payload);
    const acquisition = createAcquisitionActivities(f.network);
    const reserved = await acquisition.reconcileMediaIntent(input);
    expect(reserved.status).toBe("acquire");
    expect(
      await acquisition.submitMediaTorrent({
        attemptId: z.uuid().parse(reserved.attemptId),
        operationId: operation.id,
      }),
    ).toMatchObject({ status: "submitted" });
    const downloading = await f.service.getMedia(f.actor, media.id);
    expect(downloading.availability).toBe("downloading");
    expect(downloading.visibility.playback).toMatchObject({
      playable: true,
      currentAssetId: old.id,
      currentVersion: old.version,
      upgradeInProgress: true,
    });
    expect(f.adds()).toBe(2);
    const retained = await db.libraryAsset.findUniqueOrThrow({
      where: { id: old.id },
      include: { coverage: { where: { current: true } } },
    });
    expect(retained).toMatchObject({
      state: "published",
      version: old.version,
      coverage: [{ mediaId: media.id }],
    });
    expect(retained.plexPublishedAt).not.toBeNull();

    await db.mediaItem.update({
      where: { id: media.id },
      data: { availability: "importing" },
    });
    const pendingVerification = await f.service.getMedia(f.actor, media.id);
    expect(pendingVerification.visibility.playback.playable).toBe(false);
    await db.mediaItem.update({
      where: { id: media.id },
      data: { availability: "downloading" },
    });
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: {
        recoveryEpoch: { increment: 1 },
        mode: "observe",
        ownershipConfirmed: false,
      },
    });
    const restored = await f.service.getMedia(f.actor, media.id);
    expect(restored.visibility.playback.playable).toBe(false);
    expect(
      restored.visibility.torrents.every(
        (row) => row.freshness === "old_epoch",
      ),
    ).toBe(true);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});
