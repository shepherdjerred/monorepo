import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  RiotMatchIdSchema,
  LeaguePuuidSchema,
  ScoutClientObservationSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import fixture from "#src/scout-client/canonical/testdata/classic-end-of-game.json";
import type { resolveCompleteMatch } from "#src/evidence/matches.ts";
import type { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";

const { prisma } = createTestDatabase("terminal-scoreboard-recovery");
const io = vi.hoisted(() => ({
  hardDisabled: vi.fn(() => false),
  render: vi.fn(async () => "rendered"),
  completeMatch: vi.fn<typeof resolveCompleteMatch>(),
  fetchMatch: vi.fn<typeof fetchMatchData>(),
}));
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: io.hardDisabled,
}));
vi.mock("#src/evidence/matches.ts", () => ({
  resolveCompleteMatch: io.completeMatch,
}));
vi.mock("#src/league/tasks/postmatch/match-data-fetcher.ts", () => ({
  fetchMatchData: io.fetchMatch,
}));
vi.mock("#src/temporal/notification-lane/notification-render.ts", () => ({
  renderMatchNotificationArtifact: io.render,
}));
vi.mock("#src/league/tasks/notification-filters.ts", () => ({
  resolvePostmatchDeliveryChannels: async () => ({
    deliverable: [{ channel: "1337623164146155594" }],
    guildIds: [],
    subscribed: [],
  }),
}));
const { projectClientGameResult } =
  await import("#src/scout-client/game-results.ts");
const { reconcileMatchHistory } = await import("./history-recovery.ts");
const { readReportScoreboard } =
  await import("#src/evidence/report-scoreboard.ts");
const { matchMayAnnounce } =
  await import("#src/temporal/notification/match-intents.ts");
const { reconcileScoreboardReport } = await import("./scoreboard-recovery.ts");
const { admitMatchEvidence } = await import("#src/evidence/admission.ts");
const { gameResultFromMatch } =
  await import("#src/scout-client/canonical/riot-result.ts");

