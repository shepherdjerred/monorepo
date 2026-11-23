import { expect, test } from "bun:test";
import {
  directCheckpointAtOrBefore,
  retainDirectCheckpoint,
} from "./latest-direct-checkpoint-cache.mjs";

test("bounded handles cover distant history and remain sorted after reverse branches", () => {
  let cache = [];
  const snapshots = new Map();
  for (let time = 2; time <= 3022; time += 2) {
    const saved = { time, tick: time * 60, cursor: time, privatePayload: {} };
    snapshots.set(time, saved);
    cache = retainDirectCheckpoint(cache, saved, 16);
    expect(cache.length).toBeLessThanOrEqual(16);
  }
  expect(cache[0]).toBe(snapshots.get(2));
  expect(cache.at(-1)).toBe(snapshots.get(3022));
  for (const target of [60, 1500, 2900]) {
    const saved = directCheckpointAtOrBefore(cache, target);
    expect(saved.time).toBeLessThanOrEqual(target);
    expect(target - saved.time).toBeLessThanOrEqual(256);
    expect(saved).toBe(snapshots.get(saved.time));
  }
  for (const time of [60, 40, 80, 20, 100]) {
    const saved = snapshots.get(time);
    cache = retainDirectCheckpoint(cache, saved, 16);
    const closest = directCheckpointAtOrBefore(cache, time);
    expect(closest.time).toBeLessThanOrEqual(time);
    expect(time - closest.time).toBeLessThanOrEqual(256);
    expect(closest).toBe(snapshots.get(closest.time));
    expect(cache.map((row) => row.time)).toEqual(
      cache.map((row) => row.time).toSorted((a, b) => a - b),
    );
  }
  expect(directCheckpointAtOrBefore(cache, 0)).toBeNull();
});

test("same-time states preserve handle ownership and reject conflicting event schedules", () => {
  const first = { time: 2, tick: 119, cursor: 7 };
  const replacement = { ...first };
  const cache = retainDirectCheckpoint([], first, 2);
  const updated = retainDirectCheckpoint(cache, replacement, 2);
  expect(cache[0]).toBe(first);
  expect(updated).toHaveLength(1);
  expect(updated[0]).toBe(replacement);
  for (const changed of [{ tick: 120 }, { cursor: 8 }])
    expect(() =>
      retainDirectCheckpoint(cache, { ...first, ...changed }, 2),
    ).toThrow("Conflicting checkpoint schedule");
  for (const maximum of [0, 1.5, Infinity])
    expect(() => retainDirectCheckpoint(cache, first, maximum)).toThrow(
      "Bounded absolute-time",
    );
  expect(
    retainDirectCheckpoint(cache, { time: 4, tick: 240, cursor: 9 }, 1)[0].time,
  ).toBe(4);
});
