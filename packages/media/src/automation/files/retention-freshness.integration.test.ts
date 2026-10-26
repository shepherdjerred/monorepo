import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { boundRetentionFixture } from "#automation/retention/lifecycle.test-fixture.ts";
import { workerFilePath } from "./paths/locations.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import { z } from "zod";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { RemovalPlanSchema } from "./types.ts";
import { elapsedQuarantineClient } from "./plex-binding/elapsed-quarantine.test-support.ts";
import {
  captureWatchReset,
  assertWatchResetAndNewWarning,
} from "./plex-binding/watch-reset.test-support.ts";

const harness = automationTestHarness();

test("still-valid 31-second authority does not wait for an unnecessary refresh", async () => {
  const db = harness.database();
  const bound = await boundRetentionFixture(db, harness.context());
  const f = bound.files;
  try {
    const timing = await elapsedQuarantineClient(db, {
      ...bound.retention.input,
      mediaIds: bound.published.entry.mediaIds,
      timing: "current_transition",
    });
    f.context.db = timing.db;
    let waits = 0;
    f.context.checkpoint = async (phase) => {
      if (phase === "content-proof-ready") f.advance(31_000);
      if (phase === "retention-authority-wait" && ++waits > 1)
        throw new Error("Valid authority was unnecessarily deferred");
    };
    expect(
      await createMediaFileActivities(f.context).quarantineMediaFiles(
        bound.retention.input,
      ),
    ).toEqual({ status: "quarantined" });
    expect(waits).toBe(1);
    const birth = await timing.assertCommitted();
    expect(birth.committedAt.getTime()).toBeLessThanOrEqual(Date.now());
  } finally {
    f.context.db = db;
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("75-second original authority cannot renew during hashing; a new Network proof needs a new Files invocation", async () => {
  const db = harness.database();
  const bound = await boundRetentionFixture(db, harness.context());
  const f = bound.files;
  try {
    const original = bound.retention.decision;
    const originalAsset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: bound.asset.id },
    });
    let hashed = 0;
    f.context.checkpoint = async (phase) => {
      if (phase !== "content-proof-ready") return;
      hashed++;
      f.advance(75_000);
      const timestamp = f.context.now?.();
      if (timestamp === undefined) throw new Error("Fixture clock missing");
      // Deliberate row-refresh fault injection, NOT a Network observation or new authority.
      await db.$transaction(async (tx) => {
        const evidence = z
          .record(z.string(), z.json())
          .parse(original.evidence);
        await tx.retentionDecision.update({
          where: { id: original.id },
          data: {
            evidence: {
              ...evidence,
              authorizedAt: timestamp.toISOString(),
              plexExpiresAtMs: timestamp.getTime() + 60_000,
            },
          },
        });
        await tx.watchState.updateMany({
          where: { mediaId: f.media.id },
          data: { observedAt: timestamp },
        });
        await tx.notificationDelivery.updateMany({
          where: { userId: f.user.id },
          data: { reconciledAt: timestamp },
        });
      });
    };
    expect(
      await createMediaFileActivities(f.context).quarantineMediaFiles(
        bound.retention.input,
      ),
    ).toEqual({ status: "protected", reason: "evidence_stale" });
    expect(hashed).toBe(1);
    expect(
      await db.libraryAsset.findUniqueOrThrow({
        where: { id: bound.asset.id },
      }),
    ).toEqual(originalAsset);
    expect(
      await readFile(workerFilePath(f.context, originalAsset.path), "utf8"),
    ).toBe(bound.published.content);
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: bound.retention.input.operationId },
    });
    expect(operation.result).toBeNull();
    expect(
      await db.retentionDecision.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toMatchObject({
      state: "grace_period",
      version: original.version,
      quarantinedAt: null,
    });

    // The first invocation is CLOSED. Reset only its simulated hashing clock, then use real producers.
    bound.resetFileClock();
    f.context.checkpoint = (phase) => {
      if (phase === "content-proof-ready") hashed++;
      return Promise.resolve();
    };
    expect(await bound.refresh()).toMatchObject({
      status: "quarantine",
      decisionId: original.id,
    });
    expect(bound.retention.decision.warningAcceptedAt).toEqual(
      original.warningAcceptedAt,
    );
    expect(bound.retention.decision.graceUntil).toEqual(original.graceUntil);
    expect(
      await createMediaFileActivities(f.context).quarantineMediaFiles(
        bound.retention.input,
      ),
    ).toEqual({ status: "quarantined" });
    expect(hashed).toBe(2);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("expired automatic purge proof cannot remove bytes or shorten the real quarantine window", async () => {
  const db = harness.database();
  const bound = await boundRetentionFixture(db, harness.context());
  const f = bound.files;
  try {
    expect(await bound.quarantine()).toEqual({ status: "quarantined" });
    const decision = await db.retentionDecision.findUniqueOrThrow({
      where: { id: bound.retention.decision.id },
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: bound.retention.input.operationId },
    });
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: bound.asset.id },
    });
    const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
    if (entry === undefined)
      throw new Error("Actual quarantine omitted its video manifest");
    const quarantinedPath = path.join(
      f.context.roots[entry.libraryKind].control,
      "quarantine",
      entry.quarantineId,
    );
    f.advance(75_000);
    expect(
      await createMediaFileActivities(f.context).purgeMediaFiles(
        bound.retention.input,
      ),
    ).toEqual({ status: "protected", reason: "evidence_stale" });
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).toEqual(asset);
    expect(
      await db.operation.findUniqueOrThrow({ where: { id: operation.id } }),
    ).toEqual(operation);
    expect(await readFile(quarantinedPath, "utf8")).toBe(
      bound.published.content,
    );
    bound.resetFileClock();
    expect(await bound.refresh()).toMatchObject({
      status: "grace",
      decisionId: decision.id,
    });
    expect(
      await createMediaFileActivities(f.context).purgeMediaFiles(
        bound.retention.input,
      ),
    ).toEqual({ status: "protected", reason: "retention_not_due" });
    const current = await db.retentionDecision.findUniqueOrThrow({
      where: { id: decision.id },
    });
    expect(current.quarantinedAt).toEqual(decision.quarantinedAt);
    expect(current.purgeAfter).toEqual(decision.purgeAfter);
    expect(
      await db.operation.findUniqueOrThrow({ where: { id: operation.id } }),
    ).toEqual(operation);
    expect(await readFile(quarantinedPath, "utf8")).toBe(
      bound.published.content,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test.each(["keep", "unwatched", "cancelled"] as const)(
  "fresh observation cannot revive removal after %s changes",
  async (change) => {
    const db = harness.database();
    const bound = await boundRetentionFixture(db, harness.context());
    const f = bound.files;
    try {
      const { published } = bound;
      const before =
        change === "unwatched" ? await captureWatchReset(bound) : null;
      f.context.checkpoint = async (phase) => {
        if (phase !== "content-proof-ready") return;
        if (change === "keep") {
          const current = await db.mediaItem.findUniqueOrThrow({
            where: { id: f.media.id },
          });
          await new PrismaMediaApplication(db, { keepDays: 30 }).act(
            { ...f.user, role: "member" },
            crypto.randomUUID(),
            f.media.id,
            { action: "keep", expectedVersion: current.version },
          );
        }
        if (change === "cancelled") {
          const currentRequest = await db.mediaRequest.findUniqueOrThrow({
            where: { id: f.request.id },
          });
          await new PrismaMediaApplication(db, { keepDays: 30 }).cancelRequest(
            { ...f.user, role: "member" },
            crypto.randomUUID(),
            currentRequest.id,
            currentRequest.version,
          );
        }
        await bound.observe(change === "unwatched" ? false : true);
        const refreshed = await bound.refresh();
        if (change === "unwatched")
          expect(refreshed).toEqual({
            status: "obsolete",
            decisionId: null,
            wakeAt: null,
            reason: "intent_obsolete",
          });
        else expect(refreshed).toMatchObject({ status: "obsolete" });
      };
      expect(
        await createMediaFileActivities(f.context).quarantineMediaFiles(
          bound.retention.input,
        ),
      ).toMatchObject({ status: "protected" });
      const asset = await db.libraryAsset.findUniqueOrThrow({
        where: { id: published.entry.assetId },
      });
      const assetPath = workerFilePath(f.context, asset.path);
      await access(assetPath);
      expect(await readFile(assetPath, "utf8")).toBe(published.content);
      if (before !== null) await assertWatchResetAndNewWarning(bound, before);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  },
);

test("explicit owner removal refreshes after long hashing without bypassing quarantine", async () => {
  const db = harness.database();
  const f = await fileFixture(db);
  try {
    const published = await f.published();
    await db.mediaUser.update({
      where: { id: f.user.id },
      data: { role: "owner" },
    });
    const media = await db.mediaItem.update({
      where: { id: f.media.id },
      data: { version: { increment: 1 } },
    });
    const intent = await db.mediaIntent.update({
      where: targetWhere(defaultScope(media.id)),
      data: { desiredPresence: false, generation: 1 },
    });
    const ownerOverride = {
      ownerId: f.user.id,
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
          id: published.entry.assetId,
          version: 0,
          checksum: published.entry.checksum,
        },
      ],
    };
    const operation = await db.operation.create({
      data: {
        kind: "retain_media",
        userId: f.user.id,
        payload: {
          action: "remove",
          mediaId: media.id,
          generation: 1,
          ownerOverride,
        },
      },
    });
    const timestamp = f.context.now?.();
    if (timestamp === undefined) throw new Error("Fixture clock missing");
    const evidence = {
      ownerOverride: { ...ownerOverride, operationId: operation.id },
      authorizedAt: timestamp.toISOString(),
      activePlayback: false,
      recoveryEpoch: 0,
    };
    const decision = await db.retentionDecision.create({
      data: {
        mediaId: media.id,
        generation: 1,
        state: "grace_period",
        graceUntil: timestamp,
        evidence,
      },
    });
    f.context.checkpoint = async (phase) => {
      if (phase === "content-proof-ready") f.advance(75_000);
      if (phase === "retention-authority-wait") {
        const refreshed = f.context.now?.();
        if (refreshed === undefined) throw new Error("Fixture clock missing");
        await db.retentionDecision.update({
          where: { id: decision.id },
          data: {
            evidence: { ...evidence, authorizedAt: refreshed.toISOString() },
          },
        });
      }
    };
    const activities = createMediaFileActivities(f.context);
    const input = { operationId: operation.id, decisionId: decision.id };
    expect(await activities.quarantineMediaFiles(input)).toEqual({
      status: "quarantined",
    });
    expect(await activities.purgeMediaFiles(input)).toEqual({
      status: "protected",
      reason: "retention_not_due",
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
