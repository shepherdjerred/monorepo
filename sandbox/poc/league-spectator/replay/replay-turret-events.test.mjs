import { expect, test } from "bun:test";
import {
  createReplayTurretObserver,
  ReplayTurretValidationError,
  verifyTurretDestructions,
} from "./replay-turret-events.mjs";

const binding = { verified: [{ context: 34, footerRow: 1 }], unresolved: [35] };
const first = { context: 56, timeSeconds: 10, secondTimeBits: 70 };
const second = { context: 76, timeSeconds: 14, secondTimeBits: 74 };
const notices = new Set([70, 74]);
const deaths = new Map([
  [56, new Set([70])],
  [76, new Set([74])],
]);

test("types expected evidence failures without converting malformed JSON", () => {
  expect(() =>
    createReplayTurretObserver({
      build: "16.23.840.6596",
      protocol: "8bbfcd5af2bc92db",
    }),
  ).toThrow(ReplayTurretValidationError);
  const replay = {
    build: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
    end: 0,
    bytes: new Uint8Array(260),
  };
  expect(() => createReplayTurretObserver(replay)).toThrow(SyntaxError);
  expect(() =>
    verifyTurretDestructions([first], notices, deaths, binding, 2, 20),
  ).toThrow(ReplayTurretValidationError);
});

test("requires a global notice and same-context death on the exact recorded clock", () => {
  expect(
    verifyTurretDestructions([first, second], notices, deaths, binding, 2, 20),
  ).toEqual([
    { kind: "turret-destruction", ...first },
    { kind: "turret-destruction", ...second },
  ]);
  expect(
    verifyTurretDestructions([], new Set(), new Map(), binding, 0, 20),
  ).toEqual([]);
});

test("rejects missing counts, shifted clocks, repeated structures and champion contexts", () => {
  const run = (candidate, changed = notices, witness = deaths) =>
    verifyTurretDestructions(candidate, changed, witness, binding, 2, 20);
  expect(() => run([first])).toThrow("differ from the footer losses");
  expect(() => run([first, second], new Set([71, 74]))).toThrow(
    "distinct corroborated context and clock",
  );
  expect(() =>
    run(
      [first, second],
      notices,
      new Map([
        [56, new Set([70])],
        [77, new Set([74])],
      ]),
    ),
  ).toThrow("distinct corroborated context and clock");
  expect(() =>
    run(
      [first, { ...second, context: 56 }],
      notices,
      new Map([[56, new Set([70, 74])]]),
    ),
  ).toThrow("distinct corroborated context and clock");
  expect(() =>
    run(
      [{ ...first, context: 35 }, second],
      notices,
      new Map([...deaths, [35, new Set([70])]]),
    ),
  ).toThrow("distinct corroborated context and clock");
});
