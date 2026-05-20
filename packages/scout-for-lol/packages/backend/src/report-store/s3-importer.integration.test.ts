import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import {
  LeaguePuuidSchema,
  RawMatchSchema,
  type DiscordAccountId,
  type LeaguePuuid,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import { importReportStoreFromS3 } from "#src/report-store/s3-importer.ts";

const s3Mock = mockClient(S3Client);
const { prisma } = createTestDatabase("report-store-s3-import-test");
const serverId = testGuildId("778");
const creatorDiscordId = testAccountId("778");

function createMockGetObjectResponse(content: string) {
  return {
    Body: {
      transformToString: () => Promise.resolve(content),
    },
    $metadata: {},
  };
}

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
}

async function createTrackedPlayer(params: {
  alias: string;
  puuid: LeaguePuuid;
  discordId: DiscordAccountId;
}) {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias: params.alias,
      discordId: params.discordId,
      serverId,
      creatorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });

  await prisma.account.create({
    data: {
      alias: params.alias,
      puuid: params.puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function cleanup() {
  await deleteIfExists(() => prisma.reportStoreImportFailure.deleteMany());
  await deleteIfExists(() => prisma.reportStoreImportProgress.deleteMany());
  await deleteIfExists(() => prisma.prematchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.matchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.storedPrematch.deleteMany());
  await deleteIfExists(() => prisma.storedMatchTimeline.deleteMany());
  await deleteIfExists(() => prisma.storedMatch.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
}

beforeEach(async () => {
  s3Mock.reset();
  await cleanup();
});

afterAll(async () => {
  s3Mock.reset();
  await cleanup();
  await prisma.$disconnect();
});

describe("importReportStoreFromS3", () => {
  test("imports matching S3 match objects into SQLite and records resumable progress", async () => {
    const match = await loadMatchFixture();
    const participant = match.info.participants[0];
    expect(participant).toBeDefined();
    if (participant === undefined) {
      throw new Error("fixture has no participants");
    }
    await createTrackedPlayer({
      alias: "Imported Player",
      puuid: LeaguePuuidSchema.parse(participant.puuid),
      discordId: testAccountId("201"),
    });

    const key = "games/2023/11/15/NA1_123/match.json";
    s3Mock.on(ListObjectsV2Command, { Prefix: "games/" }).resolves({
      Contents: [{ Key: key }, { Key: "games/2023/11/15/NA1_123/report.png" }],
      NextContinuationToken: undefined,
    });
    s3Mock.on(ListObjectsV2Command, { Prefix: "prematch/" }).resolves({
      Contents: [],
      NextContinuationToken: undefined,
    });
    s3Mock
      .on(GetObjectCommand, { Key: key })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match)));

    const summary = await importReportStoreFromS3({
      prisma,
      bucket: "test-bucket",
      source: "test-import",
      maxObjects: 10,
    });

    expect(summary.scannedObjects).toBe(2);
    expect(summary.importedObjects).toBe(1);
    expect(summary.skippedObjects).toBe(1);
    expect(summary.failedObjects).toBe(0);
    expect(await prisma.storedMatch.count()).toBe(1);
    expect(await prisma.matchParticipantFact.count()).toBe(1);

    const progress = await prisma.reportStoreImportProgress.findUniqueOrThrow({
      where: { source: "test-import" },
    });
    expect(progress.importStatus).toBe("COMPLETE");
    expect(progress.lastKey).toBe("games/2023/11/15/NA1_123/report.png");
  });

  test("records validation failures without stopping the bounded import", async () => {
    const key = "prematch/2026/05/17/9000000001/spectator-data.json";
    s3Mock.on(ListObjectsV2Command, { Prefix: "games/" }).resolves({
      Contents: [],
      NextContinuationToken: undefined,
    });
    s3Mock.on(ListObjectsV2Command, { Prefix: "prematch/" }).resolves({
      Contents: [{ Key: key }],
      NextContinuationToken: undefined,
    });
    s3Mock
      .on(GetObjectCommand, { Key: key })
      .callsFake(() => createMockGetObjectResponse("{ invalid json"));

    const summary = await importReportStoreFromS3({
      prisma,
      bucket: "test-bucket",
      source: "test-import-failure",
      maxObjects: 10,
    });

    expect(summary.scannedObjects).toBe(1);
    expect(summary.importedObjects).toBe(0);
    expect(summary.failedObjects).toBe(1);
    expect(await prisma.reportStoreImportFailure.count()).toBe(1);

    const failure = await prisma.reportStoreImportFailure.findFirstOrThrow();
    expect(failure.s3Key).toBe(key);
    expect(failure.payloadType).toBe("prematch");
  });

  test("keeps cumulative progress counters when resuming", async () => {
    const source = "test-import-resume-counters";
    await prisma.reportStoreImportProgress.create({
      data: {
        source,
        importStatus: "FAILED",
        lastKey: "games/2026/05/19/NA1_1/match.json",
        scannedObjects: 5,
        importedObjects: 3,
        skippedObjects: 1,
        failedObjects: 1,
        startedAt: new Date("2026-05-19T00:00:00.000Z"),
      },
    });

    const skippedKey = "games/2026/05/19/NA1_2/report.png";
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "games/",
        StartAfter: "games/2026/05/19/NA1_1/match.json",
      })
      .resolves({
        Contents: [{ Key: skippedKey }],
        NextContinuationToken: undefined,
      });

    const summary = await importReportStoreFromS3({
      prisma,
      bucket: "test-bucket",
      source,
      maxObjects: 1,
    });

    expect(summary.scannedObjects).toBe(6);
    expect(summary.importedObjects).toBe(3);
    expect(summary.skippedObjects).toBe(2);
    expect(summary.failedObjects).toBe(1);
    expect(summary.lastKey).toBe(skippedKey);

    const progress = await prisma.reportStoreImportProgress.findUniqueOrThrow({
      where: { source },
    });
    expect(progress.scannedObjects).toBe(6);
    expect(progress.importedObjects).toBe(3);
    expect(progress.skippedObjects).toBe(2);
    expect(progress.failedObjects).toBe(1);
  });
});
