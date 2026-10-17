import { expect, test } from "vitest";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { recoveryHarness, releaseInput } from "./test-support.ts";

const { fixture } = recoveryHarness();
async function blocked(db: Database, table: string) {
  const pattern = `%${table}%`;
  await expect
    .poll(
      async () => {
        const rows = z
          .array(z.object({ waiting: z.boolean() }))
          .parse(
            await db.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE ${pattern} AND pid <> pg_backend_pid()) AS waiting`,
          );
        return rows[0]?.waiting;
      },
      { timeout: 2000, interval: 10 },
    )
    .toBe(true);
}

test("an in-flight ordinary Keep completes before waiting recovery release, which rejects its stale household snapshot", async () => {
  const f = await fixture();
  const initial = await f.prepare();
  const review = await f.responses(initial.id);
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const blocker = f.db.$transaction(
    async (tx) => {
      await tx.$executeRaw`LOCK TABLE "RetentionHold" IN ACCESS EXCLUSIVE MODE`;
      locked.resolve(undefined);
      await release.promise;
    },
    { timeout: 10_000 },
  );
  await locked.promise;
  const keep = new PrismaMediaCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture",
  }).act(f.owner, crypto.randomUUID(), f.media.id, {
    action: "keep",
    expectedVersion: 0,
  });
  let applying: Promise<unknown> | undefined;
  try {
    await blocked(f.db, "RetentionHold");
    applying = f.service.release(
      f.owner,
      crypto.randomUUID(),
      initial.id,
      releaseInput(review),
    );
    await blocked(f.db, "MediaItem");
  } finally {
    release.resolve(undefined);
    await blocker;
    await Promise.allSettled([keep, applying]);
  }
  await keep;
  await expect(applying).rejects.toThrow("changed");
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: f.media.id },
    }),
  ).toMatchObject({ releasedAt: null });
  expect(
    await f.db.retentionHold.count({
      where: { userId: f.owner.id, mediaId: f.media.id },
    }),
  ).toBe(1);
});

test("root cancellation is bound even when its media is outside the selected physical leaves", async () => {
  const f = await fixture();
  const rootMedia = await f.db.mediaItem.create({
    data: {
      kind: "series",
      title: "Root",
      intent: { create: { automationEpoch: 3 } },
    },
  });
  const root = await f.db.mediaRequest.create({
    data: {
      userId: f.member.id,
      mediaId: rootMedia.id,
      coverageCompletedAt: new Date(),
    },
  });
  const season = await f.db.mediaItem.create({
    data: {
      kind: "season",
      title: "Season one",
      parentId: rootMedia.id,
      seasonNumber: 1,
    },
  });
  await f.db.mediaItem.update({
    where: { id: f.media.id },
    data: {
      kind: "episode",
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
      externalIds: { plexSectionId: "2" },
    },
  });
  await f.db.requestCoverage.create({
    data: {
      rootRequestId: root.id,
      requestId: f.claim.id,
      mediaId: f.media.id,
      sourceVersion: 0,
    },
  });
  const initial = await f.prepare();
  const review = await f.responses(initial.id);
  expect(review.scope.blockers).toEqual([]);
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const blocker = f.db.$transaction(
    async (tx) => {
      await tx.$executeRaw`LOCK TABLE "MediaIntent" IN ACCESS EXCLUSIVE MODE`;
      locked.resolve(undefined);
      await release.promise;
    },
    { timeout: 10_000 },
  );
  await locked.promise;
  const cancellation = new PrismaMediaCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture",
  }).cancelRequest(f.member, crypto.randomUUID(), root.id, 0);
  let applying: Promise<unknown> | undefined;
  try {
    await blocked(f.db, "MediaIntent");
    applying = f.service.release(
      f.owner,
      crypto.randomUUID(),
      initial.id,
      releaseInput(review),
    );
    await blocked(f.db, "MediaRequest");
  } finally {
    release.resolve(undefined);
    await blocker;
    await Promise.allSettled([cancellation, applying]);
  }
  await cancellation;
  await expect(applying).rejects.toThrow("changed");
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: f.media.id },
    }),
  ).toMatchObject({ releasedAt: null });
});
