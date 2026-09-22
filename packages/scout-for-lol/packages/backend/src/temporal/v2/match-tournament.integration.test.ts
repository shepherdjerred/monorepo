import { afterAll, describe, expect, test, vi } from "vitest";
import { MatchIdSchema, type RawMatch } from "@scout-for-lol/data";
import type * as DatabaseModule from "#src/database/index.ts";
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

const { finalizeTournamentMatchV2 } =
  await import("#src/temporal/v2/match-tournament.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

const GUILD = testGuildId("7401");
const CHANNEL = testChannelId("7401");
const OWNER = testAccountId("7401");

async function seedReportedLobby(code: string): Promise<void> {
  await prisma.tournamentLobby.create({
    data: {
      code,
      apiMode: "STUB",
      providerId: 1,
      tournamentId: 1,
      region: "AMERICA_NORTH",
      platformId: "NA1",
      serverId: GUILD,
      channelId: CHANNEL,
      creatorDiscordId: OWNER,
      bluePuuids: "[]",
      redPuuids: "[]",
      blueAliases: "[]",
      redAliases: "[]",
      teamSize: 5,
      pickType: "TOURNAMENT_DRAFT",
      mapType: "SUMMONERS_RIFT",
      spectatorType: "ALL",
      expiresAt: new Date("2026-09-14T00:00:00.000Z"),
      state: "reported",
    },
  });
}

function matchWithCode(fixture: RawMatch, code: string | undefined): RawMatch {
  return { ...fixture, info: { ...fixture.info, tournamentCode: code } };
}

describe("the V2 tournament finalization stage", () => {
  test("skips an ordinary match with one lookup and says so", async () => {
    // Most matches are not tournament games. The stage still runs — nothing
    // else can know — but it costs an indexed lobby lookup and reports the
    // ordinary case out loud rather than as a finalization that published
    // nothing.
    const fixture = await loadRawMatchFixture();
    const matchId = MatchIdSchema.parse(fixture.metadata.matchId);

    expect(
      await finalizeTournamentMatchV2(
        matchId,
        matchWithCode(fixture, undefined),
      ),
    ).toEqual({ outcome: "not-a-tournament-match" });
  });

  test("reports a lobby this pipeline already reported as already-finalized", async () => {
    // The resume case: a crash between this stage and the cursor advance means
    // the stage runs again. The managed-custom projector refuses to re-report a
    // lobby in `reported`, so the second pass changes nothing — which is what
    // makes resuming safe rather than a double-finalization.
    const fixture = await loadRawMatchFixture();
    const matchId = MatchIdSchema.parse(fixture.metadata.matchId);
    const code = "V2-ALREADY-REPORTED";
    await seedReportedLobby(code);

    const first = await finalizeTournamentMatchV2(
      matchId,
      matchWithCode(fixture, code),
    );
    const second = await finalizeTournamentMatchV2(
      matchId,
      matchWithCode(fixture, code),
    );

    expect(first).toEqual({
      outcome: "already-finalized",
      publishedNight: false,
    });
    expect(second).toEqual(first);
    const lobby = await prisma.tournamentLobby.findUniqueOrThrow({
      where: { code },
      select: { state: true },
    });
    expect(lobby.state).toBe("reported");
  });

  test("matches a lobby by its code rather than by the match id alone", async () => {
    // The gate reuses v1's own identity rule, so the two can never disagree
    // about which lobby a match belongs to.
    const fixture = await loadRawMatchFixture();
    const code = "V2-CODE-MATCHED";
    await seedReportedLobby(code);

    expect(
      await finalizeTournamentMatchV2(
        MatchIdSchema.parse("NA1_0000000001"),
        matchWithCode(fixture, code),
      ),
    ).toMatchObject({ outcome: "already-finalized" });
  });
});
