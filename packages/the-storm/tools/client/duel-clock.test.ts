import { expect, test } from "vitest";
import wire from "#client-duel-clock-wire";
import { validateDuelClock } from "./duel-clock.ts";

function fixture() {
  const base = wire.golden.packet;
  return {
    schema: 1,
    kind: "rwf-native-duel-clock",
    acceptance: "unaccepted",
    source: "paper-custom-payload",
    expected: {
      seed: base.seed,
      side: base.side,
      mode: base.mode,
      opponent: base.opponent,
    },
    complete: true,
    error: "",
    entries: [
      {
        marker: {
          ...base,
          marker: "begin",
          sequence: 0,
          tick: -1,
          elapsed: -1,
          result: "waiting",
        },
        receivedElapsedNanos: 0,
      },
      { marker: { ...base }, receivedElapsedNanos: 50_000_000 },
      {
        marker: { ...base, marker: "terminal", sequence: 2, result: "loss" },
        receivedElapsedNanos: 50_000_000,
      },
    ],
  };
}

test("retains an early loss on the same native tick", () => {
  const receipt = validateDuelClock(fixture());
  expect(receipt.entries).toHaveLength(3);
  expect(receipt.entries.at(-1)?.marker.result).toBe("loss");
});

test("rejects missing, duplicate, stale and foreign markers", () => {
  const missing = fixture();
  missing.entries.splice(1, 1);
  expect(() => validateDuelClock(missing)).toThrow();
  const duplicate = fixture();
  const begin = duplicate.entries[0];
  if (begin === undefined) throw new Error("Missing fixture begin marker");
  duplicate.entries.splice(1, 0, begin);
  expect(() => validateDuelClock(duplicate)).toThrow();
  const changed = fixture();
  const tick = changed.entries[1];
  if (tick === undefined) throw new Error("Missing fixture tick marker");
  tick.marker.seed++;
  expect(() => validateDuelClock(changed)).toThrow("identity");
});

test("rejects receiver, native and terminal clock changes", () => {
  const changed = fixture();
  const last = changed.entries.at(-1);
  if (last === undefined) throw new Error("Missing fixture terminal marker");
  last.receivedElapsedNanos = 1;
  expect(() => validateDuelClock(changed)).toThrow("backwards");
  last.receivedElapsedNanos = 50_000_001;
  last.marker.tick++;
  expect(() => validateDuelClock(changed)).toThrow("terminal clock");
});

test("failed and incomplete journals cannot become native clock evidence", () => {
  expect(() => validateDuelClock({ ...fixture(), complete: false })).toThrow();
  expect(() =>
    validateDuelClock({ ...fixture(), error: "observer disconnected" }),
  ).toThrow();
  const changed = fixture();
  changed.entries.pop();
  expect(() => validateDuelClock(changed)).toThrow("terminal marker");
});
