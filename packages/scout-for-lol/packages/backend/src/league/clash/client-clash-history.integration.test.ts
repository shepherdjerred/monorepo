import { afterAll, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema, LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";

const { prisma } = createTestDatabase("clash-history-pagination");
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: () => false,
}));
const { readClientClashTeams } = await import("./client-clash.ts");
afterAll(async () => {
  await prisma.$disconnect();
});

test("history crosses page boundaries and resolves aliases once per page", async () => {
  const player = LeaguePuuidSchema.parse("p".repeat(78));
  const uuid = "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e";
  const deviceId = await createTestScoutClientDevice(
    prisma,
    DiscordAccountIdSchema.parse("160509172704739328"),
  );
  const capturedAt = new Date("2026-09-01T12:00:00Z");
  await prisma.leagueIdentityAlias.create({
    data: {
      lcuUuid: uuid,
      puuid: player,
      gameName: "Owner",
      tagLine: "NA1",
      source: "riot_id",
      ownerVerified: true,
    },
  });
  const observations = Array.from({ length: 101 }, (_, index) => ({
    observationId: crypto.randomUUID(),
    deviceId,
    sequence: BigInt(index + 1),
    capturedAt,
    protocolVersion: 1,
    schemaVersion: 1,
    appVersion: "0.1.0",
    kind: "clash",
    localPuuid: player,
    platformId: "NA1",
    bodyDigest: "fixture",
    disposition: "ACCEPTED",
    payload: {
      resource: "clash_roster",
      data: {
        id: `team-${index.toString()}`,
        tournamentId: index + 1000,
        name: `Team ${index.toString()}`,
        members: [{ puuid: uuid }],
      },
    },
  }));
  await prisma.scoutClientObservation.createMany({ data: observations });
  await prisma.scoutClientClashEntity.createMany({
    data: observations.map((row) => ({
      observerPuuid: player,
      platformId: "NA1",
      resource: "clash_roster",
      entityId: row.payload.data.id,
      tournamentId: row.payload.data.tournamentId.toString(),
      tournamentKey: row.payload.data.tournamentId.toString(),
      isPrimary: true,
      observationId: row.observationId,
      capturedAt,
    })),
  });
  const pages = vi.spyOn(prisma.scoutClientClashEntity, "findMany");
  const aliases = vi.spyOn(prisma.leagueIdentityAlias, "findMany");
  const teams = await readClientClashTeams([player], new Date(), true);
  expect(teams).toHaveLength(101);
  expect(new Set(teams.map((team) => team.rosterId)).size).toBe(101);
  expect(teams.every((team) => team.memberPuuids.includes(player))).toBe(true);
  expect(pages).toHaveBeenCalledTimes(2);
  expect(pages.mock.calls.every(([query]) => query?.take === 100)).toBe(true);
  expect(aliases).toHaveBeenCalledTimes(2);
});
