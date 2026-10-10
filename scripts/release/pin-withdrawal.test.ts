import { expect, test } from "vitest";
import {
  mergePinCandidates,
  mergePinStates,
  retainCurrentImagePins,
  serializePinCandidatesState,
} from "../lib/pin-candidates.ts";
import {
  parsePinCandidatesState,
  validateStateAgainstVersions,
  type PinCandidatesState,
} from "../lib/pin-candidates-schema.ts";

const key = "shepherdjerred/temporal-worker/workflows/candidate";
const digest = `sha256:${"a".repeat(64)}`;
const empty: PinCandidatesState = {
  schema: "pin-candidates-state/v1",
  pins: {},
};
const withdrawn: PinCandidatesState = {
  ...empty,
  withdrawnCandidates: { [key]: 200 },
};
const pin = (build: number) => ({
  version: `2.0.0-${build.toString()}`,
  digest,
  buildNumber: build,
});

test("withdrawals round-trip without changing the original state format", () => {
  expect(parsePinCandidatesState(serializePinCandidatesState(empty))).toEqual(
    empty,
  );
  expect(
    parsePinCandidatesState(serializePinCandidatesState(withdrawn)),
  ).toEqual(withdrawn);
});

test("late batches cannot restore a withdrawn candidate, but newer builds can", () => {
  for (const buildNumber of [199, 200, 201]) {
    const result = mergePinCandidates(withdrawn, {
      schema: "pin-candidates/v1",
      buildNumber,
      candidates: {
        [key]: { version: `2.0.0-${buildNumber.toString()}`, digest },
      },
    });
    expect(result.withdrawnCandidates).toEqual(withdrawn.withdrawnCandidates);
    expect(result.pins[key]).toEqual(
      buildNumber > 200 ? pin(buildNumber) : undefined,
    );
  }
});

test("pending branches retain the strongest withdrawal and discard stale candidate pins", () => {
  const pending = {
    ...empty,
    pins: { [key]: pin(200) },
    withdrawnCandidates: { [key]: 100 },
  };
  const result = mergePinStates(withdrawn, pending, empty);
  expect(result).toEqual(withdrawn);
  const newer = mergePinStates(
    withdrawn,
    { ...empty, pins: { [key]: pin(201) } },
    empty,
  );
  expect(newer.pins[key]).toEqual(pin(201));
  expect(newer.withdrawnCandidates).toEqual(withdrawn.withdrawnCandidates);
});

test("withdrawals survive promotion and ordinary catalog merges", () => {
  const result = mergePinStates(empty, empty, withdrawn);
  expect(result.withdrawnCandidates).toEqual(withdrawn.withdrawnCandidates);
  expect(
    mergePinCandidates(withdrawn, {
      schema: "pin-candidates/v1",
      buildNumber: 300,
      candidates: {},
    }),
  ).toEqual(withdrawn);
});

test("withdrawals validate their target and cannot coexist with a rejected pin", () => {
  expect(() => validateStateAgainstVersions(withdrawn, new Map())).toThrow(
    "unknown image key",
  );
  expect(() =>
    validateStateAgainstVersions(
      { ...withdrawn, pins: { [key]: pin(200) } },
      new Map([[key, `2.0.0-200@${digest}`]]),
    ),
  ).toThrow("withdrawn candidate remains");
  expect(() =>
    validateStateAgainstVersions(
      withdrawn,
      new Map([[key, `2.0.0-100@${digest}`]]),
    ),
  ).not.toThrow();
});

test("retired candidate keys remove their withdrawal metadata", () => {
  expect(
    retainCurrentImagePins(withdrawn, new Map()).state.withdrawnCandidates,
  ).toEqual({});
});

test.each([0, -1, 1.5])("invalid withdrawal number %s fails", (build) => {
  expect(() =>
    parsePinCandidatesState(
      JSON.stringify({ ...empty, withdrawnCandidates: { [key]: build } }),
    ),
  ).toThrow();
});
