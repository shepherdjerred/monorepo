import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema, RawMatchSchema } from "@scout-for-lol/data";
import { TIMELINE_RECOVERY_WINDOW_MS } from "@scout-for-lol/domain/match-processing/eligibility.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import type { resolveMatchTimeline } from "#src/evidence/timelines.ts";
import type { RiotSourceAbsence } from "#src/league/api/client/errors.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";

const { prisma } = createTestDatabase("historical-match-recovery");
const io = vi.hoisted(() => ({
  available: false,
  absence: vi.fn<() => RiotSourceAbsence | undefined>(),
  render: vi.fn(async () => "rendered"),
  archive: vi.fn(async () => ({ artifacts: [] })),
  timeline: vi.fn<typeof resolveMatchTimeline>(async () => ({
    kind: "unavailable",
    reason: "Not collected",
    definitiveAbsence: undefined,
  })),
  production: false,
}));
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: () => io.production,
}));
vi.mock("#src/evidence/recovery-gate.ts", () => ({
  evidenceRecoveryEnabled: () => !io.production,
}));
vi.mock("#src/evidence/matches.ts", () => ({
  resolveCompleteMatch: async () =>
    io.available
      ? {
          kind: "available",
          value: match,
          frozen: true,
          evidence: [],
          coverage: "complete",
        }
      : {
          kind: "unavailable",
          reason: "Missing postgame",
          definitiveAbsence: io.absence(),
        },
}));
vi.mock("#src/evidence/timelines.ts", () => ({
  resolveMatchTimeline: io.timeline,
}));
vi.mock("#src/temporal/match/match-context.ts", () => ({
  resolveScoutMatchContext: async () => context,
  resolveScoutObservedMatchContext: async () => ({
    ...context,
    observedPuuids: [],
  }),
}));
vi.mock("#src/temporal/match/match-archive.ts", async (original) => ({
  ...(await original()),
  archiveMatchArtifacts: io.archive,
}));
vi.mock("#src/temporal/notification-lane/notification-render.ts", () => ({
  renderMatchNotificationArtifact: io.render,
}));
const { reconcileMatchHistory, RIOT_NOT_FOUND_ABANDON_AFTER_MS } =
  await import("./history-recovery.ts");
const { admitMatchEvidence } = await import("#src/evidence/admission.ts");
const match = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const context = {
  riotMatchId: match.metadata.matchId,
  matchData: match,
  matchDataSource: "RIOT",
  trackedPlayers: [
    {
      alias: "Owner",
      league: { leagueAccount: { puuid: match.metadata.participants[0] } },
    },
  ],
};
const matchId = match.metadata.matchId;
beforeEach(async () => {
  io.available = false;
  io.absence.mockReset();
  io.production = false;
  io.render.mockReset();
  io.render.mockResolvedValue("rendered");
  io.archive.mockClear();
  io.timeline.mockClear();
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.matchTrackedAccount.deleteMany();
  await prisma.matchObservation.deleteMany();
  await prisma.matchEvidenceAdmission.deleteMany();
  await admitMatchEvidence({
    matchId,
    completedAt: null,
    historical: true,
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function due() {
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: matchId },
    data: { recoveryNextAttemptAt: new Date(0) },
  });
}

test("missing postgames and failed reports stay retryable without live effects", async () => {
  await reconcileMatchHistory();
  expect(io.render).not.toHaveBeenCalled();
  expect(await prisma.matchObservation.count()).toBe(0);
  io.available = true;
  io.render.mockRejectedValueOnce(new Error("Report storage unavailable"));
  await due();
  await expect(reconcileMatchHistory()).rejects.toThrow("remains retryable");
  const failed = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: matchId },
  });
  expect(failed).toMatchObject({
    policy: "HISTORY_ONLY",
    completedAt: new Date(match.info.gameEndTimestamp),
    historyReportComplete: false,
    recoveryClaimId: null,
  });
  await due();
  await reconcileMatchHistory();
  expect(io.render).toHaveBeenLastCalledWith(
    expect.objectContaining({
      postmatchMode: { kind: "historical", rankChanges: new Map() },
    }),
  );
  expect(
    await prisma.matchObservation.findUnique({
      where: { riotMatchId: matchId },
    }),
  ).toMatchObject({
    processingPolicy: "HISTORY_ONLY",
    deliveryMode: "silent-backfill",
  });
  const completed = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: matchId },
  });
  expect(completed).toMatchObject({
    historyReportComplete: true,
    historyTimelineRecovered: false,
    recoveryError: null,
  });
  await due();
  await reconcileMatchHistory();
  expect(io.render).toHaveBeenCalledTimes(2);
  expect(await prisma.matchNotificationIntent.count()).toBe(0);
});

