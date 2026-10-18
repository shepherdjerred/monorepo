import { expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { capacityRows } from "./test-support.ts";

test("018 preserves populated state and rejects incomplete/invalid observational rows", async () => {
  const cluster = await startMediaTestPostgres({
    migrationCeiling: "20261017001700_default_edition_scope",
  });
  const db = cluster.database;
  try {
    const actor = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Existing owner",
        role: "owner",
      },
    });
    const runtime = await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "observe", recoveryEpoch: 7, version: 9 },
    });
    const operation = await db.operation.create({
      data: {
        kind: "restore_observe",
        userId: actor.id,
        idempotencyKey: crypto.randomUUID(),
        payload: { historical: "unchanged" },
        status: "completed",
      },
    });
    cluster.applyMigration("20261017001800_capacity_observation");
    expect(await db.mediaCapacityObservation.count()).toBe(0);
    expect(
      await db.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      }),
    ).toEqual(runtime);
    expect(
      await db.operation.findUniqueOrThrow({ where: { id: operation.id } }),
    ).toEqual(operation);
    await expect(
      db.$executeRaw`INSERT INTO "MediaCapacityObservation" (role,"cycleEpoch","cycleStartedAt") VALUES ('other',7,NOW())`,
    ).rejects.toThrow();
    const rows = await capacityRows(Date.now(), 7);
    await db.mediaCapacityObservation.createMany({ data: rows });
    for (const column of [
      "sampleObservedAt",
      "sampleStartedAt",
      "sampleCompletedAt",
      "sampleResultAttempt",
      "sampleEpoch",
      "sampleBinding",
      "totalBytes",
      "availableBytes",
    ] as const) {
      await expect(
        db.mediaCapacityObservation.update({
          where: { role: "movies" },
          data: { [column]: null },
        }),
      ).rejects.toThrow();
    }
    await expect(
      db.mediaCapacityObservation.update({
        where: { role: "movies" },
        data: { availableBytes: -1n },
      }),
    ).rejects.toThrow();
    await expect(
      db.mediaCapacityObservation.update({
        where: { role: "movies" },
        data: { availableBytes: 9_007_199_254_740_994n },
      }),
    ).rejects.toThrow();
    await expect(
      db.mediaCapacityObservation.update({
        where: { role: "movies" },
        data: { mountObservedAt: null },
      }),
    ).rejects.toThrow();
    await expect(
      db.mediaCapacityObservation.update({
        where: { role: "movies" },
        data: { mountOutcome: "invented" },
      }),
    ).rejects.toThrow();
    expect(await db.mediaCapacityObservation.count()).toBe(2);
  } finally {
    await cluster.close();
  }
});
