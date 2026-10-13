import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  createCompetitionFixture,
  resetCompetitionFixtures,
} from "#src/testing/competition-fixtures.ts";
import { getCompetitionById } from "#src/database/competition/queries.ts";
import type * as CompetitionParticipants from "#src/database/competition/participants.ts";

const io = vi.hoisted(() => ({
  render: vi.fn(async () => ({
    data: Buffer.from("frozen chart"),
    chartType: "bar" as const,
  })),
  saveStandings: vi.fn<() => Promise<void>>().mockResolvedValue(),
  saveImage: vi.fn<() => Promise<void>>().mockResolvedValue(),
  freeze: vi.fn(async () => ({
    key: `product-announcements/${"a".repeat(64)}`,
    digest: "a".repeat(64),
    bytes: 12,
    name: "competition-standings.png",
  })),
}));
vi.mock("#src/league/competition/leaderboard.ts", () => ({
  calculateLeaderboard: vi.fn(async () => []),
}));
vi.mock(
  "#src/database/competition/participants.ts",
  async (importOriginal) => ({
    ...(await importOriginal<typeof CompetitionParticipants>()),
    getParticipants: vi.fn(async () => []),
  }),
);
vi.mock("#src/league/competition/chart-builder.ts", () => ({
  renderCompetitionChartBuffer: io.render,
}));
vi.mock("#src/storage/s3-leaderboard.ts", () => ({
  saveCachedLeaderboard: io.saveStandings,
}));
vi.mock("#src/storage/s3-leaderboard-image.ts", () => ({
  saveLeaderboardImage: io.saveImage,
}));
vi.mock("#src/temporal/notification/product/artifacts.ts", () => ({
  freezeAnnouncementArtifact: io.freeze,
}));

import { prepareDurableCompetitionUpdate } from "#src/league/tasks/competition/daily-update.ts";
const { prisma: db } = createTestDatabase("durable-competition-preparation");
const occurrence = new Date("2026-10-12T12:00:00.000Z");
beforeEach(async () => {
  await resetCompetitionFixtures(db);
  vi.clearAllMocks();
});
afterAll(async () => await db.$disconnect());

async function competition() {
  const created = await createCompetitionFixture(db);
  const found = await getCompetitionById(db, created.id);
  if (found === undefined) throw new Error("Expected competition fixture");
  return found;
}

test("durable preparation preserves scheduled standings and image history while rendering once", async () => {
  const input = await competition();
  const prepared = await prepareDurableCompetitionUpdate(input, occurrence);
  expect(io.saveStandings).toHaveBeenCalledExactlyOnceWith({
    version: "v1",
    competitionId: input.id,
    calculatedAt: occurrence.toISOString(),
    entries: [],
  });
  expect(io.saveImage).toHaveBeenCalledExactlyOnceWith(
    input.id,
    occurrence,
    Buffer.from("frozen chart"),
  );
  expect(io.render).toHaveBeenCalledOnce();
  expect(io.saveStandings.mock.invocationCallOrder[0]).toBeLessThan(
    io.render.mock.invocationCallOrder[0] ?? 0,
  );
  expect(io.freeze).toHaveBeenCalledExactlyOnceWith(
    Buffer.from("frozen chart"),
    `competition-${input.id.toString()}-standings.png`,
  );
  expect(prepared.artifacts).toHaveLength(1);
});

test.each(["standings", "image"] as const)(
  "a failed %s cache write leaves durable preparation retryable",
  async (kind) => {
    const failure = new Error("S3 cache write unavailable");
    if (kind === "standings") io.saveStandings.mockRejectedValueOnce(failure);
    else io.saveImage.mockRejectedValueOnce(failure);
    await expect(
      prepareDurableCompetitionUpdate(await competition(), occurrence),
    ).rejects.toBe(failure);
    expect(io.freeze).not.toHaveBeenCalled();
  },
);
