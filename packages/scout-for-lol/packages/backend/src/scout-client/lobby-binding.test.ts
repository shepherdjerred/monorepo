import { expect, test } from "vitest";
import type { ScoutClientObservation } from "@scout-for-lol/data";
import {
  lobbyParticipantPuuids,
  observedGameState,
  observedLobbyMatchesCustomSettings,
  observedLobbyMatchesDuelSettings,
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
  expect(observedGameState(observation("post_game", "post_game", {}))).toBe(
    "RESULT_PENDING",
  );
  expect(
    observedGameState(observation("post_game", "match_history_game:123", {})),
  ).toBeNull();
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
