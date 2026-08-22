import { describe, expect, test } from "vitest";
import { TRPCError } from "@trpc/server";
import type {
  CustomGameParticipant,
  CustomNightParticipant,
} from "@scout-for-lol/data";
import {
  assertActiveCaptain,
  assertCustomHostControl,
  hasCustomHostControl,
} from "#src/customs/authorization.ts";
import { customIntermissionOutcome } from "#src/customs/lifecycle-service.ts";
import { assertCustomTeamsComplete } from "#src/customs/draft.ts";
import {
  hasActiveVoiceArrangementProvisioning,
  markOverdueAway,
  recruitmentCounts,
  shouldExpireCustomNight,
} from "#src/customs/snapshot.ts";
import { CustomNightSnapshotSchema } from "@scout-for-lol/data";

const NOW = "2026-08-15T20:00:00.000Z";

function nightParticipant(
  discordId: string,
  availability: CustomNightParticipant["availability"] = "READY",
): CustomNightParticipant {
  return {
    discordId,
    displayName: discordId,
    avatarUrl: null,
    role: "MEMBER",
    availability,
    readyAt: NOW,
    awayUntil: null,
    awayOverdue: false,
    held: false,
    consentedAt: NOW,
    playerId: 1,
    playerAlias: discordId,
    accounts: [],
    selectedAccountId: null,
  };
}

function gameParticipant(index: number): CustomGameParticipant {
  const team = index < 5 ? "A" : "B";
  const pickOrders = [null, 1, 2, 3, 4, null, 5, 6, 7, 8];
  return {
    discordId: index.toString(),
    displayName: `Player ${index.toString()}`,
    playerId: index + 1,
    playerAlias: `p${index.toString()}`,
    accountId: index + 1,
    puuid: `puuid-${index.toString()}`,
    riotGameName: null,
    riotTagLine: null,
    rosterOrder: index,
    benchOrder: null,
    team,
    side: team === "A" ? "BLUE" : "RED",
    captain: index === 0 || index === 5,
    pickOrder: pickOrders[index] ?? null,
    championId: 1,
    won: team === "A",
  };
}

function intermissionSnapshot() {
  return CustomNightSnapshotSchema.parse({
    id: "4df1fd22-770f-4f9b-a247-bd97a73c603d",
    guildId: "12345678901234567",
    guildName: "Guild",
    launchChannelId: "12345678901234567",
    voiceLobbyChannelId: "12345678901234567",
    hostDiscordId: "12345678901234567",
    cohostDiscordIds: ["98765432109876543"],
    state: "INTERMISSION",
    revision: 4,
    participants: [],
    currentGame: {
      id: "105fbf72-e1cf-4ec7-801c-ad58b6987b72",
      sequence: 1,
      state: "VERIFIED",
      rosterMode: "FIRST_TEN",
      map: "SUMMONERS_RIFT",
      pickMode: "TOURNAMENT_DRAFT",
      participants: Array.from({ length: 10 }, (_, index) =>
        gameParticipant(index),
      ),
      activeCaptain: null,
      tournamentCode: "CODE",
      riotMatchId: "NA1_1",
      winner: "A",
      resultSource: "RIOT",
      resultDisagreement: false,
      repeatChampionWarnings: [],
      voiceReady: true,
      voiceOverride: false,
      voiceError: null,
      createdAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
    },
    recruitmentCounts: { ready: 0, maybe: 0, away: 0, held: 0, remaining: 10 },
    recruitmentMessageId: null,
    riotTournamentId: "tournament",
    teamAVoiceChannelId: null,
    teamBVoiceChannelId: null,
    lastActivityAt: NOW,
    expiresAt: "2026-08-16T08:00:00.000Z",
    endedAt: null,
  });
}

describe("availability policy", () => {
  test("away players stop counting ready while held players reserve a slot", () => {
    const ready = nightParticipant("ready");
    const away = {
      ...nightParticipant("away"),
      awayUntil: "2026-08-15T20:05:00.000Z",
    };
    const held = { ...nightParticipant("held", "MAYBE"), held: true };
    expect(recruitmentCounts([ready, away, held])).toEqual({
      ready: 1,
      maybe: 1,
      away: 1,
      held: 1,
      remaining: 8,
    });
  });

  test("elapsed away deadlines become overdue without returning the player", () => {
    const snapshot = intermissionSnapshot();
    const away = {
      ...nightParticipant("away"),
      awayUntil: "2026-08-15T19:59:00.000Z",
    };
    const marked = markOverdueAway(
      CustomNightSnapshotSchema.parse({ ...snapshot, participants: [away] }),
      new Date(NOW),
    );
    expect(marked.participants[0]?.awayOverdue).toBe(true);
    expect(marked.participants[0]?.awayUntil).toBe(away.awayUntil);
    expect(marked.recruitmentCounts.ready).toBe(0);
  });

  test("a held-ready player counts as one eligible roster slot", () => {
    expect(
      recruitmentCounts([
        nightParticipant("ready"),
        { ...nightParticipant("held-ready"), held: true },
      ]),
    ).toMatchObject({ ready: 2, held: 1, remaining: 8 });
  });
});

