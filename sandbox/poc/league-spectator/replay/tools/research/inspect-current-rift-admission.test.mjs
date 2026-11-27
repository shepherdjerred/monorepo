import assert from "node:assert/strict";
import test from "node:test";
import { selectCurrentArchivedOpeningSkins } from "./inspect-current-rift-admission.mjs";
import {
  championArchiveExecutableHashes,
  currentChampionBuild,
} from "./native-terrain-champion-model-catalog.mjs";

const census = {
  schema: 1,
  kind: "exact-native-terrain-archived-skin-census",
  build: currentChampionBuild,
  protocol: "8bbfcd5af2bc92db",
  installedExeSha256: championArchiveExecutableHashes[currentChampionBuild],
  archiveRoots: [
    { champion: "Zeta", skins: [{ skinId: 0 }, { skinId: 3 }] },
    { champion: "Alpha", skins: [{ skinId: 0 }, { skinId: 7 }] },
  ],
};
const opening = Array.from({ length: 10 }, (_, index) => ({
  context: index + 1,
  ...(index === 0
    ? { champion: "zeta", skinId: 3 }
    : { champion: "Alpha", skinId: 7 }),
}));

test("emits a sorted build-only selection of the exact requested skins", () => {
  const selection = selectCurrentArchivedOpeningSkins(census, opening);
  assert.deepEqual(selection, {
    schema: 1,
    kind: "exact-native-terrain-skin-selection",
    build: currentChampionBuild,
    protocol: census.protocol,
    skins: [
      { champion: "Alpha", skinId: 7 },
      { champion: "Zeta", skinId: 3 },
    ],
  });
  assert.deepEqual(
    selectCurrentArchivedOpeningSkins(census, opening.toReversed()),
    selection,
  );
});

test("rejects unsupported archives, incomplete roster and missing or ambiguous skins", () => {
  assert.throws(
    () =>
      selectCurrentArchivedOpeningSkins(
        { ...census, installedExeSha256: "0".repeat(64) },
        opening,
      ),
    /exact current archived skin census/,
  );
  assert.throws(
    () => selectCurrentArchivedOpeningSkins(census, opening.slice(1)),
    /ten verified/,
  );
  assert.throws(
    () =>
      selectCurrentArchivedOpeningSkins(census, [
        opening[0],
        ...opening.slice(0, 9),
      ]),
    /distinct verified/,
  );
  assert.throws(
    () =>
      selectCurrentArchivedOpeningSkins(census, [
        { ...opening[0], skinId: 99 },
        ...opening.slice(1),
      ]),
    /Missing or ambiguous exact archived skin/,
  );
  const duplicate = structuredClone(census);
  duplicate.archiveRoots[0].skins.push({ skinId: 3 });
  assert.throws(
    () => selectCurrentArchivedOpeningSkins(duplicate, opening),
    /Missing or ambiguous exact archived skin/,
  );
});
