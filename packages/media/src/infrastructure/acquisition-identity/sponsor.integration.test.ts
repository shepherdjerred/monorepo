import { expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "./test-fixture.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";

const { database, context } = automationTestHarness();
const OperationInput = z.object({
  operationId: z.uuid(),
  mediaId: z.uuid(),
  generation: z.number().int(),
});

test("configured worker server must match immutable sponsor authority", async () => {
  const f = await identityFixture(database(), context());
  try {
    const acquired = await f.acquire();
    expect(
      await createMediaFileActivities({
        ...f.files.context,
        serverMachineId: "different-server",
      }).inspectAndStageMedia(acquired.input),
    ).toEqual({ status: "blocked", reason: "acquisition_server_changed" });
    expect(
      await createAcquisitionActivities({
        ...f.network,
        serverMachineId: "different-server",
      }).submitMediaTorrent(acquired.input),
    ).toMatchObject({
      status: "blocked",
      reason: "acquisition_server_changed",
    });
    expect(f.adds()).toBe(1);
    const attempt = await database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    expect(attempt.filePlan).toBeNull();
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test.each(["stage", "promote", "missing_history"])(
  "historical pending file acquisition rechecks sponsor authority at %s",
  async (phase) => {
    const db = database();
    const f = await fileFixture(db);
    try {
      const acquired = await f.acquisition();
      const activities = createMediaFileActivities(f.context);
      if (phase === "promote")
        expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
          status: "staged",
        });
      if (phase === "missing_history")
        await db.operation.delete({
          where: { id: acquired.attempt.operationId },
        });
      else
        await db.plexIdentityMapping.update({
          where: { userId: f.user.id },
          data: { permittedMediaKinds: [], permittedSectionIds: [] },
        });
      const result =
        phase === "promote"
          ? await activities.promoteMediaFiles(acquired.input)
          : await activities.inspectAndStageMedia(acquired.input);
      expect(result).toEqual({
        status: "blocked",
        reason:
          phase === "missing_history"
            ? "acquisition_sponsor_unproven"
            : "plex_library_access_required",
      });
      const current = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: acquired.attempt.id },
      });
      expect(current.identityEvidence).toBeNull();
      expect(
        await db.libraryAsset.count({
          where: { coverage: { some: { mediaId: f.media.id } } },
        }),
      ).toBe(0);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  },
);

test.each([
  "selection",
  "reservation",
  "submission",
  "member_background",
  "allowed",
  "managed",
])(
  "pack requester permissions are exact across all covered leaves: %s",
  async (mode) => {
    const db = database();
    const f = await identityFixture(db, context());
    try {
      const allowed = mode !== "selection" && mode !== "member_background";
      await db.plexIdentityMapping.update({
        where: { userId: f.actor.id },
        data: { permittedSectionIds: allowed ? ["1", "2", "9"] : ["1", "2"] },
      });
      if (mode === "member_background")
        await db.mediaUser.update({
          where: { id: f.actor.id },
          data: { role: "member" },
        });
      const second = await db.mediaItem.create({
        data: {
          kind: "episode",
          title: "Second episode",
          parentId: f.series.id,
          seasonNumber: 1,
          episodeNumber: 2,
          externalIds: { plexSectionId: "9", seriesTmdb: f.series.tmdbId },
          intent: {
            create: { profileId: f.files.profile.id, automationEpoch: 0 },
          },
        },
      });
      let requester = f.actor.id;
      if (mode === "managed") {
        await db.mediaRequest.update({
          where: {
            userId_mediaId: { userId: f.actor.id, mediaId: f.files.media.id },
          },
          data: { active: false },
        });
        const managed = await db.mediaUser.create({
          data: {
            plexAccountId: crypto.randomUUID(),
            displayName: "Managed",
            plexIdentity: {
              create: {
                serverMachineId: "fixture-server",
                homeUserId: crypto.randomUUID(),
                kind: "managed",
                plexRestricted: true,
                permittedSectionIds: ["2", "9"],
                permittedMediaKinds: ["series"],
                verifiedAt: new Date(),
              },
            },
          },
        });
        requester = managed.id;
        await f.service.createRequest(f.actor, crypto.randomUUID(), {
          mediaId: f.files.media.id,
          requesterUserId: managed.id,
          subtitleLanguages: [],
          includeSpecials: false,
        });
      }
      f.source.providerReleaseId = crypto.randomUUID();
      f.source.title = "Example.Show.2020.S01E01-E02.1080p.WEB-DL.H264.ENG";
      const profile = await loadProfile(db, f.files.media.id);
      if (profile === null) throw new Error("Fixture profile missing");
      const found = await searchCandidates(
        f.network,
        f.files.media.id,
        profile,
      );
      expect(found).toHaveLength(1);
      const releaseId = z.uuid().parse(found[0]);
      const current = await db.mediaItem.findUniqueOrThrow({
        where: { id: f.files.media.id },
      });
      const action = () =>
        f.service.act(
          f.actor,
          crypto.randomUUID(),
          current.id,
          mode === "member_background"
            ? { action: "retry", expectedVersion: current.version }
            : {
                action: "select_release",
                releaseId,
                expectedVersion: current.version,
              },
        );
      if (mode === "selection") {
        await expect(action()).rejects.toMatchObject({
          code: "plex_library_access_required",
        });
        expect(
          await db.operation.count({
            where: { targetId: current.id, kind: "acquire_release" },
          }),
        ).toBe(0);
        expect(f.adds()).toBe(0);
        return;
      }
      const command = await action();
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: z.uuid().parse(command.operationId) },
      });
      if (mode === "reservation")
        await db.plexIdentityMapping.update({
          where: { userId: f.actor.id },
          data: { permittedSectionIds: ["1", "2"] },
        });
      const activities = createAcquisitionActivities(f.network);
      const reserved = await activities.reconcileMediaIntent(
        OperationInput.parse(operation.payload),
      );
      if (mode === "reservation" || mode === "member_background") {
        expect(reserved).toMatchObject({
          status: "blocked",
          reason: "plex_library_access_required",
        });
        expect(
          await db.mediaRequest.findUnique({
            where: {
              userId_mediaId: { userId: requester, mediaId: second.id },
            },
          }),
        ).toBeNull();
        expect(f.adds()).toBe(0);
        return;
      }
      expect(reserved.status).toBe("acquire");
      if (mode === "submission")
        await db.plexIdentityMapping.update({
          where: { userId: f.actor.id },
          data: { permittedSectionIds: ["1", "2"] },
        });
      const submitted = await activities.submitMediaTorrent({
        operationId: operation.id,
        attemptId: z.uuid().parse(reserved.attemptId),
      });
      expect(submitted.status).toBe(
        mode === "submission" ? "blocked" : "submitted",
      );
      expect(f.adds()).toBe(mode === "submission" ? 0 : 1);
      if (mode === "managed") {
        const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: z.uuid().parse(reserved.attemptId) },
        });
        expect(attempt.identityEvidence).toMatchObject({
          sponsorAuthority: {
            userId: requester,
            actorId: f.actor.id,
            serverMachineId: "fixture-server",
          },
        });
      }
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
);