test("production does not scan or drive the history queue", async () => {
  io.production = true;
  expect(await reconcileMatchHistory()).toBe(0);
  expect(io.archive).not.toHaveBeenCalled();
  expect(io.timeline).not.toHaveBeenCalled();
});

const owner = DiscordAccountIdSchema.parse("160509172704739328");

/** Age the admission; by default past the evidence window every source is given. */
async function aged(ageMs = TIMELINE_RECOVERY_WINDOW_MS + 1) {
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: matchId },
    data: { createdAt: new Date(Date.now() - ageMs) },
  });
  await due();
}

const NOT_FOUND_TIMELINE = {
  kind: "unavailable",
  reason: "No compatible timeline evidence",
  definitiveAbsence: "not_found",
} as const;

async function admission() {
  return await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: matchId },
  });
}

async function clientObservation(
  receivedAt: Date,
  disposition: "ACCEPTED" | "QUARANTINED" = "ACCEPTED",
) {
  const deviceId = await createTestScoutClientDevice(prisma, owner);
  const [platformId = null, gameId = null] = matchId.split("_");
  return await prisma.scoutClientObservation.create({
    data: {
      observationId: crypto.randomUUID(),
      deviceId,
      sequence: 1n,
      capturedAt: receivedAt,
      receivedAt,
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: "post_game",
      platformId,
      gameId,
      payload: { resource: "unparsed", data: {} },
      bodyDigest: "abandoned-recovery",
      disposition,
      quarantineReason:
        disposition === "QUARANTINED" ? "unknown_identity" : null,
    },
  });
}

test("a match Riot forbids past the evidence window is abandoned and not selected again", async () => {
  io.absence.mockReturnValue("forbidden");
  await aged();
  expect(await reconcileMatchHistory()).toBe(1);
  const abandoned = await admission();
  expect(abandoned).toMatchObject({
    recoveryAbandonedReason: "riot_match_forbidden",
    recoveryClaimId: null,
    recoveryError: null,
  });
  expect(abandoned.recoveryAbandonedAt).toBeInstanceOf(Date);
  await due();
  expect(await reconcileMatchHistory()).toBe(0);
});

test("a forbidden match within the evidence window stays retryable", async () => {
  io.absence.mockReturnValue("forbidden");
  await due();
  expect(await reconcileMatchHistory()).toBe(1);
  expect(await admission()).toMatchObject({
    recoveryAbandonedAt: null,
    recoveryAbandonedReason: null,
  });
  await due();
  expect(await reconcileMatchHistory()).toBe(1);
});

test("a not-found match is not abandoned before seven days", async () => {
  // Match-V5 publishes after a variable delay: 404 can mean "not yet".
  io.absence.mockReturnValue("not_found");
  await aged(RIOT_NOT_FOUND_ABANDON_AFTER_MS - 60_000);
  expect(await reconcileMatchHistory()).toBe(1);
  expect(await admission()).toMatchObject({
    recoveryAbandonedAt: null,
    recoveryAbandonedReason: null,
  });
  await due();
  expect(await reconcileMatchHistory()).toBe(1);
});

test("a not-found match is abandoned after seven days", async () => {
  io.absence.mockReturnValue("not_found");
  await aged(RIOT_NOT_FOUND_ABANDON_AFTER_MS + 1);
  expect(await reconcileMatchHistory()).toBe(1);
  expect(await admission()).toMatchObject({
    recoveryAbandonedReason: "riot_match_not_found",
    recoveryClaimId: null,
  });
  await due();
  expect(await reconcileMatchHistory()).toBe(0);
});