describe("custom authority", () => {
  const snapshot = intermissionSnapshot();

  test("host, cohost, and Discord administrator have recovery control", () => {
    expect(hasCustomHostControl(snapshot, snapshot.hostDiscordId, false)).toBe(
      true,
    );
    expect(
      hasCustomHostControl(snapshot, snapshot.cohostDiscordIds[0] ?? "", false),
    ).toBe(true);
    expect(hasCustomHostControl(snapshot, "outsider", true)).toBe(true);
    expect(hasCustomHostControl(snapshot, "outsider", false)).toBe(false);
  });

  test("permission failures retain client-actionable tRPC codes", () => {
    try {
      assertCustomHostControl(snapshot, "outsider", false);
      throw new Error("Expected host control to be denied");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      if (!(error instanceof TRPCError)) throw error;
      expect(error.code).toBe("FORBIDDEN");
    }
  });

  test("only the active captain can pick", () => {
    const drafting = CustomNightSnapshotSchema.parse({
      ...snapshot,
      state: "DRAFTING",
      currentGame: {
        ...snapshot.currentGame,
        state: "DRAFTING",
        activeCaptain: "A",
      },
    });
    expect(assertActiveCaptain(drafting, "0")).toBe("A");
    try {
      assertActiveCaptain(drafting, "5");
      throw new Error("Expected inactive captain to be denied");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      if (!(error instanceof TRPCError)) throw error;
      expect(error.code).toBe("FORBIDDEN");
      expect(error.message).toMatch(/active captain/);
    }
    try {
      assertActiveCaptain(snapshot, "0");
      throw new Error("Expected an inactive draft to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      if (!(error instanceof TRPCError)) throw error;
      expect(error.code).toBe("BAD_REQUEST");
    }
  });
});

describe("intermission policy", () => {
  const snapshot = intermissionSnapshot();

  test.each([
    ["KEEP_TEAMS_AND_CAPTAINS", "CAPTAINS_SET", 10],
    ["KEEP_TEAMS_REROLL_CAPTAINS", "CAPTAINS_SET", 10],
    ["REDRAFT_SAME_CAPTAINS", "DRAFTING", 2],
    ["REDRAFT_NEW_CAPTAINS", "DRAFTING", 2],
  ] as const)("applies %s", (choice, state, assignedPlayers) => {
    const outcome = customIntermissionOutcome(snapshot, choice);
    expect(outcome.state).toBe(state);
    expect(
      outcome.participants.filter((participant) => participant.team !== null),
    ).toHaveLength(assignedPlayers);
    expect(
      outcome.participants.filter((participant) => participant.captain),
    ).toHaveLength(2);
    if (state === "CAPTAINS_SET")
      expect(() =>
        assertCustomTeamsComplete(outcome.participants),
      ).not.toThrow();
  });
});

describe("night expiry", () => {
  test("expires only active nights whose deadline has elapsed", () => {
    const now = new Date(NOW);
    expect(
      shouldExpireCustomNight({ state: "RECRUITING", expiresAt: NOW }, now),
    ).toBe(true);
    expect(
      shouldExpireCustomNight({ state: "ENDED", expiresAt: NOW }, now),
    ).toBe(false);
    expect(
      shouldExpireCustomNight(
        { state: "RECRUITING", expiresAt: "2026-08-15T20:01:00.000Z" },
        now,
      ),
    ).toBe(false);
  });

  test("voice arrangement claims become recoverable after five minutes", () => {
    const snapshot = intermissionSnapshot();
    const game = CustomNightSnapshotSchema.parse({
      ...snapshot,
      currentGame: {
        ...snapshot.currentGame,
        voiceArrangementProvisioning: {
          id: "305fbf72-e1cf-4ec7-801c-ad58b6987b72",
          startedAt: NOW,
        },
      },
    }).currentGame;
    expect(
      hasActiveVoiceArrangementProvisioning(
        game,
        new Date("2026-08-15T20:04:59.999Z"),
      ),
    ).toBe(true);
    expect(
      hasActiveVoiceArrangementProvisioning(
        game,
        new Date("2026-08-15T20:05:00.000Z"),
      ),
    ).toBe(false);
  });
});
