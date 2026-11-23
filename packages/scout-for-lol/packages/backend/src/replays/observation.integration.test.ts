import { afterAll, beforeEach, expect, test } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import { persistReplayPatchObservation } from "./observation.ts";
import type { ReplayPatchObservation } from "@scout-for-lol/domain/artifacts/replay-support.ts";

const { prisma, dbPath } = createTestDatabase("replay-patch-observation");
beforeEach(async () => {
  await prisma.replayPatchObservation.deleteMany();
});
afterAll(async () => {
  await dropTestDatabase(prisma, dbPath);
});

function observation(
  platformId = "NA1",
  observedAt = "2026-11-13T20:00:00Z",
): ReplayPatchObservation {
  return {
    platformId,
    observedAt,
    patch: "16.22",
    gameBuild: "16.22.834.8910",
    sourceUrl: `https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/${platformId}/versions?platform=windows`,
    sourceSha256: "a".repeat(64),
  };
}

test("real PostgreSQL preserves newest observation across concurrent Activity completions", async () => {
  const newest = observation();
  const stale = {
    ...observation("NA1", "2026-11-13T19:59:00Z"),
    patch: "16.21",
    gameBuild: "16.21.829.8620",
  };
  await Promise.all([
    persistReplayPatchObservation(newest, prisma),
    persistReplayPatchObservation(stale, prisma),
  ]);
  expect(
    await prisma.replayPatchObservation.findUnique({
      where: { platformId: "NA1" },
    }),
  ).toMatchObject({
    patch: "16.22",
    gameBuild: newest.gameBuild,
    observedAt: new Date(newest.observedAt),
  });
  expect(
    await persistReplayPatchObservation(
      { ...newest, sourceSha256: "b".repeat(64) },
      prisma,
    ),
  ).toBe(false);
});

test("observations advance independently per Riot platform", async () => {
  await persistReplayPatchObservation(observation("NA1"), prisma);
  await persistReplayPatchObservation(
    { ...observation("EUW1"), patch: "16.21", gameBuild: "16.21.829.8620" },
    prisma,
  );
  expect(
    await prisma.replayPatchObservation.findMany({
      orderBy: { platformId: "asc" },
      select: { platformId: true, patch: true },
    }),
  ).toEqual([
    { platformId: "EUW1", patch: "16.21" },
    { platformId: "NA1", patch: "16.22" },
  ]);
});
