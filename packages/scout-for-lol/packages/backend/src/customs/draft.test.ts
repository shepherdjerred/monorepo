import { describe, expect, test } from "bun:test";
import type {
  CustomGameParticipant,
  CustomNightParticipant,
} from "@scout-for-lol/data";
import {
  CUSTOM_DRAFT_ORDER,
  activeDraftTeam,
  assertCustomTeamsComplete,
  assertRosterLockable,
  pickCustomPlayer,
  selectCaptains,
  selectCustomRoster,
  undoCustomPick,
} from "#src/customs/draft.ts";

function nightParticipant(index: number): CustomNightParticipant {
  return {
    discordId: index.toString(),
    displayName: `Player ${index.toString()}`,
    avatarUrl: null,
    role: "MEMBER",
    availability: "READY",
    readyAt: new Date(1000 + index).toISOString(),
    awayUntil: null,
    awayOverdue: false,
    held: false,
    consentedAt: new Date(0).toISOString(),
    playerId: index + 1,
    playerAlias: `p${index.toString()}`,
    accounts: [
      {
        accountId: index + 1,
        puuid: `puuid-${index.toString()}`,
        region: "AMERICA_NORTH",
        riotGameName: `Player${index.toString()}`,
        riotTagLine: "NA1",
      },
    ],
    selectedAccountId: index + 1,
  };
}

function gameParticipant(index: number): CustomGameParticipant {
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
    team: null,
    side: null,
    captain: false,
    pickOrder: null,
    championId: null,
    won: null,
  };
}

describe("custom roster selection", () => {
  test("first ten is stable by ready time", () => {
    const participants = Array.from({ length: 12 }, (_, index) =>
      nightParticipant(index),
    ).toReversed();
    expect(
      selectCustomRoster({
        participants,
        mode: "FIRST_TEN",
        selectedDiscordIds: [],
      }).map((p) => p.discordId),
    ).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  test("random roster consumes an injected cryptographic selector", () => {
    const participants = Array.from({ length: 11 }, (_, index) =>
      nightParticipant(index),
    );
    const roster = selectCustomRoster({
      participants,
      mode: "RANDOM_TEN",
      selectedDiscordIds: [],
      random: () => 0,
    });
    expect(roster).toHaveLength(10);
    expect(
      new Set(roster.map((participant) => participant.discordId)).size,
    ).toBe(10);
  });

  test("host selection preserves the submitted order and rejects duplicates", () => {
    const participants = Array.from({ length: 11 }, (_, index) =>
      nightParticipant(index),
    );
    const selectedDiscordIds = [
      "9",
      "7",
      "5",
      "3",
      "1",
      "0",
      "2",
      "4",
      "6",
      "8",
    ];
    expect(
      selectCustomRoster({
        participants,
        mode: "HOST_SELECTED",
        selectedDiscordIds,
      }).map((participant) => participant.discordId),
    ).toEqual(selectedDiscordIds);
    expect(() =>
      selectCustomRoster({
        participants,
        mode: "HOST_SELECTED",
        selectedDiscordIds: ["0", "0", "1", "2", "3", "4", "5", "6", "7", "8"],
      }),
    ).toThrow("10 distinct players");
  });

  test("held players reserve roster slots but cannot lock while away", () => {
    const returnedRoster = Array.from({ length: 10 }, (_, index) =>
      nightParticipant(index),
    );
    const firstParticipant = returnedRoster[0];
    if (firstParticipant === undefined) throw new Error("roster is empty");
    const returnedParticipant = { ...firstParticipant, held: true };
    returnedRoster[0] = returnedParticipant;
    expect(() => assertRosterLockable(returnedRoster)).not.toThrow();

    const awayRoster = returnedRoster.with(0, {
      ...returnedParticipant,
      awayUntil: new Date(Date.now() + 300_000).toISOString(),
    });
    expect(() => assertRosterLockable(awayRoster)).toThrow("still away");
  });

  test("skips unheld away players while preserving held reservations", () => {
    const participants = Array.from({ length: 11 }, (_, index) =>
      nightParticipant(index),
    );
    const firstParticipant = participants[0];
    if (firstParticipant === undefined) throw new Error("roster is empty");
    const awayUntil = new Date(Date.now() + 300_000).toISOString();
    participants[0] = { ...firstParticipant, awayUntil };
    expect(
      selectCustomRoster({
        participants,
        mode: "FIRST_TEN",
        selectedDiscordIds: [],
      }).map((participant) => participant.discordId),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

    participants[0] = { ...firstParticipant, awayUntil, held: true };
    const heldRoster = selectCustomRoster({
      participants,
      mode: "FIRST_TEN",
      selectedDiscordIds: [],
    });
    expect(heldRoster.map((participant) => participant.discordId)).toContain(
      "0",
    );
    expect(() => assertRosterLockable(heldRoster)).toThrow("still away");
  });

  test("players who withdraw after roster selection cannot lock", () => {
    const roster = Array.from({ length: 10 }, (_, index) =>
      nightParticipant(index),
    );
    const withdrawnParticipant = roster[0];
    if (withdrawnParticipant === undefined) throw new Error("roster is empty");

    const withdrawnRoster = roster.with(0, {
      ...withdrawnParticipant,
      availability: "SITTING_OUT",
    });
    expect(() => assertRosterLockable(withdrawnRoster)).toThrow(
      "is no longer ready or held",
    );

    const heldRoster = withdrawnRoster.with(0, {
      ...withdrawnParticipant,
      availability: "SITTING_OUT",
      held: true,
    });
    expect(() => assertRosterLockable(heldRoster)).not.toThrow();
  });
});

describe("captain draft", () => {
  test("enforces A BB AA BB A and undo", () => {
    let participants = selectCaptains(
      Array.from({ length: 10 }, (_, index) => gameParticipant(index)),
      () => 0,
    );
    const captains = participants.filter((participant) => participant.captain);
    const captainA = captains.find((captain) => captain.team === "A");
    const captainB = captains.find((captain) => captain.team === "B");
    if (captainA === undefined || captainB === undefined)
      throw new Error("captains missing");

    const pickedTeams: string[] = [];
    for (const expectedTeam of CUSTOM_DRAFT_ORDER) {
      expect(activeDraftTeam(participants)).toBe(expectedTeam);
      const target = participants.find(
        (participant) => !participant.captain && participant.team === null,
      );
      if (target === undefined) throw new Error("pick target missing");
      participants = pickCustomPlayer({
        participants,
        captainDiscordId:
          expectedTeam === "A" ? captainA.discordId : captainB.discordId,
        pickedDiscordId: target.discordId,
      });
      pickedTeams.push(expectedTeam);
    }
    expect(pickedTeams).toEqual(["A", "B", "B", "A", "A", "B", "B", "A"]);
    expect(activeDraftTeam(participants)).toBeNull();
    expect(() => assertCustomTeamsComplete(participants)).not.toThrow();
    participants = undoCustomPick(participants);
    expect(activeDraftTeam(participants)).toBe("A");
    expect(() => assertCustomTeamsComplete(participants)).toThrow(
      "five assigned players",
    );
  });
});
