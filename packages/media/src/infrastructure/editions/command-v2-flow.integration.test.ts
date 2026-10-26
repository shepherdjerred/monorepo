import { expect, test, vi } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import { nativeQuarantineFixture } from "#automation/native-quarantine/test-fixture.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { AcquisitionIdentitySnapshotSchema } from "#shared/acquisition/identity.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import type { DefaultCommandV2 } from "#shared/editions/commands.ts";
import type { MediaActor } from "#application/auth.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import {
  storedFilePath,
  workerFilePath,
} from "#automation/files/paths/locations.ts";

const harness = automationTestHarness();
const MediaOperation = z.object({
  operationId: z.uuid(),
  mediaId: z.uuid(),
  generation: z.int(),
});
const RestoreOperation = MediaOperation.extend({ continuationId: z.uuid() });

async function command(
  app: PrismaMediaApplication,
  actor: MediaActor,
  mediaId: string,
  input: DefaultCommandV2["command"],
) {
  const view = await app.getDefaultCommandContext(actor, mediaId);
  return await app.executeDefaultCommand(
    actor,
    crypto.randomUUID(),
    DefaultCommandV2Schema.parse({
      schemaVersion: 2,
      scope: view.scope,
      expected: view.expected,
      command: input,
    }),
  );
}

