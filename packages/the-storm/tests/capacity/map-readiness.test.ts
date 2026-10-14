import { expect, it } from "vitest";
import {
  emptyCapacityLobby,
  verifyCapacityMapPreparation,
} from "./map-readiness.ts";

it("admits preparation before the candidate vote chooses a map, only in an empty ready lobby", () => {
  const lobby = {
    ready: true,
    phase: "Lobby",
    humans: 0,
    bots: 0,
    arriving: 0,
    map: "none",
  };
  expect(emptyCapacityLobby(lobby)).toBe(true);
  for (const change of [
    { ready: false },
    { phase: "Live" },
    { humans: 1 },
    { bots: 1 },
    { arriving: 1 },
  ])
    expect(emptyCapacityLobby({ ...lobby, ...change })).toBe(false);
});

it("accepts actual one-map preparation in flight and rejects refusal or missing identity", () => {
  const reply = {
    maps: [
      {
        id: "apex-expanse",
        region: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 1, y: 1, z: 1 },
        },
        blocksSha256: "a".repeat(64),
        decoded: false,
        busy: true,
        ready: false,
        heldChunks: 0,
        preparations: 1,
        releases: 0,
      },
    ],
    navigation: [],
    heapUsed: 1,
    heapCommitted: 2,
    heapMax: 2,
    tick: 1,
    tickTimes: [1],
    loadedChunks: {},
  };
  expect(() =>
    verifyCapacityMapPreparation(JSON.stringify(reply), "apex-expanse"),
  ).not.toThrow();
  for (const invalid of [
    "Map preparation requires an empty lobby without a showcase.",
    JSON.stringify({ error: "refused" }),
    JSON.stringify({ ...reply, maps: [] }),
    JSON.stringify({ ...reply, maps: [...reply.maps, ...reply.maps] }),
    JSON.stringify({ ...reply, heapCommitted: 0 }),
  ])
    expect(() =>
      verifyCapacityMapPreparation(invalid, "apex-expanse"),
    ).toThrow();
  expect(() =>
    verifyCapacityMapPreparation(JSON.stringify(reply), "warlords-castles"),
  ).toThrow("requested map");
});
