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
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import {
  CanonicalMatchRecordSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { SCOUT_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import { makeRiotTransportFailure } from "#src/testing/riot-mocks.ts";
import type { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

/**
 * An end-of-game-only game through the per-match core, against real rows.
 *
 * `scoutMatchProcessingWorkflow` changes no command for this: the dispatcher
 * starts it at the item's `readyAt`, the end-of-game deadline, and every
 * Activity resolves the game's canonical match itself. So the Activities run
 * here in the Workflow's own order, and everything but Riot, the S3 transport
 * and Discord is real: the selection row, the archive and its receipts, the
 * observation, the stage receipts, the intents and the lake staging files.
 */

const { prisma } = createTestDatabase("scout-end-of-game-match-pipeline");
const io = vi.hoisted(() => ({
  fetchMatch: vi.fn<typeof fetchMatchData>(),
  objects: new Map<string, string>(),
  lakeDir: "",
  render: vi.fn(async () => "rendered"),
}));
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: () => false,
}));
vi.mock("#src/evidence/recovery-gate.ts", () => ({
  evidenceRecoveryEnabled: () => true,
}));
vi.mock("#src/configuration.ts", async (original) => {
  const actual = await original<{ default: object }>();
  return {
    ...actual,
    default: { ...actual.default, s3BucketName: "end-of-game-fixture" },
  };
});
vi.mock("#src/report-lake/paths.ts", async (original) => ({
  ...(await original()),
  resolveLakeDir: () => io.lakeDir,
}));
// The S3 transport: content-addressed puts into a map, verified reads back.
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
      url: `s3://end-of-game-fixture/${key}`,
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
// The doubles above stand in for every S3 call; no real client is built.
vi.mock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ destroy: vi.fn() }),
}));
// `stageLakeProjection` heartbeats; outside a worker there is no Context.
vi.mock("@temporalio/activity", async (original) => ({
  ...(await original()),
  Context: { current: () => ({ heartbeat: vi.fn() }) },
}));
vi.mock("#src/league/tasks/postmatch/match-data-fetcher.ts", () => ({
  fetchMatchData: io.fetchMatch,
  // An end-of-game record never asks; a complete match finds none from Riot.
  fetchMatchTimeline: vi.fn(),
}));
vi.mock("#src/discord/utils/guild-membership.ts", () => ({
  // No gateway: the roster is every registered account.
  getActiveServerIds: vi.fn(),
}));
vi.mock("#src/league/tasks/notification-filters.ts", () => ({
  resolvePostmatchDeliveryChannels: async () => ({
    deliverable: [{ channel: "1337623164146155594" }],
    guildIds: [],
    subscribed: [],
  }),
}));
vi.mock("#src/temporal/notification-lane/notification-render.ts", () => ({
  renderMatchNotificationArtifact: io.render,
}));

const { archiveMatchArtifacts, commitMatchObservation } =
  await import("./match-archive.ts");
const { prepareMatchEvidence } = await import("./match-evidence.ts");
const {
  settleMatchDares,
  applyMatchProgression,
  mintPostmatchNotificationIntents,
} = await import("./match-effects.ts");
const { finalizeTournamentResult } = await import("./match-tournament.ts");
const { recordMatchReceipts, advanceMatchCursor } =
  await import("./match-commits.ts");
const { planMatchFanOut } = await import("./match-reads.ts");
const { stageLakeProjection } = await import("../lake/lake-projection.ts");
const { reconcileScoreboardReport } = await import("./scoreboard-recovery.ts");
const { admitMatchEvidence } = await import("#src/evidence/admission.ts");
const { gameResultFromMatch } =
  await import("#src/scout-client/canonical/riot-result.ts");
const { listStagingFiles } = await import("#src/report-lake/staging.ts");
const { classicEndOfGameMatch, classicMatchId } =
  await import("#src/testing/scout-client/end-of-game-fixtures.ts");
const {
  END_OF_GAME_DEADLINE_MS,
  asRanked,
  endOfGameUploads,
  observerOf,
  rankedGameflow,
} = await import("#src/testing/scout-client/end-of-game-uploads.ts");
const { classicEndOfGameBlock } =
  await import("#src/testing/scout-client/end-of-game-fixtures.ts");

