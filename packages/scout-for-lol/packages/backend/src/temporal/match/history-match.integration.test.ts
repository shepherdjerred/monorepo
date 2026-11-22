import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  CanonicalMatchRecordSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client/scout-client-device.ts";
import type { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";

/**
 * An ARAM: Mayhem game the Scout Client never saw end, known only from the
 * history bundle it uploaded later, through history recovery against real
 * rows. Everything but Riot, the S3 transport and the report renderer is
 * real: the admission, the selection row, the archive and its receipts, the
 * observation and the lake staging files.
 */

const { prisma } = createTestDatabase("scout-history-match-record");
const io = vi.hoisted(() => ({
  fetchMatch: vi.fn<typeof fetchMatchData>(),
  objects: new Map<string, string>(),
  lakeDir: "",
  render: vi.fn(async () => "rendered"),
}));
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/evidence/recovery-gate.ts", () => ({
  evidenceRecoveryEnabled: () => true,
}));
vi.mock("#src/scout-client/access/policy.ts", async (original) => ({
  ...(await original()),
  isScoutClientLive: async () => true,
  isScoutClientEvidenceLive: async () => true,
}));
vi.mock("#src/configuration.ts", async (original) => {
  const actual = await original<{ default: object }>();
  return {
    ...actual,
    default: { ...actual.default, s3BucketName: "history-record-fixture" },
  };
});
vi.mock("#src/report-lake/paths.ts", async (original) => ({
  ...(await original()),
  resolveLakeDir: () => io.lakeDir,
}));
vi.mock("#src/storage/s3-helpers.ts", async (original) => ({
  ...(await original()),
  saveToS3: async (config: {
    matchId: RiotMatchId;
    assetType: string;
    extension: string;
    body: string;
    contentType: string;
  }) => {
    const body = config.body;
    const key = `games/${config.matchId}/${config.assetType}.${config.extension}`;
    io.objects.set(key, body);
    return {
      key,
      digest: new Bun.CryptoHasher("sha256").update(body).digest("hex"),
      bytes: new TextEncoder().encode(body).byteLength,
      contentType: config.contentType,
      capturedAt: new Date().toISOString(),
      url: `s3://history-record-fixture/${key}`,
    };
  },
}));
vi.mock("#src/report-store/s3-raw-source.ts", async (original) => ({
  ...(await original()),
  readVerifiedRawObjectText: async (args: { key: string }) => {
    const body = io.objects.get(args.key);
    if (body === undefined) throw new Error(`No object at ${args.key}`);
    return body;
  },
}));
vi.mock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ destroy: vi.fn() }),
}));
vi.mock("@temporalio/activity", async (original) => ({
  ...(await original()),
  Context: { current: () => ({ heartbeat: vi.fn() }) },
}));
vi.mock("#src/league/tasks/postmatch/match-data-fetcher.ts", () => ({
  fetchMatchData: io.fetchMatch,
  fetchMatchTimeline: vi.fn(),
}));
vi.mock("#src/discord/utils/guild-membership.ts", () => ({
  getActiveServerIds: vi.fn(),
}));
vi.mock("#src/temporal/notification-lane/notification-render.ts", () => ({
  renderMatchNotificationArtifact: io.render,
}));

const { reconcileMatchHistory } = await import("./history-recovery.ts");
const { admitMatchEvidence } = await import("#src/evidence/admission.ts");
const { resolveCanonicalMatch } = await import("#src/evidence/matches.ts");
const { stageLakeProjection } = await import("../lake/lake-projection.ts");
const { listStagingFiles } = await import("#src/report-lake/staging.ts");
const { aliasedLcuBundle, lcuBundleMatchId } =
  await import("#src/testing/report-lake/lcu-bundle-fixtures.ts");

const owner = DiscordAccountIdSchema.parse("160509172704739328");
const guild = DiscordGuildIdSchema.parse("1337623164146155593");
const MINUTE = 60_000;
/** The measured default (`DEFAULT_SCOUT_CLIENT_END_OF_GAME_DEADLINE_SECONDS`). */
const DEADLINE_MS = 360_000;

