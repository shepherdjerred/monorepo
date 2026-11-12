import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, vi } from "vitest";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";

export const PersonalSeasonOperation = z.object({
  operationId: z.uuid(),
  mediaId: z.uuid(),
  generation: z.int().nonnegative(),
});

/** Negative fixtures revoke one real current authority without fabricating publication. */
export async function changePersonalSeasonAuthority(
  f: Pick<Awaited<ReturnType<typeof personalSeasonFixture>>, "db" | "files">,
  change: "profile" | "reservation" | "request" | "runtime",
) {
  switch (change) {
    case "profile":
      await f.db.qualityProfile.update({
        where: { id: f.files.profile.id },
        data: { version: { increment: 1 } },
      });
      break;
    case "reservation":
      // Deliberately corrupt only the reservation, never real adoption generations.
      await f.db.acquisitionReservation.delete({
        where: {
          mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
        },
      });
      break;
    case "request":
      await f.db.mediaRequest.update({
        where: { id: f.files.request.id },
        data: { active: false },
      });
      break;
    case "runtime":
      await f.db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { mode: "observe", ownershipConfirmed: false },
      });
      break;
  }
}

/** The normal owner selection creates the identity, sponsor, reservations and torrent birth. */
export async function personalSeasonFixture(
  db: Database,
  base: MediaAutomationContext,
  count = 10,
) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100)
    throw new Error("Invalid bounded personal season count");
  const f = await identityFixture(db, base, false, {
    fileFactory: mappedPublicationFixture,
  });
  const siblings = await db.mediaItem.createManyAndReturn({
    data: Array.from({ length: count - 1 }, (_, index) => ({
      kind: "episode",
      title: `Episode ${String(index + 2)}`,
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: index + 2,
    })),
  });
  const media = [f.files.media, ...siblings];
  f.source.providerReleaseId = crypto.randomUUID();
  f.source.title = `Example.Show.2020.S01E01-E${String(count).padStart(2, "0")}.1080p.WEB-DL.H264.ENG`;
  const profile = await loadProfile(db, f.files.media.id);
  if (profile === null) throw new Error("Original profile missing");
  const releases = await searchCandidates(f.network, f.files.media.id, profile);
  const releaseId = z.uuid().parse(releases[0]);
  const view = await f.service.getDefaultCommandContext(
    f.actor,
    f.files.media.id,
  );
  const selected = await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    {
      schemaVersion: 2,
      scope: view.scope,
      expected: view.expected,
      command: { action: "select_release", releaseId },
    },
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(selected.result.operationId) },
  });
  const network = createAcquisitionActivities(f.network);
  const acquired = await network.reconcileMediaIntent(
    PersonalSeasonOperation.parse(operation.payload),
  );
  expect(acquired.status).toBe("acquire");
  const originalInput = {
    operationId: operation.id,
    attemptId: z.uuid().parse(acquired.attemptId),
  };
  expect(await network.submitMediaTorrent(originalInput)).toMatchObject({
    status: "submitted",
  });
  const birth = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: originalInput.attemptId },
  });
  expect(birth.mediaIds.toSorted()).toEqual(
    media.map((item) => item.id).toSorted(),
  );
  const files = media.map((item, index) => ({
    index,
    name: `Example.Show.S01E${String(item.episodeNumber).padStart(2, "0")}.mkv`,
    size: 2,
    progress: 1,
  }));
  for (const file of files)
    await writeFile(path.join(f.files.roots.downloads, file.name), "tv");
  // Only remote completion/ffprobe are synthetic; the personal acquisition and native effects are real.
  await db.torrent.update({
    where: { id: z.uuid().parse(birth.torrentId) },
    data: {
      state: "ready",
      observation: {
        torrent: {
          progress: 1,
          save_path: storedFilePath(f.files.context, "tv", "downloads", ""),
        },
        files,
      },
    },
  });
  await db.acquisitionAttempt.update({
    where: { id: birth.id },
    data: { state: "ready" },
  });
  const originalProbe = f.files.context.inspect;
  if (originalProbe === undefined) throw new Error("Original probe missing");
  const probe = vi.fn(originalProbe);
  f.files.context.inspect = probe;
  const physical = createMediaFileActivities(f.files.context);
  return {
    ...f,
    db,
    network,
    media,
    operation,
    originalInput,
    birth,
    probe,
    physical,
  };
}