const owner = DiscordAccountIdSchema.parse("160509172704739328");
const guild = DiscordGuildIdSchema.parse("1337623164146155593");
const matchId = await classicMatchId();
const ref = { riotMatchId: matchId };
const MINUTE = 60_000;
const uploads = endOfGameUploads(prisma, matchId);
/** Past the deadline, so the record may freeze. */
const pastDeadline = () =>
  new Date(Date.now() - END_OF_GAME_DEADLINE_MS - MINUTE);
/** The game ended just before its upload, so it is a live completion. */
const endedRecently = (block: { endOfGameTimestamp: number }) => {
  block.endOfGameTimestamp = Date.now() - END_OF_GAME_DEADLINE_MS - 2 * MINUTE;
};

let deviceId: string;
beforeAll(async () => {
  io.lakeDir = await mkdtemp(path.join(tmpdir(), "end-of-game-lake-"));
});
beforeEach(async () => {
  io.fetchMatch.mockReset();
  // Riot never publishes League Classic: a definitive 404.
  io.fetchMatch.mockResolvedValue(undefined);
  io.objects.clear();
  io.render.mockClear();
  uploads.reset();
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
  const observer = LeaguePuuidSchema.parse(
    observerOf(await classicEndOfGameBlock()),
  );
  const now = new Date();
  await prisma.player.create({
    data: {
      alias: "Classic Scout",
      discordId: owner,
      serverId: guild,
      creatorDiscordId: owner,
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: {
          alias: "Classic Scout",
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

/** `scoutMatchProcessingWorkflow`'s Activities, in its order, for a FULL match. */
async function processMatch() {
  const observer = LeaguePuuidSchema.parse(
    observerOf(await classicEndOfGameBlock()),
  );
  await archiveMatchArtifacts(ref);
  const observation = await commitMatchObservation({
    ...ref,
    sourcePuuid: observer,
    deliveryMode: "live",
  });
  expect(observation.policy).toBe("FULL");
  expect(await prepareMatchEvidence(ref)).toEqual({ kind: "ready" });
  await settleMatchDares(ref);
  await applyMatchProgression(ref);
  await finalizeTournamentResult(ref);
  await recordMatchReceipts({
    ...ref,
    stage: "beta",
    kinds: [
      SCOUT_MATCH_RECEIPT_KINDS.archive,
      SCOUT_MATCH_RECEIPT_KINDS.observation,
      SCOUT_MATCH_RECEIPT_KINDS.settlement,
      SCOUT_MATCH_RECEIPT_KINDS.progression,
      SCOUT_MATCH_RECEIPT_KINDS.tournament,
    ],
  });
  const minted = await mintPostmatchNotificationIntents(ref);
  await advanceMatchCursor(ref);
  const plan = await planMatchFanOut(ref);
  const staged = plan.lakeProjection ? await stageLakeProjection(ref) : null;
  return { minted, plan, staged };
}

/** The archived canonical document, as a reader of `games/` parses it. */
function archivedRecord() {
  const [body] = [...io.objects.entries()]
    .filter(([key]) => key.endsWith("/match.json"))
    .map(([, value]) => value);
  if (body === undefined) throw new Error("Nothing was archived");
  return CanonicalMatchRecordSchema.parse(JSON.parse(body));
}

const StagedMatchRowSchema = z.looseObject({
  coverage: z.string(),
  game_version: z.string().nullable(),
});

/** The distinct coverage of the staged `matches` rows (JSON Lines files). */
async function stagedCoverage(): Promise<unknown[]> {
  const files = await listStagingFiles(io.lakeDir, "matches");
  expect(files.length).toBeGreaterThan(0);
  const texts = await Promise.all(
    files.map(async (file) => await Bun.file(file).text()),
  );
  const rows = texts
    .flatMap((text) => text.split("\n"))
    .filter((line) => line.trim().length > 0)
    .map((line) => StagedMatchRowSchema.parse(JSON.parse(line)));
  expect(rows.length).toBeGreaterThan(0);
  return [
    ...new Set(
      rows.map((row) =>
        JSON.stringify({
          coverage: row.coverage,
          unversioned: row.game_version === null,
        }),
      ),
    ),
  ].map((row): unknown => JSON.parse(row));
}

async function intentCount(): Promise<number> {
  return await prisma.matchNotificationIntent.count({
    where: { riotMatchId: matchId },
  });
}

describe("an end-of-game-only Classic game through the match core", () => {
  test("becomes the canonical match: archived, observed, announced and in the lake", async () => {
    const observationId = await uploads.uploadEndOfGame(
      deviceId,
      pastDeadline(),
      endedRecently,
    );

    const { minted, plan, staged } = await processMatch();

    expect(archivedRecord().coverage).toBe("end_of_game");
    expect(
      await prisma.scoutClientCanonicalMatch.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({ sourceObservationId: observationId });
    // No timeline is owed: the coverage is pinned missing, not awaited.
    expect(
      await prisma.matchEvidenceAdmission.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({ policy: "FULL", timelineMissing: true });
    expect(minted).toMatchObject({ minted: 1, conflicts: 0 });
    expect(plan.notificationIntentKeys).toHaveLength(1);
    expect(plan.lakeProjection).toBe(true);
    expect(staged?.stagedFileCount).toBeGreaterThan(0);
    expect(await stagedCoverage()).toEqual([
      { coverage: "end_of_game", unversioned: true },
    ]);
  });

  test("a history bundle before the deadline is the one record and the one post", async () => {
    // Both inside the record's deadline, and past the bundle's Riot window.
    const uploadedAt = new Date(Date.now() - 3 * MINUTE);
    const endedAt = uploadedAt.getTime() - MINUTE;
    await uploads.uploadEndOfGame(deviceId, uploadedAt, (block) => {
      block.endOfGameTimestamp = endedAt;
    });
    await uploads.uploadBundle(deviceId, uploadedAt, endedAt);

    await archiveMatchArtifacts(ref);
    await commitMatchObservation({ ...ref, deliveryMode: "live" });
    expect(await mintPostmatchNotificationIntents(ref)).toMatchObject({
      minted: 1,
    });
    // A retry, or a second dispatch of the same game, finds it standing.
    expect(await mintPostmatchNotificationIntents(ref)).toMatchObject({
      minted: 0,
      existing: 1,
    });

    expect(archivedRecord().coverage).toBe("complete");
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(1);
    expect(await intentCount()).toBe(1);
  });

  test("the fast scoreboard report and the canonical record share one post", async () => {
    await uploads.uploadEndOfGame(deviceId, pastDeadline(), endedRecently);
    const record = await classicEndOfGameMatch(endedRecently);
    await admitMatchEvidence({
      matchId,
      completedAt: record.info.gameEndTimestamp,
      historical: false,
      // Discovered with the upload, so the client result is past Riot's window.
      discoveredAt: pastDeadline(),
    });
    expect(
      await reconcileScoreboardReport(matchId, [gameResultFromMatch(record)]),
    ).toBe(true);
    expect(await intentCount()).toBe(1);

    const { minted } = await processMatch();

    expect(minted).toMatchObject({ minted: 0, existing: 1 });
    expect(await intentCount()).toBe(1);
  });

  test("two clients that disagree produce no record and stop the match for review", async () => {
    await uploads.uploadEndOfGame(deviceId, pastDeadline(), endedRecently);
    await uploads.uploadEndOfGame(
      await createTestScoutClientDevice(prisma, owner),
      new Date(pastDeadline().getTime() + 1000),
      (block) => {
        endedRecently(block);
        const stats = block.teams[0]?.players[0]?.stats;
        if (stats === undefined) throw new Error("The fixture has players");
        stats["assists"] = Number(stats["assists"]) + 1;
      },
    );

    const failure = await archiveMatchArtifacts(ref).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      nonRetryable: true,
      type: "ScoutClientObservationConflict",
    });
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);
    expect(io.objects.size).toBe(0);
    expect(await intentCount()).toBe(0);
  });

  test("a queue Riot publishes stays pending through an outage, then freezes once Riot answers", async () => {
    await uploads.uploadEndOfGame(
      deviceId,
      pastDeadline(),
      (block) => {
        endedRecently(block);
        asRanked(block);
      },
      rankedGameflow,
    );
    io.fetchMatch.mockRejectedValue(makeRiotTransportFailure());

    await expect(archiveMatchArtifacts(ref)).rejects.toThrow(
      "is not decided yet",
    );
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);
    expect(io.objects.size).toBe(0);

    io.fetchMatch.mockResolvedValue(undefined);
    await archiveMatchArtifacts(ref);
    expect(archivedRecord().coverage).toBe("end_of_game");
  });

  test("a record stays pending until its deadline passes", async () => {
    await uploads.uploadEndOfGame(deviceId, new Date(), endedRecently);

    await expect(archiveMatchArtifacts(ref)).rejects.toThrow(
      "is not decided yet",
    );
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);
    expect(io.objects.size).toBe(0);
  });
});
