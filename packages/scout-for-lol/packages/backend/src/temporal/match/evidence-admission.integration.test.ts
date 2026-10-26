import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

const { prisma } = createTestDatabase("match-evidence-admission");
const mode = vi.hoisted(() => ({ production: false }));
const forbiddenEffect = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("An unguarded effect was attempted");
  }),
);
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: () => mode.production,
}));
vi.mock("#src/temporal/effect-fence.ts", async (original) => ({
  ...(await original()),
  runGuardedEffect: forbiddenEffect,
}));
vi.mock("#src/temporal/match/match-context.ts", () => ({
  resolveScoutObservedMatchContext: forbiddenEffect,
  resolveScoutMatchContext: forbiddenEffect,
}));
const {
  admitMatchEvidence,
  admittedDeliveryMode,
  matchEffectsAllowed,
  effectEligibleMatchIds,
  riotHistoryAnchorAllowed,
} = await import("#src/evidence/admission.ts");
const { restrictEffectMatchRelation, restrictEffectTimelineRelation } =
  await import("#src/evidence/lake-eligibility.ts");
const history = RiotMatchIdSchema.parse("NA1_960001");
const live = RiotMatchIdSchema.parse("NA1_960002");
const old = RiotMatchIdSchema.parse("NA1_960003");
beforeEach(async () => {
  mode.production = false;
  await prisma.matchEvidenceAdmission.deleteMany();
  await prisma.matchObservation.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

test("admission is permanent across stronger evidence and retries", async () => {
  const now = new Date();
  expect(
    await admitMatchEvidence({
      matchId: history,
      completedAt: now.getTime(),
      historical: true,
      discoveredAt: now,
    }),
  ).toBe("HISTORY_ONLY");
  expect(
    await admitMatchEvidence({
      matchId: history,
      completedAt: now.getTime(),
      historical: false,
      riotHistoryListed: true,
    }),
  ).toBe("HISTORY_ONLY");
  expect(await matchEffectsAllowed(history)).toBe(false);
  expect(await riotHistoryAnchorAllowed(history)).toBe(false);
  await admitMatchEvidence({
    matchId: live,
    completedAt: now.getTime(),
    historical: false,
    discoveredAt: now,
  });
  expect(
    await admitMatchEvidence({
      matchId: live,
      completedAt: now.getTime(),
      historical: true,
      discoveredAt: new Date(now.getTime() + 86_400_000),
    }),
  ).toBe("FULL");
  expect(await matchEffectsAllowed(live)).toBe(true);
  expect(admittedDeliveryMode("FULL", "silent-backfill")).toBe("live");
  expect(admittedDeliveryMode("HISTORY_ONLY", "live")).toBe("silent-backfill");
  expect(await riotHistoryAnchorAllowed(live)).toBe(false);
  await admitMatchEvidence({
    matchId: live,
    completedAt: now.getTime(),
    historical: false,
    riotHistoryListed: true,
  });
  expect(await riotHistoryAnchorAllowed(live)).toBe(true);
  expect(
    await admitMatchEvidence({
      matchId: old,
      completedAt: now.getTime() - 900_001,
      historical: false,
      discoveredAt: now,
    }),
  ).toBe("HISTORY_ONLY");
});

test("legacy historical FULL is repaired with its prior policy retained for audit", async () => {
  const now = new Date();
  await prisma.matchObservation.create({
    data: {
      riotMatchId: history,
      platformRoute: "NA1",
      processingPolicy: "FULL",
      deliveryMode: "silent-backfill",
      pipelineOwner: "TEMPORAL_V2",
      gameCreatedAt: now,
      observedAt: now,
    },
  });
  expect(await matchEffectsAllowed(history)).toBe(false);
  expect(
    await prisma.matchObservation.findUniqueOrThrow({
      where: { riotMatchId: history },
    }),
  ).toMatchObject({ processingPolicy: "HISTORY_ONLY", promotedAt: null });
  expect(
    await prisma.matchEvidenceAdmission.findUniqueOrThrow({
      where: { riotMatchId: history },
    }),
  ).toMatchObject({
    legacyPolicy: "FULL",
    reason: "legacy-history",
    completedAt: null,
  });
});

test("unknown completion cannot authorize a new live game", async () => {
  await expect(
    admitMatchEvidence({ matchId: old, completedAt: null, historical: false }),
  ).rejects.toThrow("requires a completion timestamp");
  expect(await prisma.matchEvidenceAdmission.count()).toBe(0);
});

test("Dare/progression inputs exclude history before aggregation while analytics retain it", async () => {
  await admitMatchEvidence({
    matchId: history,
    completedAt: Date.now(),
    historical: true,
  });
  await admitMatchEvidence({
    matchId: live,
    completedAt: Date.now(),
    historical: false,
  });
  expect(await effectEligibleMatchIds([history, live, old])).toEqual([live]);
  await withDuckDBConnection(async (session) => {
    await session.run(
      "CREATE TEMP TABLE analytics_history(match_id VARCHAR, wins INTEGER)",
    );
    await session.run("INSERT INTO analytics_history VALUES (?, 100), (?, 1)", [
      history,
      live,
    ]);
    await session.run(
      "CREATE TEMP TABLE _dare_match_window AS SELECT * FROM analytics_history",
    );
    await restrictEffectMatchRelation(session, "_dare_match_window");
    expect(
      await session.run(
        "SELECT SUM(wins)::INTEGER AS wins FROM _dare_match_window",
      ),
    ).toEqual([{ wins: 1 }]);
    expect(
      await session.run(
        "SELECT SUM(wins)::INTEGER AS wins FROM analytics_history",
      ),
    ).toEqual([{ wins: 101 }]);
    await prisma.matchEvidenceAdmission.update({
      where: { riotMatchId: live },
      data: { timelineMissing: true, timelineFinalizedAt: new Date() },
    });
    await session.run(
      "CREATE TEMP TABLE timeline_coverage AS SELECT * FROM analytics_history",
    );
    await restrictEffectTimelineRelation(session, "timeline_coverage");
    expect(
      await session.run(
        "SELECT match_id FROM timeline_coverage ORDER BY match_id",
      ),
    ).toEqual([]);
  });
});

test("production does not create admissions or change its current Riot policy", async () => {
  mode.production = true;
  expect(admittedDeliveryMode("FULL", "silent-backfill")).toBe(
    "silent-backfill",
  );
  expect(
    await admitMatchEvidence({
      matchId: history,
      completedAt: 1,
      historical: true,
    }),
  ).toBe("FULL");
  expect(await prisma.matchEvidenceAdmission.count()).toBe(0);
  expect(await effectEligibleMatchIds([history])).toEqual([history]);
});

test("direct effect Activities reject history before fetching inputs or entering a fence", async () => {
  await admitMatchEvidence({
    matchId: history,
    completedAt: Date.now(),
    historical: true,
  });
  const { settleMatchMarkets, applyMatchProgression } =
    await import("#src/temporal/match/match-effects.ts");
  const { finalizeTournamentResult } =
    await import("#src/temporal/match/match-tournament.ts");
  await expect(settleMatchMarkets({ riotMatchId: history })).rejects.toThrow(
    "cannot resolve dares",
  );
  await expect(applyMatchProgression({ riotMatchId: history })).rejects.toThrow(
    "cannot apply progression",
  );
  await expect(
    finalizeTournamentResult({ riotMatchId: history }),
  ).rejects.toThrow("cannot finalize operational results");
  expect(forbiddenEffect).not.toHaveBeenCalled();
  expect(await prisma.matchProcessingReceipt.count()).toBe(0);
});