test.each(["request", "select_release"])(
  "v2 %s dispatches unchanged work through qBittorrent, file promotion and exact Plex publication",
  async (mode) => {
    const db = harness.database();
    const f = await identityFixture(db, harness.context(), false, {
      fileFactory: mappedPublicationFixture,
      releaseTitle:
        mode === "request"
          ? "Example.Show.2020.S01E01.1080p.WEB-DL.H264.ENG"
          : undefined,
    });
    try {
      const requested = await command(f.service, f.actor, f.files.media.id, {
        action: "request",
        subtitleLanguages: [],
        includeSpecials: false,
      });
      const requestOperation = await db.operation.findUniqueOrThrow({
        where: { id: z.uuid().parse(requested.result.operationId) },
        include: { outbox: true },
      });
      expect(requestOperation.kind).toBe("reconcile_media");
      expect(requestOperation.payload).toEqual({
        operationId: requestOperation.id,
        kind: "reconcile_media",
        mediaId: f.files.media.id,
        generation: 1,
        recoveryEpoch: 0,
        requestId: f.files.request.id,
        requestVersion: 1,
        cursor: null,
      });
      expect(requestOperation.outbox?.payload).toEqual(
        requestOperation.payload,
      );
      let operation = requestOperation;
      if (mode === "select_release") {
        const preview = await f.review();
        expect(preview.confirmationAllowed).toBe(true);
        const selected = await command(f.service, f.actor, f.files.media.id, {
          action: "select_release",
          releaseId: f.release.id,
          identityConfirmation: {
            previewDigest: preview.previewDigest,
            candidateDigest: preview.candidateDigest,
            numberingDigest: preview.numberingDigest,
            mediaIds: preview.media.map((item) => item.id),
            reason: "Verified this exact show and episode",
            acknowledgeIdentity: true,
          },
        });
        operation = await db.operation.findUniqueOrThrow({
          where: { id: z.uuid().parse(selected.result.operationId) },
          include: { outbox: true },
        });
        expect(operation.kind).toBe("acquire_release");
      }
      expect(operation.payload).not.toHaveProperty("schemaVersion");
      expect(operation.payload).not.toHaveProperty("expected");
      const start = vi.fn(() => Promise.resolve());
      await createOutboxActivities(db, start).dispatchMediaOutbox();
      expect(start).toHaveBeenCalledWith({
        workflowType: "reconcileMediaWorkflow",
        workflowId: `media-operation-${operation.id}`,
        input: operation.payload,
      });
      const acquisition = createAcquisitionActivities(f.network);
      const acquired = await acquisition.reconcileMediaIntent(
        MediaOperation.parse(operation.payload),
      );
      expect(acquired.status).toBe("acquire");
      const activityInput = {
        operationId: operation.id,
        attemptId: z.uuid().parse(acquired.attemptId),
      };
      expect(await acquisition.submitMediaTorrent(activityInput)).toMatchObject(
        {
          status: "submitted",
        },
      );
      expect(f.adds()).toBe(1);
      const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: activityInput.attemptId },
      });
      expect(
        AcquisitionIdentitySnapshotSchema.parse(attempt.identityEvidence),
      ).toMatchObject({
        proof: { kind: mode === "request" ? "automatic" : "owner" },
        birthEpoch: 0,
        coverage: [f.files.media.id],
      });
      const filename = "Example.Show.S01E01.mkv";
      await writeFile(
        path.join(f.files.roots.downloads, filename),
        "Fixture media bytes!",
      );
      await db.torrent.update({
        where: { id: z.uuid().parse(attempt.torrentId) },
        data: {
          state: "ready",
          observation: {
            torrent: {
              progress: 1,
              save_path: storedFilePath(f.files.context, "tv", "downloads", ""),
            },
            files: [{ index: 0, name: filename, size: 20, progress: 1 }],
          },
        },
      });
      await db.acquisitionAttempt.update({
        where: { id: attempt.id },
        data: { state: "ready" },
      });
      const files = createMediaFileActivities(f.files.context);
      expect(await files.inspectAndStageMedia(activityInput)).toMatchObject({
        status: "staged",
      });
      expect(await files.promoteMediaFiles(activityInput)).toMatchObject({
        status: "published",
      });
      const imported = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      const plan = FilePlanSchema.parse(imported.filePlan);
      expect(Array.isArray(imported.filePlan)).toBe(true);
      const entry = plan[0];
      if (entry === undefined) throw new Error("Published file plan missing");
      const asset = await db.libraryAsset.findUniqueOrThrow({
        where: { id: entry.assetId },
      });
      expect(
        await readFile(workerFilePath(f.files.context, asset.path), "utf8"),
      ).toBe("Fixture media bytes!");
      const plex = await retentionPlexContext(
        db,
        harness.context(),
        attempt.mediaIds,
      );
      const network = plex.context;
      expect(
        await createPublicationActivities(network).publishMediaToPlex(
          activityInput,
        ),
      ).toEqual({ status: "available", reason: null });
      const show = [...plex.metadata.values()].find(
        (item) => item.type === "show",
      );
      if (show === undefined)
        throw new Error("Actual publication omitted its canonical Plex show");
      expect(plex.calls).toContain(`/library/metadata/${show.ratingKey}`);
      expect(
        await db.mediaItem.findUniqueOrThrow({
          where: { id: f.files.media.id },
        }),
      ).toMatchObject({ availability: "available" });
      expect(
        await db.mediaIntent.findUniqueOrThrow({
          where: {
            mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
          },
        }),
      ).toMatchObject({
        availability: "available",
        generation: mode === "request" ? 1 : 2,
        automationEpoch: 0,
      });
      const final = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(final.filePlan).toEqual(imported.filePlan);
      expect(final.identityEvidence).toEqual(attempt.identityEvidence);
      expect(final.recoveryEpoch).toBe(attempt.recoveryEpoch);
      expect(final.generations).toEqual(attempt.generations);
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
);

