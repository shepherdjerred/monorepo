import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { RawMatch } from "@scout-for-lol/data";
import type * as DatabaseModule from "#src/database/index.ts";
import { clearCustomsTestData } from "#src/customs/test-database.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { loadRawMatchFixture } from "#src/testing/raw-capture-fixtures.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("scout-v2-match-tournament");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const published = vi.hoisted((): { nightIds: string[] } => ({ nightIds: [] }));
vi.mock("#src/customs/socket.ts", () => ({
  publishCustomNightSnapshot: (nightId: string) => {
    published.nightIds.push(nightId);
    return Promise.resolve();
  },
}));

const { finalizeTournamentMatch } =
  await import("#src/temporal/match/match-tournament.ts");

beforeEach(async () => {
  published.nightIds = [];
  await clearCustomsTestData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const GUILD = testGuildId("7401");
const CHANNEL = testChannelId("7401");
const HOST = testAccountId("7401");

/** A managed custom game an accepted observation already bound and verified. */
async function seedVerifiedObservedGame(matchId: RiotMatchId): Promise<string> {
  const now = new Date("2026-09-14T00:00:00.000Z");
  const night = await prisma.customNight.create({
    data: {
      guildId: GUILD,
      guildName: "Beta Guild",
      launchChannelId: CHANNEL,
      voiceLobbyChannelId: CHANNEL,
      hostDiscordId: HOST,
      state: "INTERMISSION",
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    },
  });
  await prisma.customGame.create({
    data: {
      nightId: night.id,
      sequence: 1,
      state: "VERIFIED",
      rosterMode: "FIRST_TEN",
      map: "SUMMONERS_RIFT",
      pickMode: "TOURNAMENT_DRAFT",
      observedLobbyId: "observed-local-lobby",
      matchId,
      completedAt: now,
      winner: "A",
    },
  });
  return night.id;
}

function matchWithCode(fixture: RawMatch, code: string | undefined): RawMatch {
  return { ...fixture, info: { ...fixture.info, tournamentCode: code } };
}

describe("the V2 tournament finalization stage", () => {
  test("skips an ordinary match with one lookup and says so", async () => {
    // Most matches are not managed custom games. The stage still runs —
    // nothing else can know — but it costs one indexed lookup and reports the
    // ordinary case out loud rather than as a finalization that published
    // nothing.
    const fixture = await loadRawMatchFixture();

    expect(
      await finalizeTournamentMatch(matchWithCode(fixture, undefined)),
    ).toEqual({ outcome: "not-a-tournament-match" });
    expect(published.nightIds).toEqual([]);
  });

  test("reports a game this pipeline already verified as already-finalized", async () => {
    // The resume case: a crash between this stage and the cursor advance means
    // the stage runs again. The managed-custom projector refuses to re-report a
    // verified game, so the second pass changes nothing — which is what makes
    // resuming safe rather than a double-finalization.
    const fixture = await loadRawMatchFixture();
    const nightId = await seedVerifiedObservedGame(fixture.metadata.matchId);

    const first = await finalizeTournamentMatch(fixture);
    const second = await finalizeTournamentMatch(fixture);

    expect(first).toEqual({
      outcome: "already-finalized",
      publishedNight: true,
    });
    expect(second).toEqual(first);
    expect(published.nightIds).toEqual([nightId, nightId]);
  });

  test("ignores a Riot tournament code without an observed game", async () => {
    // Tournament codes are an external payload field only; a match is managed
    // when an observation bound it to a custom game, never by its code.
    const fixture = await loadRawMatchFixture();

    expect(
      await finalizeTournamentMatch(
        matchWithCode(fixture, "HISTORICAL-TOURNAMENT-CODE"),
      ),
    ).toEqual({ outcome: "not-a-tournament-match" });
  });
});
