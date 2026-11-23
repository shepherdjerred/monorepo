import { expect, test } from "bun:test";
import { createReplayActorStateSampler } from "./replay-actor-state.mjs";

const level = (context, footerRow, level, timeSeconds) => ({
  kind: "actor-level",
  context,
  footerRow,
  level,
  timeSeconds,
});
const lifecycle = (kind, timeSeconds) => ({
  kind,
  context: 100,
  partition: 0,
  timeSeconds,
});
const fixture = {
  replay: {
    duration: 6,
    roster: Array.from({ length: 10 }, (_, i) => ({
      champion: `champion-${i}`,
    })),
  },
  binding: {
    verified: [{ context: 100, footerRow: 1 }],
    unresolved: Array.from({ length: 9 }, (_, i) => 101 + i),
    events: [
      lifecycle("champion-death", 1),
      lifecycle("champion-kill", 2),
      lifecycle("champion-death", 4),
    ],
    assists: [lifecycle("champion-assist", 2)],
  },
  levels: {
    initialLevel: 1,
    events: [
      level(101, null, 2, 0),
      level(101, null, 3, 0),
      level(100, 1, 2, 2),
    ],
  },
  returns: [lifecycle("champion-return", 3)],
};

test("samples inclusive boundaries, same-time levels, and terminal deaths", () => {
  const sample = createReplayActorStateSampler(fixture);
  expect(sample(0)[1]).toEqual({
    context: 101,
    partition: 0,
    footerRow: null,
    champion: null,
    level: 3,
    dead: false,
    kda: null,
  });
  expect(sample(0.999)[0].dead).toBe(false);
  expect(sample(1)[0].dead).toBe(true);
  expect(sample(2)[0]).toEqual({
    context: 100,
    partition: 0,
    footerRow: 1,
    champion: "champion-0",
    level: 2,
    dead: true,
    kda: { kills: 1, deaths: 1, assists: 1 },
  });
  expect(sample(3)[0].dead).toBe(false);
  expect(sample(4)[0].dead).toBe(true);
  expect(sample(6)[0].dead).toBe(true);
  expect(sample(0)[0].level).toBe(1);
  expect(sample(0)[0].dead).toBe(false);
});

test("K/D/A includes the whole exact-time cohort and rewinds without retaining counts", () => {
  const sample = createReplayActorStateSampler(fixture);
  expect(sample(6)[0].kda).toEqual({ kills: 1, deaths: 2, assists: 1 });
  expect(sample(1.999999)[0].kda).toEqual({ kills: 0, deaths: 1, assists: 0 });
  expect(sample(2)[0].kda).toEqual({ kills: 1, deaths: 1, assists: 1 });
  expect(sample(0)[0].kda).toEqual({ kills: 0, deaths: 0, assists: 0 });
  expect(sample(6)[1].kda).toBeNull();
});

test("rejects missing return evidence, inconsistent events, and invalid sample times", () => {
  expect(() =>
    createReplayActorStateSampler({ ...fixture, returns: null }),
  ).toThrow("verified level and return evidence");
  expect(() =>
    createReplayActorStateSampler({ ...fixture, returns: [] }),
  ).toThrow("does not alternate");
  expect(() =>
    createReplayActorStateSampler({
      ...fixture,
      returns: [lifecycle("champion-return", 1)],
    }),
  ).toThrow("does not alternate");
  expect(() =>
    createReplayActorStateSampler({
      ...fixture,
      levels: { initialLevel: 1, events: [level(101, 2, 2, 0)] },
    }),
  ).toThrow("level transition");
  const sample = createReplayActorStateSampler(fixture);
  for (const time of [-1, 6.1, NaN])
    expect(() => sample(time)).toThrow("outside the recorded replay");
});
