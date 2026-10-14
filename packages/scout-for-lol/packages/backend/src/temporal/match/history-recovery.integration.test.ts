import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("historical-match-recovery");
const io = vi.hoisted(() => ({
  available: false,
  render: vi.fn(async () => "rendered"),
  archive: vi.fn(async () => ({ artifacts: [] })),
  timeline: vi.fn(async () => ({
    kind: "unavailable",
    reason: "Not collected",
  })),
  production: false,
}));
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: () => io.production,
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
      : { kind: "unavailable", reason: "Missing postgame" },
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
const { reconcileMatchHistory } = await import("./history-recovery.ts");
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
  io.production = false;
  io.render.mockReset();
  io.render.mockResolvedValue("rendered");
  io.archive.mockClear();
  io.timeline.mockClear();
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
  expect(await prisma.scoutEffectClaim.count()).toBe(0);
  expect(await prisma.matchNotificationIntent.count()).toBe(0);
});

test("production does not scan or drive the history queue", async () => {
  io.production = true;
  expect(await reconcileMatchHistory()).toBe(0);
  expect(io.archive).not.toHaveBeenCalled();
  expect(io.timeline).not.toHaveBeenCalled();
});