const owner = DiscordAccountIdSchema.parse("160509172704739328");
const guild = DiscordGuildIdSchema.parse("1337623164146155593");
const observer = LeaguePuuidSchema.parse("scoreboard-observer".padEnd(78, "x"));
const matchId = RiotMatchIdSchema.parse("NA1_123456789");
let deviceId: string;
beforeEach(async () => {
  io.hardDisabled.mockReturnValue(false);
  io.render.mockReset();
  io.render.mockResolvedValue("rendered");
  io.completeMatch.mockReset();
  io.fetchMatch.mockReset();
  io.completeMatch.mockResolvedValue({
    kind: "unavailable",
    reason: "No full match coverage",
  });
  await prisma.$transaction([
    prisma.matchNotificationIntent.deleteMany(),
    prisma.matchReportSnapshot.deleteMany(),
    prisma.matchResultEvidence.deleteMany(),
    prisma.scoutClientGameResult.deleteMany(),
    prisma.matchEvidenceAdmission.deleteMany(),
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
      alias: "Scoreboard Scout",
      discordId: owner,
      serverId: guild,
      creatorDiscordId: owner,
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: {
          alias: "Scoreboard Scout",
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
  deviceId = await createTestScoutClientDevice(prisma, owner, {
    appVersion: "0.1.0",
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function upload(
  completedAt = Date.now() - 5000,
  wrongGame = false,
  mayhem = false,
) {
  const now = new Date();
  const gameflow = {
    resource: "gameflow_session",
    data: {
      gameData: {
        gameId: wrongGame ? 99 : 123_456_789,
        queue: { id: 4310, type: "JADE_RANKED_SOLO_5x5", gameMode: "JADE" },
      },
    },
  };
  const payload = structuredClone(fixture);
  payload.data.endOfGameTimestamp = completedAt;
  if (mayhem) {
    gameflow.data.gameData.queue = {
      id: 2450,
      type: "KIWI_JADE_MATCHED",
      gameMode: "KIWI_JADE",
    };
    payload.data.gameMode = "KIWI_JADE";
    payload.data.queueType = "KIWI_JADE_MATCHED";
  }
  let final;
  for (const [index, body] of [gameflow, payload].entries()) {
    const observation = ScoutClientObservationSchema.parse({
      observationId: crypto.randomUUID(),
      sequence: index + 1,
      capturedAt: new Date(now.getTime() - 1000 + index).toISOString(),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: index === 0 ? "gameflow" : "post_game",
      localPuuid: observer,
      platformId: "NA1",
      gameId: "123456789",
      payload: body,
    });
    await prisma.scoutClientObservation.create({
      data: {
        observationId: observation.observationId,
        deviceId,
        sequence: BigInt(index + 1),
        capturedAt: new Date(observation.capturedAt),
        receivedAt: now,
        protocolVersion: 1,
        schemaVersion: 1,
        appVersion: "0.1.0",
        kind: observation.kind,
        localPuuid: observer,
        platformId: "NA1",
        gameId: "123456789",
        payload: z.object({ resource: z.string(), data: z.json() }).parse(body),
        bodyDigest: "scrubbed-immutable-body",
        disposition: "ACCEPTED",
      },
    });
    final = observation;
  }
  if (final === undefined)
    throw new Error("Upload requires a terminal observation");
  await projectClientGameResult(final);
}

test("accepted Classic scoreboard reaches an ordinary pending report intent without full-match effects", async () => {
  await upload();
  expect(await prisma.matchResultEvidence.count()).toBe(1);
  expect(
    await prisma.matchEvidenceAdmission.findUnique({
      where: { riotMatchId: matchId },
    }),
  ).toMatchObject({ policy: "FULL" });
  await reconcileMatchHistory();
  const snapshot = await readReportScoreboard(matchId);
  expect(snapshot?.result.participants).toHaveLength(10);
  expect(snapshot?.trackedPuuids).toEqual([observer]);
  expect(io.render).toHaveBeenCalledWith(
    expect.objectContaining({ postmatchMode: { kind: "live" } }),
  );
  expect(await prisma.matchNotificationIntent.findMany()).toMatchObject([
    { riotMatchId: matchId, kind: "postmatch", state: "pending" },
  ]);
  expect(await prisma.matchObservation.count()).toBe(0);
  expect(await prisma.matchProcessingReceipt.count()).toBe(0);
  await reconcileMatchHistory();
  expect(io.render).toHaveBeenCalledTimes(1);
  expect(await prisma.matchNotificationIntent.count()).toBe(1);
  await expect(matchMayAnnounce(prisma, matchId, "settlement")).rejects.toThrow(
    "no observation",
  );
});

test("a forbidden Riot read cannot block the real resolver from recovering a client scoreboard", async () => {
  await upload();
  const actual = await vi.importActual<{
    resolveCompleteMatch: typeof resolveCompleteMatch;
  }>("#src/evidence/matches.ts");
  io.completeMatch.mockImplementation(actual.resolveCompleteMatch);
  io.fetchMatch.mockRejectedValue(
    new RiotHttpError({
      status: 403,
      statusText: "Forbidden",
      body: { status: { status_code: 403, message: "Forbidden" } },
      url: "match-evidence",
      headers: new Headers(),
    }),
  );
  await reconcileMatchHistory();
  expect(io.fetchMatch).toHaveBeenCalledTimes(1);
  const snapshot = await readReportScoreboard(matchId);
  expect(snapshot?.result.participants).toHaveLength(10);
  expect(await prisma.matchNotificationIntent.count()).toBe(1);
  expect(await prisma.matchObservation.count()).toBe(0);
});

test("available full evidence does not send an unobserved result through observed-only recovery", async () => {
  await upload();
  io.render.mockRejectedValueOnce(new Error("Render interrupted"));
  await expect(reconcileMatchHistory()).rejects.toThrow("remains retryable");
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: matchId },
    data: { recoveryNextAttemptAt: new Date(0) },
  });
  const complete = RawMatchSchema.parse(
    await Bun.file(
      new URL("../../../../../testdata/rift.json", import.meta.url),
    ).json(),
  );
  complete.metadata.matchId = matchId;
  io.completeMatch.mockResolvedValue({
    kind: "available",
    value: complete,
    frozen: false,
    coverage: "complete",
    evidence: [{ source: "RIOT", sourceId: matchId }],
  });
  await reconcileMatchHistory();
  expect(await prisma.matchObservation.count()).toBe(0);
  expect(await prisma.matchProcessingReceipt.count()).toBe(0);
  expect(await prisma.matchNotificationIntent.count()).toBe(1);
  expect(
    await prisma.matchEvidenceAdmission.findUnique({
      where: { riotMatchId: matchId },
    }),
  ).toMatchObject({
    policy: "FULL",
    historyReportComplete: true,
    recoveryError: null,
  });
});

test("API-supported scoreboards remain unfrozen during grace, then recover without full evidence", async () => {
  await upload(Date.now() - 5000, false, true);
  await reconcileMatchHistory();
  expect(await prisma.matchReportSnapshot.count()).toBe(0);
  expect(await prisma.matchNotificationIntent.count()).toBe(0);
  expect(io.render).not.toHaveBeenCalled();
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: matchId },
    data: {
      firstDiscoveredAt: new Date(Date.now() - 3 * 60_000),
      recoveryNextAttemptAt: new Date(0),
    },
  });
  await reconcileMatchHistory();
  expect(await prisma.matchReportSnapshot.count()).toBe(1);
  expect(await prisma.matchNotificationIntent.count()).toBe(1);
});

test("available Riot result evidence can freeze immediately without waiting for its archive projection", async () => {
  const complete = RawMatchSchema.parse(
    await Bun.file(
      new URL(
        "../../league/tasks/postmatch/testdata/match-classic-aram-mayhem-s3.json",
        import.meta.url,
      ),
    ).json(),
  );
  complete.metadata.matchId = matchId;
  const player = complete.info.participants[0];
  if (player === undefined) throw new Error("Fixture has no participants");
  player.puuid = observer;
  await admitMatchEvidence({
    matchId,
    completedAt: Date.now(),
    historical: false,
  });
  await expect(
    reconcileScoreboardReport(matchId, [gameResultFromMatch(complete)]),
  ).resolves.toBe(true);
  const snapshot = await readReportScoreboard(matchId);
  expect(snapshot?.result.source).toBe("RIOT");
  expect(await prisma.matchNotificationIntent.count()).toBe(1);
});

test("late scoreboards render historical reports without notification, settlement or progression", async () => {
  await upload(Date.now() - 86_400_000);
  await reconcileMatchHistory();
  expect(
    await prisma.matchEvidenceAdmission.findUnique({
      where: { riotMatchId: matchId },
    }),
  ).toMatchObject({ policy: "HISTORY_ONLY", historyReportComplete: true });
  expect(io.render).toHaveBeenCalledWith(
    expect.objectContaining({
      postmatchMode: { kind: "historical", rankChanges: new Map() },
    }),
  );
  expect(await prisma.matchNotificationIntent.count()).toBe(0);
  expect(await prisma.matchObservation.count()).toBe(0);
  expect(await prisma.matchProcessingReceipt.count()).toBe(0);
});

test("render failures leave frozen work retryable even after source rows disappear", async () => {
  await upload();
  io.render.mockRejectedValueOnce(new Error("S3 unavailable"));
  await expect(reconcileMatchHistory()).rejects.toThrow("remains retryable");
  const before = await readReportScoreboard(matchId);
  expect(
    await prisma.matchReportSnapshot.findUnique({
      where: { riotMatchId: matchId },
    }),
  ).toMatchObject({ completedAt: null });
  expect(await prisma.matchNotificationIntent.count()).toBe(0);
  await prisma.matchResultEvidence.deleteMany();
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: matchId },
    data: { recoveryNextAttemptAt: new Date(0) },
  });
  await reconcileMatchHistory();
  expect(await readReportScoreboard(matchId)).toEqual(before);
  expect(await prisma.matchNotificationIntent.count()).toBe(1);
});

test("wrong game context does not admit or project results", async () => {
  await upload(Date.now(), true);
  expect(await prisma.matchEvidenceAdmission.count()).toBe(0);
  expect(await prisma.matchResultEvidence.count()).toBe(0);
});

test("impossible future completion does not admit or project results", async () => {
  await upload(Date.now() + 10 * 60_000);
  expect(await prisma.matchEvidenceAdmission.count()).toBe(0);
  expect(await prisma.matchResultEvidence.count()).toBe(0);
});

test("production cannot normalize, freeze or recover client scoreboards", async () => {
  io.hardDisabled.mockReturnValue(true);
  await upload();
  await reconcileMatchHistory();
  expect(await prisma.matchResultEvidence.count()).toBe(0);
  expect(await prisma.matchReportSnapshot.count()).toBe(0);
  expect(io.render).not.toHaveBeenCalled();
});
