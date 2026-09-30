import { expect, test } from "vitest";
import type { ScoutClientObservation } from "@scout-for-lol/data";
import {
  lobbyParticipantPuuids,
  observedGameState,
  observedLobbyMatchesCustomSettings,
  observedLobbyMatchesCustomTeams,
  observedLobbyMatchesDuelSettings,
  observedLobbyMatchesDuelTeams,
  observedMatchEndedAt,
} from "./lobby-payload.ts";

function observation(
  kind: ScoutClientObservation["kind"],
  resource: string,
  data: ScoutClientObservation["payload"],
): ScoutClientObservation {
  return {
    protocolVersion: 1,
    schemaVersion: 1,
    observationId: "00000000-0000-4000-8000-000000000001",
    sequence: 1,
    capturedAt: "2026-09-20T12:00:00.000Z",
    appVersion: "0.1.0",
    kind,
    payload: { resource, data },
  };
}

test("lobbyParticipantPuuids collects only participant identity fields", () => {
  expect(
    lobbyParticipantPuuids({
      localMember: { puuid: "one" },
      members: [{ summonerPuuid: "two" }, { displayName: "ignored" }],
      unrelated: { accountId: "not-a-puuid" },
    }),
  ).toEqual(new Set(["one", "two"]));
});

test("observedGameState maps only explicit live lifecycle evidence", () => {
  expect(
    observedGameState(observation("gameflow", "gameflow_phase", "InProgress")),
  ).toBe("PLAYING");
  expect(
    observedGameState(observation("gameflow", "gameflow_phase", "EndOfGame")),
  ).toBe("RESULT_PENDING");
  expect(
    observedGameState(
      observation("gameflow", "gameflow_session", {
        phase: "InProgress",
      }),
    ),
  ).toBe("PLAYING");
  expect(observedGameState(observation("post_game", "post_game", {}))).toBe(
    "RESULT_PENDING",
  );
  expect(
    observedGameState(observation("post_game", "match_history_game:123", {})),
  ).toBeNull();
});

test("observedMatchEndedAt prefers durable match timing over delayed capture", () => {
  const delayed = observation("post_game", "post_game", {
    timing: { gameEndTimestamp: Date.parse("2026-09-20T11:55:00.000Z") },
  });

  expect(observedMatchEndedAt(delayed)).toEqual(
    new Date("2026-09-20T11:55:00.000Z"),
  );
  expect(
    observedMatchEndedAt(observation("post_game", "post_game", {})),
  ).toEqual(new Date("2026-09-20T12:00:00.000Z"));
});

test("observedLobbyMatchesCustomSettings validates map and pick mode", () => {
  const payload = {
    resource: "lobby",
    data: { gameConfig: { mapId: 11, pickType: "TournamentDraft" } },
  };
  expect(
    observedLobbyMatchesCustomSettings(payload, {
      map: "SUMMONERS_RIFT",
      pickMode: "TOURNAMENT_DRAFT",
    }),
  ).toBe(true);
  expect(
    observedLobbyMatchesCustomSettings(payload, {
      map: "HOWLING_ABYSS",
      pickMode: "TOURNAMENT_DRAFT",
    }),
  ).toBe(false);
  expect(
    observedLobbyMatchesCustomSettings(payload, {
      map: "SUMMONERS_RIFT",
      pickMode: "BLIND_PICK",
    }),
  ).toBe(false);
  expect(
    observedLobbyMatchesCustomSettings(
      { resource: "lobby", data: {} },
      {
        map: "SUMMONERS_RIFT",
        pickMode: "TOURNAMENT_DRAFT",
      },
    ),
  ).toBe(false);
});

test("observedLobbyMatchesDuelSettings requires tournament draft on Summoner's Rift", () => {
  expect(
    observedLobbyMatchesDuelSettings({
      resource: "lobby",
      data: { gameConfig: { mapId: 11, pickType: "TournamentDraft" } },
    }),
  ).toBe(true);
  expect(
    observedLobbyMatchesDuelSettings({
      resource: "lobby",
      data: { gameConfig: { mapId: 12, pickType: "TournamentDraft" } },
    }),
  ).toBe(false);
  expect(
    observedLobbyMatchesDuelSettings({
      resource: "lobby",
      data: { gameConfig: { mapId: 11, pickType: "BlindPick" } },
    }),
  ).toBe(false);
});

/**
 * A four-player lobby split evenly across the two sides.
 *
 * Both spellings of the side id reach this builder: the Custom lobby numbers
 * them 100/200 and the LCU numbers the same lobby 0/1, so the two cases differ
 * only in the ids they are given.
 */
function twoSidedLobby(blueTeamId: number, redTeamId: number) {
  return {
    resource: "lobby",
    data: {
      members: [
        { puuid: "blue-one", teamId: blueTeamId },
        { puuid: "blue-two", teamId: blueTeamId },
        { puuid: "red-one", teamId: redTeamId },
        { puuid: "red-two", teamId: redTeamId },
      ],
    },
  };
}

const twoSidedLobbySides = [
  { puuid: "blue-one", side: "BLUE" },
  { puuid: "blue-two", side: "BLUE" },
  { puuid: "red-one", side: "RED" },
  { puuid: "red-two", side: "RED" },
];

test("observed lobby teams preserve Custom side assignments", () => {
  const payload = twoSidedLobby(100, 200);
  const expected = twoSidedLobbySides;

  expect(observedLobbyMatchesCustomTeams(payload, expected)).toBe(true);
  expect(
    observedLobbyMatchesCustomTeams(payload, [
      ...expected.slice(0, 1),
      { puuid: "blue-two", side: "RED" },
      ...expected.slice(2),
    ]),
  ).toBe(false);
});

test("observed LCU lobby teams normalize zero-based side IDs", () => {
  const payload = twoSidedLobby(0, 1);
  const expected = twoSidedLobbySides;

  expect(observedLobbyMatchesCustomTeams(payload, expected)).toBe(true);
  expect(
    observedLobbyMatchesDuelTeams(
      payload,
      expected.slice(0, 2),
      expected.slice(2),
    ),
  ).toBe(true);
});

test("observed lobby teams keep duel competitors intact on opposing sides", () => {
  const payload = {
    resource: "lobby",
    data: {
      members: [
        { summonerPuuid: "one-a", teamId: 100 },
        { summonerPuuid: "one-b", teamId: 100 },
        { summonerPuuid: "two-a", teamId: 200 },
        { summonerPuuid: "two-b", teamId: 200 },
      ],
    },
  };
  const one = [{ puuid: "one-a" }, { puuid: "one-b" }];
  const two = [{ puuid: "two-a" }, { puuid: "two-b" }];

  expect(observedLobbyMatchesDuelTeams(payload, one, two)).toBe(true);
  expect(observedLobbyMatchesDuelTeams(payload, two, one)).toBe(true);
  expect(
    observedLobbyMatchesDuelTeams(payload, one, [
      { puuid: "one-b" },
      { puuid: "two-b" },
    ]),
  ).toBe(false);
});