test("a not-found timeline is not abandoned before seven days", async () => {
  io.available = true;
  io.timeline
    .mockResolvedValueOnce(NOT_FOUND_TIMELINE)
    .mockResolvedValueOnce(NOT_FOUND_TIMELINE);
  await aged(RIOT_NOT_FOUND_ABANDON_AFTER_MS - 60_000);
  expect(await reconcileMatchHistory()).toBe(1);
  expect(await admission()).toMatchObject({
    historyReportComplete: true,
    recoveryAbandonedAt: null,
  });
  await due();
  expect(await reconcileMatchHistory()).toBe(1);
});

test("a not-found timeline is abandoned after seven days once the report is done", async () => {
  io.available = true;
  io.timeline.mockResolvedValueOnce(NOT_FOUND_TIMELINE);
  await aged(RIOT_NOT_FOUND_ABANDON_AFTER_MS + 1);
  expect(await reconcileMatchHistory()).toBe(1);
  expect(await admission()).toMatchObject({
    historyReportComplete: true,
    historyTimelineRecovered: false,
    recoveryAbandonedReason: "riot_timeline_not_found",
  });
  await due();
  expect(await reconcileMatchHistory()).toBe(0);
});

test("an outage or timeout is never abandoned", async () => {
  await aged();
  expect(await reconcileMatchHistory()).toBe(1);
  expect(await admission()).toMatchObject({
    recoveryAbandonedAt: null,
    recoveryAbandonedReason: null,
  });
  await due();
  expect(await reconcileMatchHistory()).toBe(1);
});

test("a timeline Riot forbids is abandoned once the history report is done", async () => {
  io.available = true;
  io.timeline.mockResolvedValueOnce({
    kind: "unavailable",
    reason: "No compatible timeline evidence",
    definitiveAbsence: "forbidden",
  });
  await aged();
  expect(await reconcileMatchHistory()).toBe(1);
  expect(await admission()).toMatchObject({
    historyReportComplete: true,
    historyTimelineRecovered: false,
    recoveryAbandonedReason: "riot_timeline_forbidden",
  });
  await due();
  expect(await reconcileMatchHistory()).toBe(0);
});

test("client evidence arriving after abandonment reopens recovery once", async () => {
  const t0 = Date.now();
  // Order evidence and attempt watermarks while keeping database timers real.
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(t0);
    io.absence.mockReturnValue("forbidden");
    await aged();
    await reconcileMatchHistory();
    const { recoveryAbandonedAt } = await admission();
    if (recoveryAbandonedAt === null) throw new Error("Expected abandonment");
    // Evidence that existed when recovery gave up does not reopen it.
    await clientObservation(new Date(recoveryAbandonedAt.getTime() - 1));
    await due();
    expect(await reconcileMatchHistory()).toBe(0);

    vi.setSystemTime(t0 + 1);
    const late = await clientObservation(new Date(t0 + 1));
    vi.setSystemTime(t0 + 2);
    await due();
    expect(await reconcileMatchHistory()).toBe(1);
    // Still unusable: the decision moves past this upload instead of looping.
    const reabandoned = await admission();
    expect(reabandoned.recoveryAbandonedAt?.getTime()).toBeGreaterThan(
      late.receivedAt.getTime(),
    );
    await due();
    expect(await reconcileMatchHistory()).toBe(0);

    // A reopened attempt that resolves clears the decision.
    vi.setSystemTime(t0 + 3);
    await clientObservation(new Date(t0 + 3));
    io.available = true;
    vi.setSystemTime(t0 + 4);
    await due();
    expect(await reconcileMatchHistory()).toBe(1);
    expect(await admission()).toMatchObject({
      recoveryAbandonedAt: null,
      recoveryAbandonedReason: null,
      historyReportComplete: true,
    });
  } finally {
    vi.useRealTimers();
  }
});

test("a quarantined upload accepted after abandonment reopens recovery", async () => {
  io.absence.mockReturnValue("forbidden");
  await aged();
  const observation = await clientObservation(
    new Date(Date.now() - 1000),
    "QUARANTINED",
  );
  await reconcileMatchHistory();
  const abandoned = await admission();
  expect(abandoned.recoveryAbandonedReason).toBe("riot_match_forbidden");
  await prisma.scoutClientObservation.update({
    where: { observationId: observation.observationId },
    data: {
      disposition: "ACCEPTED",
      quarantineReason: null,
      revalidations: { create: { validatedAt: new Date(Date.now() + 1) } },
    },
  });
  await due();
  expect(await reconcileMatchHistory()).toBe(1);
});
