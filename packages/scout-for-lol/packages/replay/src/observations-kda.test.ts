import { expect, test } from "vitest";
import {
  createReplayObservationEliminations,
  createReplayObservationKdaTimeline,
  type ReplayObservations,
} from "./observations.ts";

function observations(): ReplayObservations {
  return {
    build: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
    duration: 10,
    roster: Array.from({ length: 10 }, (_, index) => ({
      champion: `Champion${index.toString()}`,
      team: index < 5 ? 100 : 200,
    })),
    binding: {
      verified: Array.from({ length: 8 }, (_, index) => ({
        context: 100 + index,
        footerRow: index + 1,
      })),
      unresolved: [108, 109],
      events: [
        {
          kind: "champion-kill",
          context: 100,
          partition: 0,
          timeSeconds: 1.0001,
          secondTimeBits: 10,
        },
        {
          kind: "champion-death",
          context: 105,
          partition: 1,
          timeSeconds: 1.0002,
          secondTimeBits: 10,
        },
        {
          kind: "champion-kill",
          context: 100,
          partition: 0,
          timeSeconds: 2.1234,
          secondTimeBits: 20,
        },
        {
          kind: "champion-death",
          context: 108,
          partition: 1,
          timeSeconds: 2.1235,
          secondTimeBits: 20,
        },
      ],
      assists: [
        {
          kind: "champion-assist",
          context: 101,
          partition: 0,
          timeSeconds: 1.0009,
          secondTimeBits: 10,
        },
      ],
      assistEvents: 1,
    },
    levels: null,
    returns: null,
    turrets: null,
    structures: null,
    aliveCounts: null,
  };
}

test("K/D/A is independent of missing level/return channels, ordered and projected without raw identities", () => {
  const timeline = createReplayObservationKdaTimeline(observations());
  expect(timeline.actors).toHaveLength(10);
  expect(
    timeline.actors.slice(0, 5).every((actor) => actor.partition === 0),
  ).toBe(true);
  expect(timeline.actors.slice(5).every((actor) => actor.partition === 1)).toBe(
    true,
  );
  expect(timeline.actors[0]).toEqual({ partition: 0, champion: "Champion0" });
  expect(timeline.actors[8]).toEqual({ partition: 1, champion: null });
  expect(JSON.stringify(timeline)).not.toMatch(
    /context|footerRow|secondTimeBits|player|summoner|puuid/i,
  );
});

test("elimination pairs require unique opposing witnesses and bound identities", () => {
  const { binding } = observations();
  expect(createReplayObservationEliminations(binding)).toEqual([
    { timeSeconds: 1.0002, killerId: 100, victimId: 105 },
  ]);
  binding.events.push({
    kind: "champion-death",
    context: 106,
    partition: 1,
    timeSeconds: 1.0003,
    secondTimeBits: 10,
  });
  expect(createReplayObservationEliminations(binding)).toEqual([]);
});

test("ceil-to-ms checkpoints include every event in the same millisecond once", () => {
  const timeline = createReplayObservationKdaTimeline(observations());
  expect(timeline.checkpoints.map((row) => row.timestampMs)).toEqual([
    0, 1001, 2124,
  ]);
  const before = timeline.checkpoints.findLast(
    (row) => row.timestampMs <= 1000,
  );
  const inclusive = timeline.checkpoints.findLast(
    (row) => row.timestampMs <= 1001,
  );
  expect(before?.kda[0]).toEqual({ kills: 0, deaths: 0, assists: 0 });
  expect(inclusive?.kda[0]).toEqual({ kills: 1, deaths: 0, assists: 0 });
  expect(inclusive?.kda[1]).toEqual({ kills: 0, deaths: 0, assists: 1 });
  expect(inclusive?.kda[5]).toEqual({ kills: 0, deaths: 1, assists: 0 });
  expect(timeline.checkpoints.at(-1)?.kda[0]).toEqual({
    kills: 2,
    deaths: 0,
    assists: 0,
  });
  expect(
    timeline.checkpoints.every(
      (row) =>
        row.kda.length === 10 && row.kda[8] === null && row.kda[9] === null,
    ),
  ).toBe(true);
});

test("an event-free replay retains a zero checkpoint and independent nullable slots", () => {
  const input = observations();
  input.binding.events = [];
  input.binding.assists = [];
  input.binding.assistEvents = 0;
  const timeline = createReplayObservationKdaTimeline(input);
  expect(timeline.checkpoints).toHaveLength(1);
  expect(timeline.checkpoints[0]?.timestampMs).toBe(0);
  expect(timeline.checkpoints[0]?.kda[0]).toEqual({
    kills: 0,
    deaths: 0,
    assists: 0,
  });
  expect(timeline.checkpoints[0]?.kda[8]).toBeNull();
});

test("snapshot counts cannot mutate other checkpoints and invalid binding/events fail", () => {
  const timeline = createReplayObservationKdaTimeline(observations());
  const initial = timeline.checkpoints[0]?.kda[0];
  if (initial === undefined || initial === null)
    throw new Error("Missing test actor");
  initial.kills = 99;
  expect(timeline.checkpoints[1]?.kda[0]?.kills).toBe(1);
  const invalid = observations();
  const actor = invalid.binding.verified[0];
  if (actor === undefined) throw new Error("Missing test binding");
  actor.footerRow = 6;
  expect(() => createReplayObservationKdaTimeline(invalid)).toThrow("binding");
  const outside = observations();
  const event = outside.binding.events[0];
  if (event === undefined) throw new Error("Missing test event");
  event.timeSeconds = 11;
  expect(() => createReplayObservationKdaTimeline(outside)).toThrow(
    "K/D/A event",
  );
});