const witnessed = await aliasedLcuBundle("lcu-postgame-aram-mayhem");
const matchId = lcuBundleMatchId(witnessed);
const gameId = matchId.slice(matchId.indexOf("_") + 1);
/** What a client that did not see the game end uploads: history and timeline. */
const history = {
  matchHistory: witnessed.matchHistory,
  timeline: witnessed.timeline,
};
const ObserverSchema = z.object({
  participantIdentities: z
    .array(z.object({ player: z.object({ puuid: z.string() }) }).loose())
    .min(1),
});
const observer = LeaguePuuidSchema.parse(
  ObserverSchema.parse(witnessed.matchHistory).participantIdentities[0]?.player
    .puuid,
);
const StoredPayloadSchema = z.object({ resource: z.string(), data: z.json() });

let deviceId: string;
let sequence = 0;

async function upload(data: unknown, receivedAt: Date): Promise<string> {
  sequence += 1;
  const observationId = crypto.randomUUID();
  await prisma.scoutClientObservation.create({
    data: {
      observationId,
      deviceId,
      sequence: BigInt(sequence),
      capturedAt: receivedAt,
      receivedAt,
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: "post_game",
      localPuuid: observer,
      platformId: "NA1",
      gameId,
      payload: StoredPayloadSchema.parse({
        resource: `match_history_game:${gameId}`,
        data,
      }),
      bodyDigest: `digest-${observationId}`,
      disposition: "ACCEPTED",
    },
  });
  return observationId;
}

async function admit(historical: boolean) {
  await admitMatchEvidence({
    matchId,
    // A live admission is made at the game's completion.
    completedAt: historical ? null : Date.now() - 2 * MINUTE,
    historical,
  });
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: matchId },
    data: { recoveryNextAttemptAt: new Date(0) },
  });
}

const pastDeadline = () => new Date(Date.now() - DEADLINE_MS - MINUTE);

function archivedRecord() {
  const [body] = [...io.objects.entries()]
    .filter(([key]) => key.endsWith("/match.json"))
    .map(([, value]) => value);
  if (body === undefined) throw new Error("Nothing was archived");
  return CanonicalMatchRecordSchema.parse(JSON.parse(body));
}

