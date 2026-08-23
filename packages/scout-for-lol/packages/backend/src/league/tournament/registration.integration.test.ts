import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  requireTournamentRegistration,
  saveTournamentRegistration,
} from "#src/league/tournament/registration.ts";

const { prisma: testPrisma } = createTestDatabase("tournament-registration");

beforeEach(async () => {
  await deleteIfExists(() => testPrisma.tournamentRegistration.deleteMany());
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("requireTournamentRegistration", () => {
  test("fails loudly and names the script when nothing is registered", async () => {
    // Deliberately not a lazy create. Creating on demand would race two
    // concurrent /lobby create calls into two providers, and would silently
    // mint a new registration on a fresh volume instead of reporting that
    // state is missing.
    await expect(
      requireTournamentRegistration(testPrisma, "stub", "NA"),
    ).rejects.toThrow(/register-tournament-provider/);
  });

  test("returns the registered provider and tournament", async () => {
    await saveTournamentRegistration(testPrisma, {
      apiMode: "stub",
      region: "NA",
      providerId: 42,
      tournamentId: 4242,
      callbackUrl:
        "https://beta.scout-for-lol.com/api/riot/tournament-callback",
      name: "test",
    });

    const registration = await requireTournamentRegistration(
      testPrisma,
      "stub",
      "NA",
    );

    expect(registration.providerId).toBe(42);
    expect(registration.tournamentId).toBe(4242);
  });

  test("stub and live are separate namespaces", async () => {
    // A code minted under the stub is meaningless under the live API, so the
    // registrations must not be shared. Registering one must not satisfy the
    // other.
    await saveTournamentRegistration(testPrisma, {
      apiMode: "stub",
      region: "NA",
      providerId: 1,
      tournamentId: 11,
      callbackUrl:
        "https://beta.scout-for-lol.com/api/riot/tournament-callback",
      name: "stub",
    });

    await expect(
      requireTournamentRegistration(testPrisma, "live", "NA"),
    ).rejects.toThrow(/live mode/);
  });

  test("regions are separate registrations", async () => {
    await saveTournamentRegistration(testPrisma, {
      apiMode: "stub",
      region: "NA",
      providerId: 1,
      tournamentId: 11,
      callbackUrl:
        "https://beta.scout-for-lol.com/api/riot/tournament-callback",
      name: "na",
    });

    await expect(
      requireTournamentRegistration(testPrisma, "stub", "EUW"),
    ).rejects.toThrow(/EUW/);
  });

  test("re-registering the same region updates rather than duplicating", async () => {
    const base = {
      apiMode: "stub",
      region: "NA",
      callbackUrl:
        "https://beta.scout-for-lol.com/api/riot/tournament-callback",
      name: "test",
    } as const;

    await saveTournamentRegistration(testPrisma, {
      ...base,
      providerId: 1,
      tournamentId: 11,
    });
    await saveTournamentRegistration(testPrisma, {
      ...base,
      providerId: 2,
      tournamentId: 22,
    });

    const rows = await testPrisma.tournamentRegistration.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerId).toBe(2);
  });
});
