import { beforeEach, afterAll, expect, test } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
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
  expect(held.amount).toBe(12_500);
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
  expect(row.budgetMicros).toBe(3100);
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
  expect(settled.budgetMicros).toBe(3100);
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
    globalMonthlyMicros: 15_000,
    userMonthlyMicros: 15_000,
    turnMicros: 15_000,
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
  expect(total._sum.budgetMicros).toBeLessThanOrEqual(15_000);
});

test("UTC month rollover grants a new monthly allowance but keeps the turn ceiling", async () => {
  const policy = {
    globalMonthlyMicros: 12_500,
    userMonthlyMicros: 12_500,
    turnMicros: 12_500,
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
  ).resolves.toHaveProperty("amount", 12_500);
});

test("zero disables calls and invalid or expanded policies fail validation", async () => {
  expect(
    ExploreSpendPolicySchema.safeParse({
      globalMonthlyMicros: 20_000_001,
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
  ).rejects.toBeInstanceOf(ExploreBudgetError);
  await expect(
    reserveExploreCall(
      { ...base, inputBound: EXPLORE_MAX_PROVIDER_INPUT_BOUND + 1 },
      db.prisma,
    ),
  ).rejects.toBeInstanceOf(ExploreBudgetError);
  expect(await db.prisma.exploreSpend.count()).toBe(0);
});
