import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  enqueueChampionMasteryRefresh,
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
      id: "champion-mastery:NA1_1",
      kind: "champion-mastery-refresh" as const,
      payload: "{}",
    };

    await expect(persistScoutTemporalWork(work, prisma)).resolves.toBe(true);
    await expect(persistScoutTemporalWork(work, prisma)).resolves.toBe(false);
    await expect(prisma.scoutTemporalWork.count()).resolves.toBe(1);
  });

  test("persists a champion-mastery refresh without serializing its cache timestamp", async () => {
    const puuid = "a".repeat(78);
    await enqueueChampionMasteryRefresh(
      {
        puuid: LeaguePuuidSchema.parse(puuid),
        region: "AMERICA_NORTH",
        fetchedAt: new Date("2026-09-20T00:00:00Z"),
      },
      prisma,
    );

    await expect(
      prisma.scoutTemporalWork.findUniqueOrThrow({
        where: {
          id: `champion-mastery:${puuid}:1789862400000`,
        },
      }),
    ).resolves.toMatchObject({
      kind: "champion-mastery-refresh",
      payload: `{"puuid":"${puuid}","region":"AMERICA_NORTH"}`,
    });
  });

  test("requeues a failed champion-mastery refresh on a later page visit", async () => {
    const puuid = "b".repeat(78);
    const fetchedAt = new Date("2026-09-20T00:00:00Z");
    await prisma.scoutTemporalWork.create({
      data: {
        id: `champion-mastery:${puuid}:1789862400000`,
        kind: "champion-mastery-refresh",
        payload: JSON.stringify({ puuid, region: "AMERICA_NORTH" }),
        state: "failed",
        failedAt: new Date("2026-09-20T01:00:00Z"),
        lastError: "Riot API HTTP 503 (Service Unavailable)",
      },
    });

    await enqueueChampionMasteryRefresh(
      { puuid: LeaguePuuidSchema.parse(puuid), region: "EU_WEST", fetchedAt },
      prisma,
    );

    await expect(
      prisma.scoutTemporalWork.findUniqueOrThrow({
        where: { id: `champion-mastery:${puuid}:1789862400000` },
      }),
    ).resolves.toMatchObject({
      state: "queued",
      requeueCount: 1,
      payload: JSON.stringify({ puuid, region: "EU_WEST" }),
      lastRequeueReason:
        "Champion mastery refresh retried after a later page visit",
    });
  });

  test("atomically requeues only failed work with an operator reason", async () => {
    await prisma.scoutTemporalWork.create({
      data: {
        id: "champion-mastery:NA1_2",
        kind: "champion-mastery-refresh",
        payload: "{}",
        state: "failed",
        failedAt: new Date("2026-08-30T00:00:00Z"),
        lastError: "weekly quota exceeded",
      },
    });

    await requeueFailedScoutTemporalWork(
      "champion-mastery:NA1_2",
      "OpenAI capacity restored by operator",
      prisma,
    );
    await expect(
      prisma.scoutTemporalWork.findUniqueOrThrow({
        where: { id: "champion-mastery:NA1_2" },
      }),
    ).resolves.toMatchObject({
      state: "queued",
      requeueCount: 1,
      lastRequeueReason: "OpenAI capacity restored by operator",
    });

    await expect(
      requeueFailedScoutTemporalWork(
        "champion-mastery:NA1_2",
        "Duplicate operator requeue is forbidden",
        prisma,
      ),
    ).rejects.toThrow("is missing or is not in failed state");
  });

  test("reconciliation ignores terminal failed work", async () => {
    await prisma.scoutTemporalWork.createMany({
      data: [
        {
          id: "champion-mastery:failed",
          kind: "champion-mastery-refresh",
          payload: "{}",
          state: "failed",
          failedAt: new Date("2026-08-30T00:00:00Z"),
        },
        {
          id: "champion-mastery:queued",
          kind: "champion-mastery-refresh",
          payload: "{}",
        },
      ],
    });

    await expect(findQueuedScoutTemporalWork(prisma)).resolves.toEqual([
      { id: "champion-mastery:queued", kind: "champion-mastery-refresh" },
    ]);
  });

  test("terminalizes all incident-shaped queued rows", async () => {
    const startedAt = new Date("2026-08-29T22:47:35Z");
    await prisma.scoutTemporalWork.createMany({
      data: Array.from({ length: 42 }, (_, index) => ({
        id: `champion-mastery:incident-${index.toString()}`,
        kind: "champion-mastery-refresh",
        payload: "{}",
        state: "queued",
        startedAt,
        lastError: "OpenAI quota exceeded",
      })),
    });
    await prisma.scoutTemporalWork.create({
      data: {
        id: "champion-mastery:unaccepted-handoff",
        kind: "champion-mastery-refresh",
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
