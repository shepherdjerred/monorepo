import { expect, test } from "bun:test";
import {
  sampleExactTeamMask,
  sampleExactTeamVisibility,
} from "./exact-team-visibility.mjs";

test("samples both sides at exact archived transitions and after a backward seek", () => {
  const gain = 33.054532485961914;
  const loss = 37.764532485961915;
  const changes = [
    [0, 2],
    [gain, 6],
    [loss, 2],
  ];
  expect(sampleExactTeamVisibility(changes, loss, 200)).toBe(false);
  expect(sampleExactTeamVisibility(changes, gain, 200)).toBe(true);
  expect(sampleExactTeamVisibility(changes, gain - 0.001, 200)).toBe(false);
  expect(sampleExactTeamVisibility(changes, loss, 100)).toBe(true);
  expect(sampleExactTeamMask(changes, loss - 0.001)).toBe(6);
});

test("distinguishes a zero mask from an absent or uninitialized track", () => {
  const changes = [
    [2, 0],
    [3, 4],
  ];
  expect(sampleExactTeamMask(undefined, 100)).toBeNull();
  expect(sampleExactTeamMask(changes, 1.999)).toBeNull();
  expect(sampleExactTeamMask(changes, 2)).toBe(0);
  expect(sampleExactTeamVisibility(changes, 2, 200)).toBe(false);
  expect(sampleExactTeamVisibility(changes, 3, 200)).toBe(true);
  expect(() => sampleExactTeamMask(changes, Number.NaN)).toThrow(
    "Expected a finite team visibility clock",
  );
});
