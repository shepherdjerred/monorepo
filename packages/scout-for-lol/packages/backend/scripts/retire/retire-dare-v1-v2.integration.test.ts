import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import { purge, verify } from "./retire-dare-v1-v2.ts";

const { prisma } = createTestDatabase("retire-dare-v1-v2-test");

const SERVER = testGuildId("700");
const CHANNEL = testChannelId("701");
const OWNER = testAccountId("702");

async function seedV1Dare(dareState: string) {
  return await prisma.bucksDare.create({
    data: {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: OWNER,
      horizonKind: "next_game",
      conditions: JSON.stringify({ kind: "all", conditions: [] }),
      conditionVersion: 1,
      evaluatorVersion: "dare-evaluator-1",
      originalText: "retired v1 fixture",
      proposalExpiresAt: new Date("2026-09-01T00:00:00Z"),
      dareState,
    },
  });
}

async function seedV2Dare(dareState: string, compilerVersion: string) {
  const dare = await prisma.bucksDareV2.create({
    data: {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: OWNER,
      openingStake: 5,
      dareState,
    },
  });
  await appendV2Revision(
    dare,
    compilerVersion,
    "retired fixture",
    dare.currentRevision,
  );
  return dare;
}

async function appendV2Revision(
  dare: { id: number; currentRevision: number },
  compilerVersion: string,
  originalText: string,
  revision = dare.currentRevision + 1,
) {
  return await prisma.bucksDareV2Revision.create({
    data: {
      dareId: dare.id,
      revision,
      originalText,
      canonicalScoutQl: "SELECT true AS achieved",
      compiledPlan: "{}",
      compilerVersion,
      evaluatorVersion:
        compilerVersion === "dare-scoutql-3"
          ? "dare-evaluator-3"
          : "dare-evaluator-2",
      targetsJson: "[]",
      deadlineSpecJson: "{}",
      openingStake: 5,
      plainLanguage: "retired fixture",
      semanticProofPlan: "{}",
    },
  });
}

