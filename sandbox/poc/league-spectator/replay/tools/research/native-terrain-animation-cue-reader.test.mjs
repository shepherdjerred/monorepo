import { expect, test } from "bun:test";
import {
  createCurrentChampionAnimationCueAccumulator,
  readCurrentAnimationCueRequest,
} from "./native-terrain-animation-cue-reader.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { supportsRecordedAnimationRequest } from "./recorded-animation-requests.mjs";

const substitution = Uint8Array.from({ length: 256 }, (_, byte) => byte);
const forward = Uint8Array.of(0xbe, 0xfb, 0xeb, 164, 148, 180, 116);

test.each([
  [Uint8Array.of(0xbe, 0xb9, 0xeb, 65, 51, 241, 113), 0],
  [forward, 16],
  [Uint8Array.of(0xbe, 0x3f, 0xeb, 23, 206, 31, 174), 0],
  [Uint8Array.of(0xbe, 0xb8, 0xeb, 65, 51, 241, 113), 32],
  [Uint8Array.of(0xbe, 0xfa, 0xeb, 164, 148, 180, 116), 48],
  [Uint8Array.of(0xbe, 0xbe, 0xeb, 23, 206, 31, 174), 32],
])("decodes compact opcode 669 string layouts", (body, flags) => {
  expect(readCurrentAnimationCueRequest(body, substitution)).toEqual({
    name: "ACB",
    rate: 1,
    flags,
  });
  expect(
    readCurrentAnimationCueRequest(body.subarray(0, -1), substitution),
  ).toBeNull();
  expect(
    readCurrentAnimationCueRequest(Uint8Array.of(...body, 0), substitution),
  ).toBeNull();
  const altered = body.slice();
  altered[2] = 0xea;
  expect(readCurrentAnimationCueRequest(altered, substitution)).toBeNull();
});

test("force-no-blend requests require the exact current build and default floats", () => {
  for (const flags of [32, 48]) {
    expect(
      supportsRecordedAnimationRequest(
        flags,
        "00000000",
        "00000000",
        currentTerrainPositionBuild,
      ),
    ).toBe(true);
    expect(
      supportsRecordedAnimationRequest(
        flags,
        "00000000",
        "00000000",
        terrainPositionBuild,
      ),
    ).toBe(false);
    expect(
      supportsRecordedAnimationRequest(
        flags,
        "40800000",
        "00000000",
        currentTerrainPositionBuild,
      ),
    ).toBe(false);
  }
  const unsupported = forward.slice();
  unsupported[1] = 0x3a;
  expect(readCurrentAnimationCueRequest(unsupported, substitution)).toBeNull();
});

const replay = {
  build: currentTerrainPositionBuild,
  protocol: terrainPositionProtocol,
  duration: 20,
};
const asset = {
  durationSeconds: 5,
  rig: "/rig",
  clip: "/clip",
  bindings: "/bindings",
};
const actor = { model: "/model", actions: new Map([["ACB", asset]]) };
const actors = new Map([
  [101, actor],
  [102, actor],
]);

test("clips against unsupported same-actor requests and the replay end", () => {
  const fold = createCurrentChampionAnimationCueAccumulator(
    replay,
    substitution,
    actors,
  );
  fold.observe(101, 1, forward);
  fold.observe(102, 2, forward);
  fold.observe(101, 3, Uint8Array.of(0));
  fold.observe(101, 18, forward);
  fold.observe(101, 18, forward);
  expect(
    fold
      .finish()
      .map(({ participantId, timeSeconds, endSeconds }) => [
        participantId,
        timeSeconds,
        endSeconds,
      ]),
  ).toEqual([
    [101, 1, 3],
    [102, 2, 7],
    [101, 18, 20],
  ]);
  expect(() => fold.observe(101, 17, forward)).toThrow(
    "Invalid champion animation request clock",
  );
});

test("requires an exact current replay", () => {
  expect(() =>
    createCurrentChampionAnimationCueAccumulator(
      { ...replay, build: "16.23.840.6595" },
      substitution,
      actors,
    ),
  ).toThrow("exact current");
  expect(() =>
    createCurrentChampionAnimationCueAccumulator(
      { ...replay, protocol: "" },
      substitution,
      actors,
    ),
  ).toThrow("exact current");
});
