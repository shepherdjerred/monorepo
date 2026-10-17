import { expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";

const { database, context } = automationTestHarness();
const Operation = z.object({
  operationId: z.uuid(),
  mediaId: z.uuid(),
  generation: z.int().nonnegative(),
});

async function setup() {
  const db = database();
  const f = await identityFixture(db, context());
  const second = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Second episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
      externalIds: { plexSectionId: "2", seriesTmdb: f.series.tmdbId },
    },
  });
  f.source.providerReleaseId = crypto.randomUUID();
  f.source.title = "Example.Show.2020.S01E01-E02.1080p.WEB-DL.H264.ENG";
  const activities = createAcquisitionActivities(f.network);
  async function command(manual: boolean) {
    const profile = await loadProfile(db, f.files.media.id);
    if (profile === null) throw new Error("Fixture profile missing");
    const candidates = manual
      ? await searchCandidates(f.network, f.files.media.id, profile)
      : [];
    const releaseId = candidates[0];
    if (manual && releaseId === undefined)
      throw new Error("Expected exact pack candidate");
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.files.media.id },
    });
    const result = await f.service.act(
      f.actor,
      crypto.randomUUID(),
      media.id,
      releaseId === undefined
        ? { action: "retry", expectedVersion: media.version }
        : {
            action: "select_release",
            releaseId,
            expectedVersion: media.version,
          },
    );
    const op = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(result.operationId) },
    });
    return Operation.parse(op.payload);
  }
  return { ...f, db, second, activities, command };
}

test.each([true, false])(
  "fresh pack siblings are created only by successful reservation (manual=%s)",
  async (manual) => {
    const f = await setup();
    try {
      const input = await f.command(manual);
      expect(
        await f.db.mediaIntent.count({ where: { mediaId: f.second.id } }),
      ).toBe(0);
      const result = await f.activities.reconcileMediaIntent(input);
      expect(result.status).toBe("acquire");
      const attemptId = z.uuid().parse(result.attemptId);
      expect(
        await f.db.mediaIntent.findUniqueOrThrow({
          where: targetWhere(defaultScope(f.second.id)),
        }),
      ).toMatchObject({
        editionRootId: f.series.id,
        generation: 1,
        version: 0,
        automationEpoch: 0,
        desiredPresence: true,
        monitoring: true,
        profileId: f.files.profile.id,
      });
      expect(
        await f.db.mediaRequest.count({
          where: { mediaId: f.second.id, sponsorRequestId: f.files.request.id },
        }),
      ).toBe(1);
      expect(
        await f.activities.submitMediaTorrent({
          attemptId,
          operationId: input.operationId,
        }),
      ).toMatchObject({ status: "submitted" });
      expect(f.adds()).toBe(1);
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
);

test.each([0, 4])(
  "existing unassigned generation %s is never mistaken for a new sibling; declined reservation removes only fresh placeholders",
  async (generation) => {
    const f = await setup();
    try {
      await f.db.$transaction(async (tx) => {
        await lockDefaultScopes(tx, [defaultScope(f.second.id)], {
          createMissing: true,
        });
        await tx.mediaIntent.update({
          where: targetWhere(defaultScope(f.second.id)),
          data: { generation },
        });
      });
      const third = await f.db.mediaItem.create({
        data: {
          kind: "episode",
          title: "Third episode",
          parentId: f.series.id,
          seasonNumber: 1,
          episodeNumber: 3,
        },
      });
      f.source.title = "Example.Show.2020.S01E01-E03.1080p.WEB-DL.H264.ENG";
      const input = await f.command(false);
      const before = await f.db.mediaIntent.findUniqueOrThrow({
        where: targetWhere(defaultScope(f.second.id)),
      });
      const primary = await f.db.mediaItem.findUniqueOrThrow({
        where: { id: f.files.media.id },
      });
      expect(await f.activities.reconcileMediaIntent(input)).toMatchObject({
        status: "waiting",
        attemptId: null,
      });
      expect(
        await f.db.mediaIntent.findUniqueOrThrow({
          where: targetWhere(defaultScope(f.second.id)),
        }),
      ).toEqual(before);
      expect(
        await f.db.mediaIntent.count({ where: { mediaId: third.id } }),
      ).toBe(0);
      const currentPrimary = await f.db.mediaItem.findUniqueOrThrow({
        where: { id: primary.id },
      });
      expect(currentPrimary.version).toBe(primary.version + 1);
      expect(f.adds()).toBe(0);
      expect(
        await f.db.acquisitionAttempt.count({
          where: { mediaIds: { has: third.id } },
        }),
      ).toBe(0);
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
);

test("revoked sponsor permission rolls back newly inserted siblings before torrent submission", async () => {
  const f = await setup();
  try {
    const input = await f.command(true);
    await f.db.plexIdentityMapping.update({
      where: { userId: f.actor.id },
      data: { permittedSectionIds: ["9"] },
    });
    expect(await f.activities.reconcileMediaIntent(input)).toMatchObject({
      status: "blocked",
      attemptId: null,
    });
    expect(
      await f.db.mediaIntent.count({ where: { mediaId: f.second.id } }),
    ).toBe(0);
    expect(
      await f.db.mediaRequest.count({ where: { mediaId: f.second.id } }),
    ).toBe(0);
    expect(f.adds()).toBe(0);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});
