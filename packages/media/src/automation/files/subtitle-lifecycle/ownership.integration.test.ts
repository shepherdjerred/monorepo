import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { writeFile, readFile, access, rm } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { storedWorkerPath } from "#automation/files/paths/locations.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { ownedSubtitleSidecars } from "./ownership.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
for (const qualityStatus of ["accepted", "unverified"] as const) {
  for (const interrupted of [false, true]) {
    test(`${interrupted ? "interrupted" : "committed"} quarantine and restore preserve ${qualityStatus} quality while re-proving same-video lifecycle binding`, async () => {
      const db = harness.database();
      const f = await mappedPublicationFixture(db);
      directories.push(f.directory);
      const video = await preparePhysicalPublication(f);
      const target = path.join(
        f.roots.library,
        `${video.entry.libraryPath}.en.srt`,
      );
      const text =
        "1\n00:00:01,000 --> 00:00:02,000\nExact preserved caption\n";
      const checksum = createHash("sha256").update(text).digest("hex");
      await writeFile(target, text);
      const subtitle = await db.subtitleAsset.create({
        data: {
          assetId: video.entry.assetId,
          language: "en",
          providerId: "synthetic",
          path: storedWorkerPath(f.context, "movies", target),
          state: "installed",
          qualityStatus,
          ownershipEpoch: 0,
          storageKind: "sidecar",
          videoChecksum: video.entry.checksum,
          videoVersion: 0,
          checksum,
          provenance: { checksum },
          matchingEvidence: { inspectedAssetVersion: 0 },
        },
      });
      const nonparticipants = await Promise.all(
        ["validated", "purged", "failed"].map((state) =>
          db.subtitleAsset.create({
            data: {
              assetId: video.entry.assetId,
              language: "en",
              providerId: "pending-fixture",
              state,
              qualityStatus: "accepted",
              ownershipEpoch: 0,
              storageKind: "sidecar",
              checksum,
              videoChecksum: video.entry.checksum,
              videoVersion: 0,
              path: null,
              provenance: { checksum },
              matchingEvidence: { content: text },
            },
          }),
        ),
      );
      const bound = await prepareBoundRetention(f, video, harness.context());
      const retention = bound.retention;
      const activities = createMediaFileActivities(f.context);
      if (interrupted) {
        f.context.checkpoint = (phase) =>
          phase === "move-unlinked"
            ? Promise.reject(new Error("quarantine interrupted"))
            : Promise.resolve();
        await expect(
          activities.quarantineMediaFiles(retention.input),
        ).rejects.toThrow("quarantine interrupted");
        expect(
          await db.subtitleAsset.findUniqueOrThrow({
            where: { id: subtitle.id },
          }),
        ).toMatchObject({ state: "installed", videoVersion: 0, version: 0 });
        await db.retentionDecision.update({
          where: { id: retention.decision.id },
          data: { state: "cancelled" },
        });
        f.context.checkpoint = () => Promise.resolve();
      } else {
        expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
          status: "quarantined",
        });
      }
      await expect(access(target)).rejects.toThrow();
      const intent = await db.mediaIntent.update({
        where: targetWhere(defaultScope(f.media.id)),
        data: { generation: { increment: 1 } },
      });
      const operation = await db.operation.create({
        data: {
          kind: "restore_media",
          payload: { mediaId: f.media.id, generation: intent.generation },
        },
      });
      expect(
        await activities.restoreMediaFiles({
          mediaId: f.media.id,
          operationId: operation.id,
        }),
      ).toEqual({ status: "restored" });
      expect(await readFile(target, "utf8")).toBe(text);
      const current = await db.subtitleAsset.findUniqueOrThrow({
        where: { id: subtitle.id },
      });
      const asset = await db.libraryAsset.findUniqueOrThrow({
        where: { id: subtitle.assetId },
      });
      expect(current).toMatchObject({
        qualityStatus,
        videoVersion: asset.version,
        videoChecksum: asset.checksum,
        matchingEvidence: { inspectedAssetVersion: 0 },
      });
      expect(asset.version).toBe(interrupted ? 1 : 2);
      expect(ownedSubtitleSidecars({ ...asset, subtitles: [current] })).toEqual(
        [current],
      );
      expect(subtitleAccepted({ subtitle: current, asset, epoch: 0 })).toBe(
        qualityStatus === "accepted",
      );
      for (const original of nonparticipants) {
        const untouched = await db.subtitleAsset.findUniqueOrThrow({
          where: { id: original.id },
        });
        expect(untouched).toMatchObject({
          state: original.state,
          videoVersion: 0,
          version: 0,
          path: null,
        });
        expect(subtitleAccepted({ subtitle: untouched, asset, epoch: 0 })).toBe(
          false,
        );
      }
    });
  }
}
test("historical installed labels without ownership protect physical cleanup", async () => {
  const db = harness.database();
  const f = await mappedPublicationFixture(db);
  directories.push(f.directory);
  const video = await preparePhysicalPublication(f);
  const bound = await prepareBoundRetention(f, video, harness.context());
  const retention = bound.retention;
  await db.subtitleAsset.create({
    data: {
      assetId: video.entry.assetId,
      language: "en",
      state: "installed",
      providerId: "old",
      provenance: {},
      matchingEvidence: {},
      path: storedWorkerPath(
        f.context,
        "movies",
        path.join(f.roots.library, "unknown.srt"),
      ),
    },
  });
  expect(
    await createMediaFileActivities(f.context).quarantineMediaFiles(
      retention.input,
    ),
  ).toMatchObject({
    status: "protected",
    reason: "subtitle_ownership_unconfirmed",
  });
  expect(
    await readFile(path.join(f.roots.library, video.entry.libraryPath), "utf8"),
  ).toBe(video.content);
});
