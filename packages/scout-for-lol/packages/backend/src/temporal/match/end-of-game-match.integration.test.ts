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
  COMPETITIVE_PROGRESSION_CATALOG_VERSION,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  HallSettingsSchema,
} from "@scout-for-lol/data";
import { SCOUT_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client/scout-client-device.ts";
import { makeRiotTransportFailure } from "#src/testing/riot-mocks.ts";
import type { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { testChannelId } from "#src/testing/test-ids.ts";
import type * as PolicyFlags from "#src/configuration/flags.ts";

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
vi.mock("#src/evidence/recovery-gate.ts", () => ({
  evidenceRecoveryEnabled: () => true,
}));
vi.mock("#src/configuration/flags.ts", async (original) => {
  const actual = await original<typeof PolicyFlags>();
  const isPolicyEnabled: typeof actual.isPolicyEnabled = async (
    name,
    attributes,
  ) =>
    name === "hall_of_fame_enabled" ||
    (await actual.isPolicyEnabled(name, attributes));
  return { ...actual, isPolicyEnabled };
});
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
vi.mock("#src/storage/s3-helpers.ts", async (original) => {
  const { inMemoryS3 } =
    await import("#src/testing/scout-client/match-pipeline-doubles.ts");
  return {
    ...(await original()),
    saveToS3: inMemoryS3(io.objects, "end-of-game-fixture").saveToS3,
  };
});
vi.mock("#src/report-store/s3-raw-source.ts", async (original) => {
  const { inMemoryS3 } =
    await import("#src/testing/scout-client/match-pipeline-doubles.ts");
  return {
    ...(await original()),
    readVerifiedRawObjectText: inMemoryS3(io.objects, "end-of-game-fixture")
      .readVerifiedRawObjectText,
  };
});
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
const { runHallBaseline } = await import("#src/progression/hall/baseline.ts");
const { evaluateHallMatch } =
  await import("#src/progression/hall/evaluate-match.ts");
const { updateHallSettings } =
  await import("#src/progression/hall/settings.ts");
const { gameResultFromMatch } =
  await import("#src/scout-client/canonical/riot-result.ts");
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
const {
  archivedRecordIn,
  clearMatchPipelineRows,
  createTrackedPlayer,
  stagedMatchRows,
} = await import("#src/testing/scout-client/match-pipeline-doubles.ts");

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
  await prisma.hallSettings.deleteMany();
  await clearMatchPipelineRows(prisma);
  const observer = LeaguePuuidSchema.parse(
    observerOf(await classicEndOfGameBlock()),
  );
  await createTrackedPlayer(prisma, {
    alias: "Classic Scout",
    owner,
    guild,
    puuid: observer,
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
  return archivedRecordIn(io.objects);
}

const StagedMatchRowSchema = z.looseObject({
  coverage: z.string(),
  game_version: z.string().nullable(),
});

/** The distinct coverage of the staged `matches` rows (JSON Lines files). */
async function stagedCoverage(): Promise<unknown[]> {
  const staged = await stagedMatchRows(io.lakeDir);
  const rows = staged.map((row) => StagedMatchRowSchema.parse(row));
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
  test("a Classic record break reaches notification fan-out before lake projection", async () => {
    const channelId = testChannelId("4310");
    const { baseline } = await updateHallSettings(prisma, {
      settings: HallSettingsSchema.parse({
        guildId: guild,
        catalogVersion: COMPETITIVE_PROGRESSION_CATALOG_VERSION,
        channelId,
        enabledQueueFamilies: ["classic_sr"],
        enabledRecords: ["kills"],
      }),
      actorDiscordId: owner,
      stage: "beta",
    });
    if (baseline === null)
      throw new Error("Expected a new Classic Hall baseline");
    await runHallBaseline({
      stage: "beta",
      guildId: guild,
      revision: baseline.revision,
    });
    await prisma.account.updateMany({
      data: { createdTime: new Date(Date.now() - 60 * MINUTE) },
    });

    const prior = await classicEndOfGameMatch((block) => {
      endedRecently(block);
      block.endOfGameTimestamp -= MINUTE;
    });
    await evaluateHallMatch({
      metadata: {
        ...prior.metadata,
        matchId: RiotMatchIdSchema.parse("NA1_4310000001"),
      },
      info: {
        ...prior.info,
        gameId: 4_310_000_001,
        participants: prior.info.participants.map((participant) => ({
          ...participant,
          kills: 0,
        })),
      },
    });
    expect(
      await prisma.hallRecordCell.findFirstOrThrow({
        where: { guildId: guild },
      }),
    ).toMatchObject({ currentValue: 0 });
    expect(await prisma.matchNotificationIntent.count()).toBe(0);

    await uploads.uploadEndOfGame(deviceId, pastDeadline(), endedRecently);
    const { plan } = await processMatch();
    const intentKey = `hall-record-break:${matchId}:${guild}`;

    expect(plan.notificationIntentKeys).toContain(intentKey);
    expect(
      await prisma.matchNotificationIntent.findUniqueOrThrow({
        where: { intentKey },
      }),
    ).toMatchObject({ state: "pending", targetId: channelId });
    const cell = await prisma.hallRecordCell.findFirstOrThrow({
      where: { guildId: guild },
    });
    expect(cell.currentValue).toBeGreaterThan(0);
  });

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
