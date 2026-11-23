import { expect, test } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";
import {
  parseObservedReplayProvenance,
  replayProvenanceFromMatch,
} from "./provenance.ts";

const match = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const observer = match.info.participants[0];
if (observer === undefined)
  throw new Error("Replay provenance fixture is empty");
const history = {
  gameId: "123",
  platformId: "NA1",
  gameDuration: match.info.gameDuration,
  mapId: match.info.mapId,
  gameMode: match.info.gameMode,
  participantIdentities: match.info.participants.map((participant) => ({
    participantId: participant.participantId,
    player: { puuid: participant.puuid },
  })),
  participants: match.info.participants.map((participant) => ({
    participantId: participant.participantId,
    teamId: participant.teamId,
    stats: participant,
  })),
};
const evidence = {
  localPuuid: observer.puuid,
  leaguePatch: match.info.gameVersion,
  requestedGameId: "123",
  requestedPlatformId: "NA1",
};

test("canonical match provenance retains actual map, mode and counted roster", () => {
  expect(replayProvenanceFromMatch(match, [observer.puuid])).toMatchObject({
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
  });
});

test("observed presentation facts come from the qualified full result", () => {
  expect(
    parseObservedReplayProvenance({ ...evidence, payload: { data: history } }),
  ).toMatchObject({ mapId: 11, gameMode: "CLASSIC", teamSizes: [5, 5] });
  expect(
    parseObservedReplayProvenance({
      ...evidence,
      payload: { data: { matchHistory: history } },
    }),
  ).toMatchObject({ mapId: 11, gameMode: "CLASSIC", teamSizes: [5, 5] });
});

test("missing map/mode and partial identities stay explicitly unknown", () => {
  const { mapId: _map, gameMode: _mode, ...partial } = history;
  expect(
    parseObservedReplayProvenance({
      ...evidence,
      payload: {
        data: {
          ...partial,
          participantIdentities: history.participantIdentities.slice(0, 1),
        },
      },
    }),
  ).toMatchObject({ mapId: null, gameMode: null, teamSizes: null });
});

test("duplicate participant ids cannot establish roster compatibility", () => {
  expect(
    parseObservedReplayProvenance({
      ...evidence,
      payload: {
        data: {
          ...history,
          participants: [...history.participants, history.participants[0]],
        },
      },
    }),
  ).toMatchObject({ teamSizes: null });
});

test("contradictory game/platform or malformed explicit presentation facts are refused", () => {
  for (const change of [
    { gameId: "456" },
    { platformId: "EUW1" },
    { mapId: "11" },
  ])
    expect(
      parseObservedReplayProvenance({
        ...evidence,
        payload: { data: { ...history, ...change } },
      }),
    ).toBeNull();
});