beforeAll(async () => {
  io.lakeDir = await mkdtemp(path.join(tmpdir(), "history-record-lake-"));
});
beforeEach(async () => {
  io.fetchMatch.mockReset();
  // Riot never publishes ARAM: Mayhem.
  io.fetchMatch.mockResolvedValue(undefined);
  io.objects.clear();
  io.render.mockClear();
  sequence = 0;
  await rm(io.lakeDir, { recursive: true, force: true });
  await prisma.$transaction([
    prisma.matchNotificationIntent.deleteMany(),
    prisma.matchReportSnapshot.deleteMany(),
    prisma.matchResultEvidence.deleteMany(),
    prisma.matchTrackedAccount.deleteMany(),
    prisma.matchProcessingReceipt.deleteMany(),
    prisma.matchObservation.deleteMany(),
    prisma.matchEvidenceAdmission.deleteMany(),
    prisma.scoutClientCanonicalMatch.deleteMany(),
    prisma.scoutClientObservation.deleteMany(),
    prisma.scoutClientDevice.deleteMany(),
    prisma.scoutClientPairing.deleteMany(),
    prisma.account.deleteMany(),
    prisma.player.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  const now = new Date();
  await prisma.player.create({
    data: {
      alias: "Mayhem Scout",
      discordId: owner,
      serverId: guild,
      creatorDiscordId: owner,
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: {
          alias: "Mayhem Scout",
          puuid: observer,
          region: "AMERICA_NORTH",
          serverId: guild,
          creatorDiscordId: owner,
          createdTime: now,
          updatedTime: now,
        },
      },
    },
  });
  deviceId = await createTestScoutClientDevice(prisma, owner);
});
afterAll(async () => {
  await rm(io.lakeDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("an unwitnessed ARAM Mayhem game from its history bundle", () => {
  test("is recorded history-only: archived, observed silently and in the lake, with no report", async () => {
    const observationId = await upload(history, pastDeadline());
    await admit(true);

    await reconcileMatchHistory();

    expect(archivedRecord().coverage).toBe("history");
    expect(
      await prisma.scoutClientCanonicalMatch.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({ sourceObservationId: observationId });
    expect(
      await prisma.matchObservation.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({
      processingPolicy: "HISTORY_ONLY",
      deliveryMode: "silent-backfill",
      matchDataSource: "SCOUT_CLIENT",
    });
    expect(
      await prisma.matchEvidenceAdmission.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({
      policy: "HISTORY_ONLY",
      historyReportComplete: true,
      recoveryAbandonedReason: "history_record",
    });
    // No report, no post, no notification.
    expect(io.render).not.toHaveBeenCalled();
    expect(await prisma.matchNotificationIntent.count()).toBe(0);

    await stageLakeProjection({ riotMatchId: matchId });
    const files = await listStagingFiles(io.lakeDir, "matches");
    const texts = await Promise.all(
      files.map(async (file) => await Bun.file(file).text()),
    );
    const rows = texts
      .flatMap((text) => text.split("\n"))
      .filter((line) => line.trim().length > 0)
      .map((line) =>
        z
          .looseObject({ coverage: z.string(), time_played: z.unknown() })
          .parse(JSON.parse(line)),
      );
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((row) => row.coverage))).toEqual(
      new Set(["history"]),
    );
    expect(rows.every((row) => row.time_played === null)).toBe(true);
  });

  test("waits its deadline, so a witnessed record can take precedence", async () => {
    await upload(history, new Date());
    await admit(true);

    const resolved = await resolveCanonicalMatch(matchId);
    expect(resolved.kind).toBe("pending");
    await reconcileMatchHistory();
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);
    expect(io.objects.size).toBe(0);
  });

  test("a witnessed bundle for the same game wins over the history copy", async () => {
    const uploadedAt = pastDeadline();
    await upload(history, uploadedAt);
    const bundle = await upload(witnessed, uploadedAt);
    await admit(true);

    const resolved = await resolveCanonicalMatch(matchId);

    expect(resolved).toMatchObject({ kind: "available", coverage: "complete" });
    expect(
      await prisma.scoutClientCanonicalMatch.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({ sourceObservationId: bundle });
  });

  test("is never the record of a game admitted for live processing", async () => {
    await upload(history, pastDeadline());
    await admit(false);

    const resolved = await resolveCanonicalMatch(matchId);
    expect(resolved.kind).toBe("unavailable");
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);
  });

  test("a game abandoned before the record existed is reopened by the migration", async () => {
    await upload(history, pastDeadline());
    await admit(true);
    await prisma.matchEvidenceAdmission.update({
      where: { riotMatchId: matchId },
      data: {
        recoveryAbandonedAt: new Date(),
        recoveryAbandonedReason: "riot_match_forbidden",
        recoveryNextAttemptAt: new Date(Date.now() + 60 * MINUTE),
      },
    });
    await reconcileMatchHistory();
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);

    await prisma.$executeRawUnsafe(
      await Bun.file(
        new URL(
          "../../../prisma/migrations/20261122020000_scout_client_history_record_reopen/migration.sql",
          import.meta.url,
        ),
      ).text(),
    );
    await reconcileMatchHistory();

    expect(archivedRecord().coverage).toBe("history");
  });
});

async function abandonedLive() {
  await admit(false);
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: matchId },
    data: {
      recoveryAbandonedAt: new Date(),
      recoveryAbandonedReason: "riot_match_forbidden",
      recoveryNextAttemptAt: new Date(Date.now() + 60 * MINUTE),
    },
  });
}

async function migrate() {
  await prisma.$executeRawUnsafe(
    await Bun.file(
      new URL(
        "../../../prisma/migrations/20261122030000_scout_client_witnessed_unrecorded_history_only/migration.sql",
        import.meta.url,
      ),
    ).text(),
  );
}

describe("a witnessed Mayhem game live processing could not record", () => {
  test("is recorded silently from its bundle, never posted as live", async () => {
    const bundle = await upload(witnessed, pastDeadline());
    await abandonedLive();

    await migrate();
    await reconcileMatchHistory();

    expect(archivedRecord().coverage).toBe("complete");
    expect(
      await prisma.scoutClientCanonicalMatch.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({ sourceObservationId: bundle });
    expect(
      await prisma.matchEvidenceAdmission.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({ policy: "HISTORY_ONLY", reason: "late-discovery" });
    expect(
      await prisma.matchObservation.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({
      processingPolicy: "HISTORY_ONLY",
      deliveryMode: "silent-backfill",
      matchDataSource: "SCOUT_CLIENT",
    });
    expect(await prisma.matchNotificationIntent.count()).toBe(0);
  });

  test("a live game without client evidence keeps its decision", async () => {
    await abandonedLive();

    await migrate();

    expect(
      await prisma.matchEvidenceAdmission.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({
      policy: "FULL",
      recoveryAbandonedReason: "riot_match_forbidden",
    });
  });
});
