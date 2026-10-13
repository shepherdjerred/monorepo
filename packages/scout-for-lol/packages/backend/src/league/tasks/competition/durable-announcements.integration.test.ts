import { afterAll, beforeEach, expect, test } from "vitest";
import { getCompetitionById } from "#src/database/competition/queries.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  createCompetitionFixture,
  resetCompetitionFixtures,
} from "#src/testing/competition-fixtures.ts";
import { queueCompetitionLifecycle } from "#src/league/tasks/competition/durable-announcements.ts";

const { prisma: db } = createTestDatabase("competition-durable-occurrences");
const now = new Date();

beforeEach(async () => {
  await db.matchNotificationIntent.deleteMany();
  await db.scoutWorkflowStart.deleteMany();
  await resetCompetitionFixtures(db);
});
afterAll(async () => await db.$disconnect());

async function createCompetition() {
  const created = await createCompetitionFixture(db, { startDate: now });
  const competition = await getCompetitionById(db, created.id);
  if (competition === undefined) throw new Error("Expected seeded competition");
  return competition;
}

test("concurrent lifecycle attempts commit one frozen announcement and one recoverable start", async () => {
  const competition = await createCompetition();
  const command = {
    competition,
    phase: "start" as const,
    message: "Frozen standings",
    now,
  };
  await Promise.all([
    queueCompetitionLifecycle(db, command),
    queueCompetitionLifecycle(db, command),
  ]);
  const saved = await db.competition.findUniqueOrThrow({
    where: { id: competition.id },
  });
  expect(saved.startProcessedAt).toEqual(now);
  expect(saved.startNotifiedAt).toBeNull();
  expect(await db.matchNotificationIntent.count()).toBe(1);
  expect(await db.scoutWorkflowStart.count()).toBe(1);
  const intent = await db.matchNotificationIntent.findFirstOrThrow();
  expect(intent.payload).toContain("Frozen standings");
});

test("a content validation failure rolls back the occurrence marker and its outbox", async () => {
  const competition = await createCompetition();
  await expect(
    queueCompetitionLifecycle(db, {
      competition,
      phase: "start",
      message: "x".repeat(300_000),
      now,
    }),
  ).rejects.toThrow();
  const saved = await db.competition.findUniqueOrThrow({
    where: { id: competition.id },
  });
  expect(saved.startProcessedAt).toBeNull();
  expect(await db.matchNotificationIntent.count()).toBe(0);
  expect(await db.scoutWorkflowStart.count()).toBe(0);
  await queueCompetitionLifecycle(db, {
    competition,
    phase: "start",
    message: "Retry",
    now,
  });
  expect(await db.matchNotificationIntent.count()).toBe(1);
});

test("cancellation after preparation prevents the lifecycle marker and announcement", async () => {
  const competition = await createCompetition();
  await db.competition.update({
    where: { id: competition.id },
    data: { isCancelled: true },
  });
  await queueCompetitionLifecycle(db, {
    competition,
    phase: "start",
    message: "Stale preparation",
    now,
  });
  const saved = await db.competition.findUniqueOrThrow({
    where: { id: competition.id },
  });
  expect(saved.startProcessedAt).toBeNull();
  expect(await db.matchNotificationIntent.count()).toBe(0);
  expect(await db.scoutWorkflowStart.count()).toBe(0);
});
