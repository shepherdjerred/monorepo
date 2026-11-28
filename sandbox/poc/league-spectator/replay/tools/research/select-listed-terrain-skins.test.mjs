import { expect, test } from "bun:test";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { championArchiveExecutableHashes } from "./native-terrain-champion-model-catalog.mjs";
import { selectListedTerrainSkins } from "./select-listed-terrain-skins.mjs";

const census = {
  schema: 1,
  kind: "exact-native-terrain-archived-skin-census",
  build: currentTerrainPositionBuild,
  protocol: terrainPositionProtocol,
  installedExeSha256:
    championArchiveExecutableHashes[currentTerrainPositionBuild],
  archiveRoots: [
    { champion: "tftchampion", skins: [{ skinId: 0 }] },
    { champion: "ashe", skins: [{ skinId: 0 }, { skinId: 7 }, { skinId: 9 }] },
    { champion: "aatrox", skins: [{ skinId: 0 }] },
  ],
};
const data = {
  type: "champion",
  format: "full",
  version: "16.23.1",
  data: {
    Ashe: { id: "Ashe", skins: [{ num: 7 }, { num: 0 }] },
    Aatrox: { id: "Aatrox", skins: [{ num: 0 }] },
  },
};

test("selects only Riot-listed archive keys and keeps canonical source names", () => {
  expect(selectListedTerrainSkins(census, data, false).skins).toEqual([
    { champion: "aatrox", skinId: 0 },
    { champion: "ashe", skinId: 0 },
    { champion: "ashe", skinId: 7 },
  ]);
  expect(selectListedTerrainSkins(census, data, true).skins).toEqual([
    { champion: "aatrox", skinId: 0 },
    { champion: "ashe", skinId: 0 },
  ]);
});

test("reports a missing catalog key even when exporting only default skins", () => {
  const changed = structuredClone(data);
  changed.data.Ashe.skins.push({ num: 12 });
  expect(() => selectListedTerrainSkins(census, changed, true)).toThrow(
    "Listed skin missing from archive: Ashe-12",
  );
});

test("rejects a mismatched Data Dragon patch", () => {
  expect(() =>
    selectListedTerrainSkins(census, { ...data, version: "16.22.1" }, false),
  ).toThrow("Data Dragon patch differs");
});
