import { beforeEach, afterAll, expect, test } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  reserveExploreAudio,
  releaseExploreAudio,
  settleExploreAudio,
  reserveExploreCall,
  settleExploreCall,
  ExploreBudgetError,
} from "./ledger.ts";
import { ExploreSpendPolicySchema } from "#src/configuration/explore-spend.ts";
import { EXPLORE_MAX_PROVIDER_INPUT_BOUND } from "./input-bound.ts";

const db = createTestDatabase("explore-spending");
const base = {
  ownerId: "900000000000009001",
  runId: "turn-one",
  model: "gpt-6.1-sol",
  inputBound: 1000,
  maxOutputTokens: 1000,
  now: new Date("2026-10-03T00:00:00Z"),
};
beforeEach(async () => {
  await db.prisma.exploreSpend.deleteMany();
});
afterAll(async () => {
  await dropTestDatabase(db.prisma, db.dbPath);
});

test("reserves before a call and settles cached input plus total reasoning output once", async () => {
  const held = await reserveExploreCall(base, db.prisma);
  expect(held.amount).toBe(75_000);
  await settleExploreCall(
    held,
    {
      inputTokens: { total: 1000, cacheRead: 500, cacheWrite: 100 },
      outputTokens: { total: 200, reasoning: 150 },
    },
    "response-one",
    db.prisma,
  );
  const row = await db.prisma.exploreSpend.findUniqueOrThrow({
    where: { id: held.id },
  });
  expect(row.budgetMicros).toBe(18_600);
  expect(row.state).toBe("settled");
  expect(row.responseId).toBe("response-one");
  await settleExploreCall(
    held,
    { inputTokens: { total: 10 }, outputTokens: { total: 10 } },
    undefined,
    db.prisma,
  );
  const settled = await db.prisma.exploreSpend.findUniqueOrThrow({
    where: { id: held.id },
  });
  expect(settled.budgetMicros).toBe(18_600);
});

test("ambiguous usage retains the full durable hold", async () => {
  const held = await reserveExploreCall(base, db.prisma);
  await settleExploreCall(
    held,
    { inputTokens: { total: null } },
    undefined,
    db.prisma,
  );
  const row = await db.prisma.exploreSpend.findUniqueOrThrow({
    where: { id: held.id },
  });
  expect(row.state).toBe("held");
  expect(row.budgetMicros).toBe(held.amount);
});

test("concurrent processes cannot reserve the same last allowance", async () => {
  const policy = {
    globalMonthlyMicros: 45_000,
    userMonthlyMicros: 45_000,
    turnMicros: 45_000,
  };
  const results = await Promise.allSettled([
    reserveExploreCall({ ...base, policy }, db.prisma),
    reserveExploreCall({ ...base, runId: "turn-two", policy }, db.prisma),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  const total = await db.prisma.exploreSpend.aggregate({
    _sum: { budgetMicros: true },
  });
  expect(total._sum.budgetMicros).toBeLessThanOrEqual(45_000);
});

test("UTC month rollover grants a new monthly allowance but keeps the turn ceiling", async () => {
  const policy = {
    globalMonthlyMicros: 37_500,
    userMonthlyMicros: 37_500,
    turnMicros: 37_500,
  };
  await reserveExploreCall(
    { ...base, policy, now: new Date("2026-10-31T23:59:59.999Z") },
    db.prisma,
  );
  await expect(
    reserveExploreCall({ ...base, policy, runId: "another" }, db.prisma),
  ).rejects.toBeInstanceOf(ExploreBudgetError);
  await expect(
    reserveExploreCall(
      { ...base, policy, now: new Date("2026-11-01T00:00:00Z") },
      db.prisma,
    ),
  ).rejects.toBeInstanceOf(ExploreBudgetError);
  await expect(
    reserveExploreCall(
      {
        ...base,
        policy,
        runId: "november",
        now: new Date("2026-11-01T00:00:00Z"),
      },
      db.prisma,
    ),
  ).resolves.toHaveProperty("amount", 37_500);
});

test("zero disables calls and invalid or expanded policies fail validation", async () => {
  expect(
    ExploreSpendPolicySchema.safeParse({
      globalMonthlyMicros: 80_000_001,
      userMonthlyMicros: 1,
      turnMicros: 1,
    }).success,
  ).toBe(false);
  await expect(
    reserveExploreCall(
      {
        ...base,
        policy: { globalMonthlyMicros: 0, userMonthlyMicros: 0, turnMicros: 0 },
      },
      db.prisma,
    ),
  ).rejects.toMatchObject({ reason: "allowance" });
  await expect(
    reserveExploreCall(
      { ...base, inputBound: EXPLORE_MAX_PROVIDER_INPUT_BOUND + 1 },
      db.prisma,
    ),
  ).rejects.toMatchObject({
    name: "ExploreBudgetError",
    reason: "input_limit",
  });
  expect(await db.prisma.exploreSpend.count()).toBe(0);
});

test("audio is held before the provider, refused past the allowance, and settled or released", async () => {
  const policy = ExploreSpendPolicySchema.parse({
    globalMonthlyMicros: 100,
    userMonthlyMicros: 100,
    turnMicros: 100,
  });
  const audio = {
    ownerId: base.ownerId,
    model: "gpt-4o-transcribe",
    audioMs: 600_000,
    policy,
    now: base.now,
  } as const;
  // 10 minutes of transcription is 60_000 micros; the allowance is 100.
  await expect(
    reserveExploreAudio({ ...audio, runId: "a" }, db.prisma),
  ).rejects.toBeInstanceOf(ExploreBudgetError);
  expect(await db.prisma.exploreSpend.count()).toBe(0);

  const first = await reserveExploreAudio(
    { ...audio, runId: "a", audioMs: 600 },
    db.prisma,
  );
  expect(first.amount).toBe(60);
  await expect(
    reserveExploreAudio({ ...audio, runId: "b", audioMs: 600 }, db.prisma),
  ).rejects.toBeInstanceOf(ExploreBudgetError);

  await settleExploreAudio(first, { audioMs: 300, runId: "run-1" }, db.prisma);
  const settled = await db.prisma.exploreSpend.findUniqueOrThrow({
    where: { id: first.id },
  });
  expect(settled).toMatchObject({
    state: "settled",
    runId: "run-1",
    budgetMicros: 30,
  });

  const second = await reserveExploreAudio(
    { ...audio, runId: "b", audioMs: 600 },
    db.prisma,
  );
  await releaseExploreAudio(second, db.prisma);
  expect(await db.prisma.exploreSpend.count()).toBe(1);
});
