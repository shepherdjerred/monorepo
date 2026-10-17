import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { afterAll, beforeAll, expect, test } from "vitest";
import { rm, readFile, access } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import { z } from "zod";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

test("still-valid 31-second authority does not wait for an unnecessary refresh", async () => {
  const f = await fileFixture(cluster.database);
  try {
    await f.published();
    const retention = await f.retention();
    let waits = 0;
    f.context.checkpoint = async (phase) => {
      if (phase === "content-proof-ready") f.advance(31_000);
      if (phase === "retention-authority-wait" && ++waits > 1)
        throw new Error("Valid authority was unnecessarily deferred");
    };
    expect(
      await createMediaFileActivities(f.context).quarantineMediaFiles(
        retention.input,
      ),
    ).toEqual({ status: "quarantined" });
    expect(waits).toBe(1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test.each([false, true])(
  "retention keeps its content proof while refreshing after long hashing; purge=%s",
  async (purge) => {
    const db = cluster.database;
    const f = await fileFixture(db);
    try {
      const published = await f.published();
      const retention = await f.retention();
      const activities = createMediaFileActivities(f.context);
      if (purge) {
        expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
          status: "quarantined",
        });
        f.advance(8 * 86_400_000);
        const timestamp = f.context.now?.();
        if (timestamp === undefined) throw new Error("Fixture clock missing");
        const evidence = z
          .record(z.string(), z.json())
          .parse(retention.decision.evidence);
        await db.retentionDecision.update({
          where: { id: retention.decision.id },
          data: {
            evidence: { ...evidence, authorizedAt: timestamp.toISOString() },
          },
        });
      }
      let hashed = 0;
      let refreshed = false;
      f.context.checkpoint = async (phase) => {
        if (phase === "content-proof-ready") {
          hashed++;
          f.advance(75_000);
        }
        if (phase === "retention-authority-wait" && !refreshed) {
          refreshed = true;
          const timestamp = f.context.now?.();
          if (timestamp === undefined) throw new Error("Fixture clock missing");
          // This separate transaction represents the network Activity's fresh committed evidence.
          await db.$transaction(async (tx) => {
            const decision = await tx.retentionDecision.findUniqueOrThrow({
              where: { id: retention.decision.id },
            });
            const evidence = z
              .record(z.string(), z.json())
              .parse(decision.evidence);
            await tx.retentionDecision.update({
              where: { id: decision.id },
              data: {
                evidence: {
                  ...evidence,
                  authorizedAt: timestamp.toISOString(),
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
        }
      };
      expect(
        await (purge
          ? activities.purgeMediaFiles(retention.input)
          : activities.quarantineMediaFiles(retention.input)),
      ).toEqual({ status: purge ? "purged" : "quarantined" });
      expect(hashed).toBe(1);
      expect(refreshed).toBe(true);
      const asset = await db.libraryAsset.findUniqueOrThrow({
        where: { id: published.entry.assetId },
      });
      expect(asset.state).toBe(purge ? "purged" : "quarantined");
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  },
);

test.each(["keep", "unwatched", "cancelled"] as const)(
  "fresh observation cannot revive removal after %s changes",
  async (change) => {
    const db = cluster.database;
    const f = await fileFixture(db);
    try {
      const published = await f.published();
      const retention = await f.retention();
      f.context.checkpoint = async (phase) => {
        if (phase !== "content-proof-ready") return;
        f.advance(75_000);
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
        if (change === "unwatched")
          await db.watchState.updateMany({
            where: { mediaId: f.media.id },
            data: { watched: false },
          });
        if (change === "cancelled")
          await db.mediaRequest.updateMany({
            where: { mediaId: f.media.id },
            data: { active: false },
          });
        const timestamp = f.context.now?.();
        if (timestamp === undefined) throw new Error("Fixture clock missing");
        const evidence = z
          .record(z.string(), z.json())
          .parse(retention.decision.evidence);
        await db.retentionDecision.update({
          where: { id: retention.decision.id },
          data: {
            evidence: { ...evidence, authorizedAt: timestamp.toISOString() },
          },
        });
      };
      expect(
        await createMediaFileActivities(f.context).quarantineMediaFiles(
          retention.input,
        ),
      ).toMatchObject({ status: "protected" });
      const asset = await db.libraryAsset.findUniqueOrThrow({
        where: { id: published.entry.assetId },
      });
      await access(asset.path);
      expect(await readFile(asset.path, "utf8")).toBe(published.content);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  },
);

test("explicit owner removal refreshes after long hashing without bypassing quarantine", async () => {
  const db = cluster.database;
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
