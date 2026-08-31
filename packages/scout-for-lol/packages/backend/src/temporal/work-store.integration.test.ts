import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  findQueuedScoutTemporalWork,
  persistScoutTemporalWork,
  requeueFailedScoutTemporalWork,
} from "./work-store.ts";

const { prisma } = createTestDatabase("temporal-work-store");

beforeEach(async () => {
  await prisma.scoutTemporalWork.deleteMany();
});

afterAll(async () => {
  await prisma.scoutTemporalWork.deleteMany();
  await prisma.$disconnect();
});

describe("Scout Temporal work ownership", () => {
  test("reports only the first durable insertion as newly created", async () => {
    const work = {
      id: "parlay:NA1_1",
      kind: "parlay-generation" as const,
      payload: "{}",
    };

    await expect(persistScoutTemporalWork(work, prisma)).resolves.toBe(true);
    await expect(persistScoutTemporalWork(work, prisma)).resolves.toBe(false);
    await expect(prisma.scoutTemporalWork.count()).resolves.toBe(1);
  });

  test("atomically requeues only failed work with an operator reason", async () => {
    await prisma.scoutTemporalWork.create({
      data: {
        id: "parlay:NA1_2",
        kind: "parlay-generation",
        payload: "{}",
        state: "failed",
        failedAt: new Date("2026-08-30T00:00:00Z"),
        lastError: "weekly quota exceeded",
      },
    });

    await requeueFailedScoutTemporalWork(
      "parlay:NA1_2",
      "OpenRouter capacity restored by operator",
      prisma,
    );
    await expect(
      prisma.scoutTemporalWork.findUniqueOrThrow({
        where: { id: "parlay:NA1_2" },
      }),
    ).resolves.toMatchObject({
      state: "queued",
      requeueCount: 1,
      lastRequeueReason: "OpenRouter capacity restored by operator",
    });

    await expect(
      requeueFailedScoutTemporalWork(
        "parlay:NA1_2",
        "Duplicate operator requeue is forbidden",
        prisma,
      ),
    ).rejects.toThrow("is missing or is not in failed state");
  });

  test("reconciliation ignores terminal failed work", async () => {
    await prisma.scoutTemporalWork.createMany({
      data: [
        {
          id: "parlay:failed",
          kind: "parlay-generation",
          payload: "{}",
          state: "failed",
          failedAt: new Date("2026-08-30T00:00:00Z"),
        },
        {
          id: "parlay:queued",
          kind: "parlay-generation",
          payload: "{}",
        },
      ],
    });

    await expect(findQueuedScoutTemporalWork(prisma)).resolves.toEqual([
      { id: "parlay:queued", kind: "parlay-generation" },
    ]);
  });

  test("terminalizes all incident-shaped queued rows", async () => {
    const startedAt = new Date("2026-08-29T22:47:35Z");
    await prisma.scoutTemporalWork.createMany({
      data: Array.from({ length: 42 }, (_, index) => ({
        id: `parlay:incident-${index.toString()}`,
        kind: "parlay-generation",
        payload: "{}",
        state: "queued",
        startedAt,
        lastError: "OpenRouter weekly key limit exceeded",
      })),
    });
    await prisma.scoutTemporalWork.create({
      data: {
        id: "parlay:unaccepted-handoff",
        kind: "parlay-generation",
        payload: "{}",
      },
    });

    await prisma.$executeRaw`
      UPDATE "ScoutTemporalWork"
      SET "state" = 'failed', "failedAt" = "updatedAt"
      WHERE "state" = 'queued'
        AND "startedAt" IS NOT NULL
        AND "lastError" IS NOT NULL
    `;

    await expect(
      prisma.scoutTemporalWork.count({ where: { state: "failed" } }),
    ).resolves.toBe(42);
    await expect(
      prisma.scoutTemporalWork.count({ where: { state: "queued" } }),
    ).resolves.toBe(1);
  });
});
