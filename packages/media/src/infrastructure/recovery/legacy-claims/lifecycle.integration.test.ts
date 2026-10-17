import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { buildRecoveryClaims } from "./projection.ts";
import { legacyLifecycleHarness } from "./lifecycle-fixture.ts";
import { LEGACY_CLAIM_PROTECTION } from "./protection.ts";
const harness = legacyLifecycleHarness();

test("explicit owner removal cannot bypass a newly arrived unresolved household claim", async () => {
  const f = await harness.fixture();
  const media = await f.db.mediaItem.update({
    where: { id: f.media.id },
    data: { version: { increment: 1 } },
  });
  const intent = await f.db.mediaIntent.update({
    where: { mediaId: media.id },
    data: { generation: { increment: 1 }, desiredPresence: false },
  });
  const ownerOverride = {
    ownerId: f.owner.id,
    media: [
      {
        id: media.id,
        title: media.title,
        version: media.version,
        generation: intent.generation,
      },
    ],
    assets: [
      {
        id: f.published.entry.assetId,
        version: 0,
        checksum: f.published.entry.checksum,
      },
    ],
  };
  const operation = await f.db.operation.create({
    data: {
      kind: "retain_media",
      userId: f.owner.id,
      payload: {
        mediaId: media.id,
        generation: intent.generation,
        action: "remove",
        ownerOverride,
      },
    },
  });
  const decision = await f.db.retentionDecision.create({
    data: {
      mediaId: media.id,
      generation: intent.generation,
      state: "grace_period",
      graceUntil: z.date().parse(f.context.now?.()),
      evidence: {
        ownerOverride: { ...ownerOverride, operationId: operation.id },
        authorizedAt: z.date().parse(f.context.now?.()).toISOString(),
        activePlayback: false,
        recoveryEpoch: 0,
      },
    },
  });
  await f.capture(true);
  expect(
    await createRetentionActivities(f.network).evaluateMediaRetention({
      mediaId: media.id,
      generation: intent.generation,
      operationId: operation.id,
    }),
  ).toMatchObject({ status: "protected", reason: LEGACY_CLAIM_PROTECTION });
  expect(
    await createMediaFileActivities(f.context).quarantineMediaFiles({
      decisionId: decision.id,
      operationId: operation.id,
    }),
  ).toMatchObject({ status: "protected" });
  expect(
    await readFile(
      `${f.roots.library}/${f.published.entry.libraryPath}`,
      "utf8",
    ),
  ).toBe(f.published.content);
});

test("a late claim during upgrade archive hashing prevents cleanup of the recoverable previous video", async () => {
  const f = await harness.fixture();
  await f.db.acquisitionAttempt.update({
    where: { id: f.published.attempt.id },
    data: { state: "completed" },
  });
  const inspect = f.context.inspect;
  if (inspect === undefined) throw new Error("Fixture inspector missing");
  f.context.inspect = async (filename) => {
    const probe = await inspect(filename);
    return {
      ...probe,
      streams: probe.streams.map((stream) =>
        stream.codec_type === "video"
          ? { ...stream, width: 3840, height: 1600 }
          : stream,
      ),
    };
  };
  const upgrade = await f.acquisition(
    "New verified playback for legacy claim cleanup fixture",
  );
  const files = createMediaFileActivities(f.context);
  expect(await files.inspectAndStageMedia(upgrade.input)).toEqual({
    status: "staged",
  });
  expect(await files.promoteMediaFiles(upgrade.input)).toEqual({
    status: "published",
  });
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: upgrade.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Fixture plan missing");
  await f.db.$transaction(async (tx) => {
    await tx.mediaItem.update({
      where: { id: f.media.id },
      data: { availability: "available" },
    });
    await recordVerifiedPublication(tx, [entry.assetId], 0);
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: attempt.id },
    });
  });
  const cleanup = await f.db.upgradeCleanup.findUniqueOrThrow({
    where: {
      assetId_successorAssetId: {
        assetId: f.published.entry.assetId,
        successorAssetId: entry.assetId,
      },
    },
  });
  const old = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.published.entry.assetId },
  });
  f.advance(8 * 86_400_000);
  let inserted = false;
  f.context.checkpoint = async (phase) => {
    if (phase === "content-proof-hashing" && !inserted) {
      inserted = true;
      await f.capture(true);
    }
  };
  expect(
    await files.cleanupSupersededMediaFile({
      cleanupId: cleanup.id,
      operationId: crypto.randomUUID(),
    }),
  ).toEqual({ status: "protected", reason: LEGACY_CLAIM_PROTECTION });
  expect(inserted).toBe(true);
  expect(await readFile(old.path, "utf8")).toBe(f.published.content);
  expect(
    await readFile(`${f.roots.library}/${entry.libraryPath}`, "utf8"),
  ).toBe(upgrade.content);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: f.media.id },
    }),
  ).toMatchObject({ releasedAt: null });
});