test("v2 request and Keep route through the native quarantine continuation without rebirthing physical history", async () => {
  const db = harness.database();
  const f = await nativeQuarantineFixture(db, harness.cipher);
  try {
    const continuation = await f.apply();
    const decisions = await db.retentionDecision.findMany({
      where: { mediaId: f.file.media.id },
      orderBy: { id: "asc" },
    });
    const attempt = await db.acquisitionAttempt.findFirstOrThrow({
      where: { mediaIds: { has: f.file.media.id } },
    });
    await db.plexIdentityMapping.upsert({
      where: { userId: f.file.user.id },
      create: {
        userId: f.file.user.id,
        serverMachineId: "server",
        serverAccountId: f.file.user.plexAccountId,
        kind: "account",
        permittedSectionIds: ["1"],
        permittedMediaKinds: ["movie"],
        verifiedAt: new Date(),
      },
      update: {
        serverMachineId: "server",
        permittedSectionIds: ["1"],
        permittedMediaKinds: ["movie"],
        verifiedAt: new Date(),
      },
    });
    const app = new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: "server",
    });
    const requested = await command(app, f.file.user, f.file.media.id, {
      action: "request",
      subtitleLanguages: [],
      includeSpecials: false,
    });
    const kept = await command(app, f.file.user, f.file.media.id, {
      action: "keep",
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(kept.result.operationId) },
      include: { outbox: true },
    });
    expect(operation.kind).toBe("restore_native_quarantine");
    expect(operation.outbox?.payload).toEqual(operation.payload);
    const input = RestoreOperation.parse(operation.payload);
    expect(input.continuationId).toBe(continuation.id);
    const obsolete = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(requested.result.operationId) },
    });
    expect(obsolete.kind).toBe("restore_native_quarantine");
    expect(
      await f.activities.restoreNativeQuarantineFiles(
        RestoreOperation.parse(obsolete.payload),
      ),
    ).toMatchObject({ status: "protected" });
    expect(await f.activities.restoreNativeQuarantineFiles(input)).toEqual({
      status: "restored",
    });
    const restored = await db.nativeQuarantineContinuation.findUniqueOrThrow({
      where: { id: continuation.id },
    });
    expect(restored.descriptor).toEqual(continuation.descriptor);
    expect(restored.recoveryEpoch).toBe(continuation.recoveryEpoch);
    expect(
      await db.retentionDecision.findMany({
        where: { mediaId: f.file.media.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(decisions);
    const historical = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(historical.filePlan).toEqual(attempt.filePlan);
    expect(historical.identityEvidence).toEqual(attempt.identityEvidence);
    expect(historical.recoveryEpoch).toBe(attempt.recoveryEpoch);
    expect(await f.activities.restoreNativeQuarantineFiles(input)).toEqual({
      status: "restored",
    });
    const replayed = await db.nativeQuarantineContinuation.findUniqueOrThrow({
      where: { id: continuation.id },
    });
    expect(replayed.restoration).toEqual(restored.restoration);
  } finally {
    await rm(f.file.directory, { recursive: true, force: true });
  }
});

test("revoked library access exposes only protective v2 context and still permits exact own Keep and Cancel", async () => {
  const db = harness.database();
  const f = await identityFixture(db, harness.context());
  try {
    const member = await db.mediaUser.update({
      where: { id: f.actor.id },
      data: { role: "member" },
    });
    await db.plexIdentityMapping.update({
      where: { userId: member.id },
      data: {
        permittedSectionIds: [],
        permittedMediaKinds: [],
        version: { increment: 1 },
      },
    });
    const view = await f.service.getDefaultCommandContext(
      member,
      f.files.media.id,
    );
    expect(view).toEqual({
      schemaVersion: 2,
      scope: { mediaId: f.files.media.id, edition: "default" },
      expected: { mediaVersion: 0, targetVersion: 0 },
      access: "protection_only",
      ownRequests: [
        { id: f.files.request.id, version: 0, active: true, canCancel: true },
      ],
      allowedProtectiveActions: expect.arrayContaining([
        "keep",
        "cancel_request",
      ]),
    });
    expect(Object.keys(view).sort()).toEqual([
      "access",
      "allowedProtectiveActions",
      "expected",
      "ownRequests",
      "schemaVersion",
      "scope",
    ]);
    const other = await db.mediaUser.create({
      data: { plexAccountId: crypto.randomUUID(), displayName: "Unrelated" },
    });
    await expect(
      f.service.getDefaultCommandContext(other, f.files.media.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.getMedia(member, f.files.media.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      command(f.service, member, f.files.media.id, {
        action: "request",
        subtitleLanguages: [],
        includeSpecials: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await command(f.service, member, f.files.media.id, { action: "keep" });
    await command(f.service, member, f.files.media.id, {
      action: "cancel_request",
      requestId: f.files.request.id,
      requestVersion: 0,
    });
    expect(
      await db.mediaRequest.findUniqueOrThrow({
        where: { id: f.files.request.id },
      }),
    ).toMatchObject({ active: false, excluded: true });
    const cancelled = await f.service.getDefaultCommandContext(
      member,
      f.files.media.id,
    );
    expect(cancelled.allowedProtectiveActions).not.toContain("keep");
    await expect(
      command(f.service, member, f.files.media.id, { action: "keep" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.adds()).toBe(0);
    expect(
      await db.acquisitionAttempt.count({ where: { releaseId: f.release.id } }),
    ).toBe(0);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});
