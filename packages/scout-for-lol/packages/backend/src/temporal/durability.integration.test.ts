import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  completeScoutEffectWithResult,
  requireCompletedScoutEffectResult,
} from "#src/temporal/effect-claims.ts";
import {
  durableExploreQuotaRejection,
  reserveDurableExploreRun,
  reserveDurableReportAiRun,
} from "#src/temporal/durable-quota.ts";
import {
  persistScoutInteractiveOutcome,
  runScoutInteractiveActivity,
} from "#src/temporal/interactive-activities.ts";

const { prisma } = createTestDatabase("temporal-durability");

beforeEach(async () => {
  await prisma.scoutEffectClaim.deleteMany();
  await prisma.scoutInteractiveRun.deleteMany();
});

afterAll(async () => {
  await prisma.scoutEffectClaim.deleteMany();
  await prisma.scoutInteractiveRun.deleteMany();
  await prisma.$disconnect();
});

describe("durable interactive reservations", () => {
  test("serializes the global Explore cap across concurrent requests", async () => {
    const attempts = await Promise.all(
      Array.from(
        { length: 6 },
        async (_, index) =>
          await reserveDurableExploreRun({
            id: globalThis.crypto.randomUUID(),
            ownerId: DiscordAccountIdSchema.parse(
              (9_000_000_000_000_000_000n + BigInt(index)).toString(),
            ),
            conversationId: globalThis.crypto.randomUUID(),
            payload: "{}",
            now: Date.parse("2026-08-24T12:00:00.000Z"),
            database: prisma,
          }),
      ),
    );

    expect(attempts.filter((result) => result === null)).toHaveLength(5);
    expect(attempts.filter((result) => result !== null)).toHaveLength(1);
    expect(await prisma.scoutInteractiveRun.count()).toBe(5);
  });

  test("allows only one active report edit per user and guild", async () => {
    const identity = {
      userId: DiscordAccountIdSchema.parse("900000000000000101"),
      guildId: DiscordGuildIdSchema.parse("900000000000000102"),
    };
    const attempts = await Promise.all(
      [0, 1].map(
        async () =>
          await reserveDurableReportAiRun({
            id: globalThis.crypto.randomUUID(),
            identity,
            exempt: false,
            payload: "{}",
            now: Date.parse("2026-08-24T12:00:00.000Z"),
            database: prisma,
          }),
      ),
    );

    expect(attempts.filter((result) => result === null)).toHaveLength(1);
    expect(attempts.filter((result) => result !== null)).toHaveLength(1);
  });

  test("releases spend quota when execution fails before the provider claim", async () => {
    const ownerId = DiscordAccountIdSchema.parse("900000000000000111");
    const now = Date.parse("2026-08-24T12:00:00.000Z");
    for (const index of [0, 1, 2, 3, 4]) {
      const id = globalThis.crypto.randomUUID();
      await expect(
        reserveDurableExploreRun({
          id,
          ownerId,
          conversationId: globalThis.crypto.randomUUID(),
          payload: "{}",
          now,
          database: prisma,
        }),
      ).resolves.toBeNull();
      await prisma.scoutInteractiveRun.update({
        where: { id },
        data: { state: "FAILED", completedAt: new Date(now + index) },
      });
    }

    await expect(
      durableExploreQuotaRejection(ownerId, now, prisma),
    ).resolves.toBeNull();
  });

  test("charges spend quota after the provider claim even when execution interrupts", async () => {
    const ownerId = DiscordAccountIdSchema.parse("900000000000000112");
    const now = Date.parse("2026-08-24T12:00:00.000Z");
    for (const index of [0, 1, 2, 3]) {
      await prisma.scoutInteractiveRun.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          kind: "explore",
          ownerId,
          conversationId: globalThis.crypto.randomUUID(),
          payload: "{}",
          state: "INTERRUPTED",
          providerAttemptAt: new Date(now + index),
          completedAt: new Date(now + index),
          createdAt: new Date(now + index),
        },
      });
    }

    await expect(
      durableExploreQuotaRejection(ownerId, now + 4, prisma),
    ).resolves.toMatchObject({ retryAfterSeconds: 60 });
  });

  test("interrupts an ambiguous provider attempt without opening a runtime", async () => {
    const runId = globalThis.crypto.randomUUID();
    await prisma.scoutInteractiveRun.create({
      data: {
        id: runId,
        kind: "report-ai",
        ownerId: DiscordAccountIdSchema.parse("900000000000000201"),
        guildId: DiscordGuildIdSchema.parse("900000000000000202"),
        payload: "{}",
        state: "RUNNING",
        providerAttemptAt: new Date(),
        partialOutput: "SELECT player",
      },
    });

    const outcome = await runScoutInteractiveActivity(
      { stage: "dev", kind: "report-ai", databaseRunId: runId },
      prisma,
    );
    expect(outcome).toEqual({
      status: "interrupted",
      partialOutputAvailable: true,
    });
    await persistScoutInteractiveOutcome(
      { stage: "dev", kind: "report-ai", databaseRunId: runId, outcome },
      prisma,
    );
    expect(
      await prisma.scoutInteractiveRun.findUniqueOrThrow({
        where: { id: runId },
        select: { state: true, providerAttemptAt: true },
      }),
    ).toMatchObject({ state: "INTERRUPTED" });
  });

  test("honors a persisted stop before claiming provider spend", async () => {
    const runId = globalThis.crypto.randomUUID();
    await prisma.scoutInteractiveRun.create({
      data: {
        id: runId,
        kind: "report-ai",
        ownerId: DiscordAccountIdSchema.parse("900000000000000301"),
        guildId: DiscordGuildIdSchema.parse("900000000000000302"),
        payload: "{}",
        stopRequestedAt: new Date(),
      },
    });

    await expect(
      runScoutInteractiveActivity(
        { stage: "dev", kind: "report-ai", databaseRunId: runId },
        prisma,
      ),
    ).resolves.toEqual({
      status: "cancelled",
      partialOutputAvailable: false,
    });
    expect(
      await prisma.scoutInteractiveRun.findUniqueOrThrow({
        where: { id: runId },
        select: { providerAttemptAt: true },
      }),
    ).toEqual({ providerAttemptAt: null });
  });
});

test("effect claims survive an ambiguous retry and become terminal", async () => {
  expect(
    await claimScoutEffect(
      { key: "report:42:chunk:0", kind: "report-discord" },
      prisma,
    ),
  ).toBe("execute");
  expect(
    await claimScoutEffect(
      { key: "report:42:chunk:0", kind: "report-discord" },
      prisma,
    ),
  ).toBe("execute");
  await completeScoutEffect("report:42:chunk:0", prisma);
  expect(
    await claimScoutEffect(
      { key: "report:42:chunk:0", kind: "report-discord" },
      prisma,
    ),
  ).toBe("completed");
});

test("effect claims retain a provider result for retry projection", async () => {
  await claimScoutEffect(
    { key: "postmatch:42:channel:7", kind: "discord-channel-message" },
    prisma,
  );
  await completeScoutEffectWithResult(
    "postmatch:42:channel:7",
    "discord-message-99",
    prisma,
  );
  await expect(
    requireCompletedScoutEffectResult("postmatch:42:channel:7", prisma),
  ).resolves.toBe("discord-message-99");
});
