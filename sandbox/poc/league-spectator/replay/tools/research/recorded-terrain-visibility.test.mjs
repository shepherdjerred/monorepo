import assert from "node:assert/strict";
import { test } from "bun:test";
import { validateRecordedTerrainVisibility } from "./recorded-terrain-visibility.mjs";

const unresolved = [0x6d9e7ec9, 0x76c50391];
const meshes = [0, 1, 1, ...unresolved].map((controller) => ({ controller }));
const receipt = {
  unboundRecordedNameHashes: [],
  unresolvedMeshControllerIds: unresolved,
  tracks: [
    {
      controllerId: 1,
      points: [
        [0, true],
        [60, false],
      ],
    },
  ],
  ordinaryWrites: [{ nameHash: "7067adc8", timeSeconds: 60, visible: false }],
};

test("accepts exactly one track per resolved exported Map11 controller", () => {
  validateRecordedTerrainVisibility(receipt, meshes, 90);
  assert.throws(
    () =>
      validateRecordedTerrainVisibility({ ...receipt, tracks: [] }, meshes, 90),
    /Missing Map11 terrain tracks/u,
  );
  assert.throws(
    () =>
      validateRecordedTerrainVisibility(
        { ...receipt, tracks: [...receipt.tracks, ...receipt.tracks] },
        meshes,
        90,
      ),
    /Unexpected Map11 terrain track/u,
  );
});

test("rejects nonmonotonic terrain states and states after the replay", () => {
  assert.throws(
    () =>
      validateRecordedTerrainVisibility(
        {
          ...receipt,
          tracks: [
            {
              controllerId: 1,
              points: [
                [0, true],
                [0, false],
              ],
            },
          ],
        },
        meshes,
        90,
      ),
    /Invalid Map11 terrain track clock/u,
  );
  assert.throws(
    () => validateRecordedTerrainVisibility(receipt, meshes, 59),
    /Invalid Map11 terrain track clock/u,
  );
});

test("omits only explicitly unresolved controllers in a private package", () => {
  const allMeshes = [...meshes, { controller: 2 }];
  const omitted = [...unresolved, 2];
  const partial = { ...receipt, unresolvedMeshControllerIds: omitted };
  const options = { omitUnresolved: true };
  assert.deepEqual(
    validateRecordedTerrainVisibility(partial, allMeshes, 90, options),
    omitted,
  );
  assert.throws(() =>
    validateRecordedTerrainVisibility(partial, allMeshes, 90),
  );
  assert.throws(
    () => validateRecordedTerrainVisibility(partial, meshes, 90, options),
    /Unknown unresolved Map11 mesh controller/u,
  );
});

test("bounds animation gaps to tracked controllers and the replay clock", () => {
  const window = { controllerId: 1, startSeconds: 20, endSeconds: 30 };
  const partial = { ...receipt, unresolvedWindows: [window] };
  const options = { omitUnresolved: true };
  assert.deepEqual(
    validateRecordedTerrainVisibility(partial, meshes, 90, options),
    unresolved,
  );
  assert.throws(
    () => validateRecordedTerrainVisibility(partial, meshes, 90),
    /require explicit private admission/u,
  );
  for (const unresolvedWindows of [
    [window, { ...window, startSeconds: 25, endSeconds: 40 }],
    [{ ...window, controllerId: unresolved[0] }],
    [{ ...window, endSeconds: 91 }],
  ]) {
    assert.throws(
      () =>
        validateRecordedTerrainVisibility(
          { ...receipt, unresolvedWindows },
          meshes,
          90,
          options,
        ),
      /Invalid unresolved Map11 animation window/u,
    );
  }
});