beforeEach(async () => {
  await prisma.confirmationIntent.deleteMany({ where: { serverId: SERVER } });
  await prisma.bucksDare.deleteMany({});
  await prisma.bucksDareV2.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("retire-dare-v1-v2", () => {
  test("verify fails while open pre-v3 dares remain and passes once drained", async () => {
    await seedV1Dare("active");
    await seedV2Dare("active", "dare-scoutql-2");
    expect(await verify(prisma)).toBe(false);

    await prisma.bucksDare.updateMany({ data: { dareState: "voided" } });
    await prisma.bucksDareV2.updateMany({ data: { dareState: "voided" } });
    expect(await verify(prisma)).toBe(true);
  });

  test("open v3 dares never block verify", async () => {
    await seedV2Dare("active", "dare-scoutql-3");
    expect(await verify(prisma)).toBe(true);
  });

  test("purge deletes v1 and pre-v3 rows, keeps v3 and non-dare intents", async () => {
    await seedV1Dare("voided");
    const preV3 = await seedV2Dare("achieved", "dare-scoutql-2");
    const v3 = await seedV2Dare("active", "dare-scoutql-3");
    await prisma.confirmationIntent.create({
      data: {
        kind: "dare_fund",
        serverId: SERVER,
        dareId: preV3.id,
        actorDiscordId: OWNER,
        payload: "{}",
        idempotencyKey: "retire-test-dare-intent",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.confirmationIntent.create({
      data: {
        kind: "report_create",
        serverId: SERVER,
        actorDiscordId: OWNER,
        payload: "{}",
        idempotencyKey: "retire-test-report-intent",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await purge(true, prisma, true);

    expect(await prisma.bucksDare.count()).toBe(0);
    expect(await prisma.bucksDareV2.count()).toBe(1);
    expect(await prisma.bucksDareV2.count({ where: { id: v3.id } })).toBe(1);
    expect(
      await prisma.bucksDareV2Revision.count({
        where: { compilerVersion: { not: "dare-scoutql-3" } },
      }),
    ).toBe(0);
    const intents = await prisma.confirmationIntent.findMany({
      where: { serverId: SERVER },
    });
    expect(intents.map((intent) => intent.kind)).toEqual(["report_create"]);
  });

  test("purge refuses to apply without the writes-quiesced interlock", async () => {
    await seedV2Dare("achieved", "dare-scoutql-2");
    await expect(purge(true, prisma)).rejects.toThrow(/writes-quiesced/u);
    expect(await prisma.bucksDareV2.count()).toBe(1);
  });

  test("purge refuses while an open pre-v3 dare remains", async () => {
    await seedV2Dare("active", "dare-scoutql-2");
    await expect(purge(true, prisma, true)).rejects.toThrow(
      /Refusing to purge/u,
    );
    expect(await prisma.bucksDareV2.count()).toBe(1);
  });

  test("an unrecognized dare state fails loudly before openness is judged", async () => {
    await seedV1Dare("corrupted-state");
    await expect(verify(prisma)).rejects.toThrow(/unrecognized state/u);

    await prisma.bucksDare.deleteMany({});
    await seedV2Dare("not-a-state", "dare-scoutql-2");
    await expect(verify(prisma)).rejects.toThrow(/unrecognized state/u);
    await expect(purge(true, prisma, true)).rejects.toThrow(
      /unrecognized state/u,
    );
    expect(await prisma.bucksDareV2.count()).toBe(1);
  });

  test("an unknown superseded compiler version blocks purge", async () => {
    const mixed = await seedV2Dare("active", "dare-scoutql-9");
    await appendV2Revision(mixed, "dare-scoutql-3", "revised into v3");
    await prisma.bucksDareV2.update({
      where: { id: mixed.id },
      data: { currentRevision: mixed.currentRevision + 1 },
    });

    await expect(purge(true, prisma, true)).rejects.toThrow(
      /unrecognized compiler version/u,
    );
    expect(
      await prisma.bucksDareV2Revision.count({ where: { dareId: mixed.id } }),
    ).toBe(2);
  });

  test("an unrecognized compiler version fails loudly instead of retiring", async () => {
    await seedV2Dare("achieved", "dare-scoutql-9");
    await expect(verify(prisma)).rejects.toThrow(
      /unrecognized compiler version/u,
    );
    await expect(purge(true, prisma, true)).rejects.toThrow(
      /unrecognized compiler version/u,
    );
    expect(await prisma.bucksDareV2.count()).toBe(1);
  });

  test("purge removes superseded pre-v3 revisions from retained v3 dares", async () => {
    const mixed = await seedV2Dare("active", "dare-scoutql-2");
    await appendV2Revision(mixed, "dare-scoutql-3", "revised into v3");
    await prisma.confirmationIntent.create({
      data: {
        kind: "dare_fund",
        serverId: SERVER,
        dareId: mixed.id,
        actorDiscordId: OWNER,
        payload: "{}",
        idempotencyKey: "retire-test-stale-revision-intent",
        expiresAt: new Date(Date.now() + 60_000),
        expectedRevision: mixed.currentRevision,
      },
    });
    await prisma.bucksDareV2.update({
      where: { id: mixed.id },
      data: { currentRevision: mixed.currentRevision + 1 },
    });

    await purge(true, prisma, true);

    expect(await prisma.bucksDareV2.count({ where: { id: mixed.id } })).toBe(1);
    expect(
      await prisma.bucksDareV2Revision.count({
        where: { compilerVersion: { not: "dare-scoutql-3" } },
      }),
    ).toBe(0);
    expect(
      await prisma.bucksDareV2Revision.count({ where: { dareId: mixed.id } }),
    ).toBe(1);
    expect(
      await prisma.confirmationIntent.count({ where: { dareId: mixed.id } }),
    ).toBe(0);
  });
});
