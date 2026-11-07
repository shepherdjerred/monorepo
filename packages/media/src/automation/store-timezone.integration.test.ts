import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createDatabase } from "#infrastructure/database.ts";
import {
  createOutboxActivities,
  queueOperation,
  type WorkflowStart,
} from "./store.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>> | undefined;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
});
afterAll(async () => {
  await cluster?.close();
});

test.each(["America/Los_Angeles", "Asia/Tokyo"])(
  "command defaults dispatch immediately in %s and preserve explicit future scheduling",
  async (timezone) => {
    if (cluster === undefined)
      throw new Error("Disposable command database missing");
    const url = new URL(cluster.url);
    url.searchParams.set("options", `-c timezone=${timezone}`);
    const db = createDatabase(url.toString());
    try {
      expect(
        await db.$queryRaw`SELECT current_setting('TimeZone') AS timezone`,
      ).toEqual([{ timezone }]);
      const torrentId = crypto.randomUUID();
      const startedAt = Date.now();
      const futureAt = new Date(startedAt + 3_600_000);
      const [immediate, future] = await db.$transaction(async (tx) => {
        const command = {
          kind: "maintain_torrent",
          targetId: torrentId,
          payload: { torrentId },
        };
        return [
          await queueOperation(tx, { ...command, key: crypto.randomUUID() }),
          await queueOperation(tx, {
            ...command,
            key: crypto.randomUUID(),
            availableAt: futureAt,
          }),
        ] as const;
      });
      const completedAt = Date.now();
      const born = await db.operation.findUniqueOrThrow({
        where: { id: immediate },
        include: { outbox: true },
      });
      if (born.outbox === null)
        throw new Error("Actual command outbox missing");
      for (const timestamp of [
        born.createdAt,
        born.outbox.createdAt,
        born.outbox.availableAt,
      ]) {
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(timestamp.getTime()).toBeLessThanOrEqual(completedAt);
      }
      const starts: WorkflowStart[] = [];
      const dispatch = createOutboxActivities(db, (input) => {
        starts.push(input);
        return Promise.resolve();
      });
      expect(await dispatch.dispatchMediaOutbox()).toEqual({
        dispatched: 1,
        deferred: 0,
      });
      expect(starts).toEqual([
        {
          workflowType: "maintainMediaTorrentWorkflow",
          workflowId: `media-operation-${immediate}`,
          input: born.payload,
        },
      ]);
      const scheduled = await db.outboxCommand.findUniqueOrThrow({
        where: { operationId: future },
      });
      expect(scheduled.availableAt).toEqual(futureAt);
      expect(scheduled.dispatchedAt).toBeNull();
      // This test owns only these actual commands; the next timezone is independent.
      await db.outboxCommand.deleteMany({
        where: { operationId: { in: [immediate, future] } },
      });
      await db.operation.deleteMany({
        where: { id: { in: [immediate, future] } },
      });
    } finally {
      await db.$disconnect();
    }
  },
);