test.each([false, true])(
  "a late mapped=%s claim after warning blocks retention and opens a reviewable hold",
  async (mapped) => {
    const f = await harness.fixture();
    const captureId = await f.capture(mapped);
    const claims = await buildRecoveryClaims(f.db, {
      planIds: [],
      mediaIds: [f.media.id],
    });
    if (mapped) {
      expect(claims.blockers).toEqual([]);
      expect(claims.claims).toHaveLength(1);
    }
    const result = await createRetentionActivities(
      f.network,
    ).evaluateMediaRetention({
      mediaId: f.media.id,
      operationId: crypto.randomUUID(),
      generation: f.retention.decision.generation,
    });
    expect(result).toMatchObject({
      status: "protected",
      reason: LEGACY_CLAIM_PROTECTION,
    });
    expect(
      await f.db.recoveryHold.findUniqueOrThrow({
        where: { mediaId: f.media.id },
      }),
    ).toMatchObject({ releasedAt: null, reason: LEGACY_CLAIM_PROTECTION });
    expect(
      await f.db.retentionDecision.findUniqueOrThrow({
        where: { id: f.retention.decision.id },
      }),
    ).toMatchObject({
      state: "cancelled",
      graceUntil: null,
      warningAcceptedAt: null,
    });
    if (!mapped) await f.bind(captureId);
    await f.release();
    const resolved = await buildRecoveryClaims(f.db, {
      planIds: [],
      mediaIds: [f.media.id],
    });
    expect(resolved.claims).toEqual([]);
    expect(resolved.blockers).toEqual([]);
    expect(
      await f.db.recoveryHold.findUniqueOrThrow({
        where: { mediaId: f.media.id },
      }),
    ).not.toMatchObject({ releasedAt: null });
    expect(
      await createMediaFileActivities(f.context).quarantineMediaFiles(
        f.retention.input,
      ),
    ).toMatchObject({ status: "protected", reason: "decision_obsolete" });
    expect(
      await readFile(
        f.published.entry.libraryPath.startsWith("/")
          ? f.published.entry.libraryPath
          : `${f.roots.library}/${f.published.entry.libraryPath}`,
        "utf8",
      ),
    ).toBe(f.published.content);
  },
);

test.each([false, true])(
  "late mapped=%s claim after quarantine blocks actual purge and preserves its manifest",
  async (mapped) => {
    const f = await harness.fixture();
    const files = createMediaFileActivities(f.context);
    expect(await files.quarantineMediaFiles(f.retention.input)).toEqual({
      status: "quarantined",
    });
    const before = await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: f.retention.decision.id },
    });
    await f.capture(mapped);
    f.advance(8 * 86_400_000);
    await f.refresh();
    expect(await files.purgeMediaFiles(f.retention.input)).toMatchObject({
      status: "protected",
      reason: LEGACY_CLAIM_PROTECTION,
    });
    const after = await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.manifest).toEqual(before.manifest);
    expect(after.state).toBe("quarantined");
    expect(after.warningAcceptedAt).toBeNull();
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: f.published.entry.assetId },
      }),
    ).toMatchObject({ state: "quarantined" });
    const manifest = z
      .object({ assets: z.array(z.object({ quarantineId: z.string() })) })
      .parse(after.manifest);
    const entry = manifest.assets[0];
    if (entry === undefined) throw new Error("Quarantine fixture missing");
    expect(
      await readFile(
        `${f.roots.control}/quarantine/${entry.quarantineId}`,
        "utf8",
      ),
    ).toBe(f.published.content);
    expect(
      await f.db.recoveryHold.findUniqueOrThrow({
        where: { mediaId: f.media.id },
      }),
    ).toMatchObject({ releasedAt: null });
  },
);

test.each([false, true])(
  "a mapped=%s claim arriving during hashing is checked again at the exact filesystem effect",
  async (mapped) => {
    const f = await harness.fixture();
    let inserted = false;
    f.context.checkpoint = async (phase) => {
      if (phase === "content-proof-hashing" && !inserted) {
        inserted = true;
        await f.capture(mapped);
      }
    };
    expect(
      await createMediaFileActivities(f.context).quarantineMediaFiles(
        f.retention.input,
      ),
    ).toMatchObject({ status: "protected", reason: LEGACY_CLAIM_PROTECTION });
    expect(inserted).toBe(true);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: f.published.entry.assetId },
      }),
    ).toMatchObject({ state: "published" });
    expect(
      await readFile(
        `${f.roots.library}/${f.published.entry.libraryPath}`,
        "utf8",
      ),
    ).toBe(f.published.content);
    expect(
      await f.db.recoveryHold.findUniqueOrThrow({
        where: { mediaId: f.media.id },
      }),
    ).toMatchObject({ releasedAt: null });
  },
);
