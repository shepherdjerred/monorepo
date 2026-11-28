import assert from "node:assert/strict";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash as hash } from "../map-scene-assets.mjs";
import { exportNativeTerrainStructureModels } from "../native-terrain-structure-model-export.mjs";
import { openLocalWad } from "../wad.mjs";

export const mayhemLaneMaterialsSha256 =
  "edda022b5e925b62ccf05430623e339873cb06a67e7a6ef02764a5a3552f683b";
export const mayhemLaneMapSha256 =
  "b0734c4fee0360593108147bb8ab62525607debff30c1eb17c60859009c5a57d";

const field = (node, name) => node.fields[hash(name)];
const hex = (value) => value.toString(16).padStart(8, "0");
const variants = ["melee", "ranged", "siege", "super"];
const archive = "DATA/FINAL/Maps/Shipping/Map12.wad.client";
const skinDigests = {
  ha_orderminionmelee:
    "433b65c300bf78c560b18e87dad84457ea3f0119fbbc538b68a066df8eb2b086",
  ha_orderminionranged:
    "108258647e06f88ff77b868329b8e4376086cd672632202e57f62fd85dc3a6af",
  ha_orderminionsiege:
    "30b062bc99e5bb19bc9105760cf17af8fa4bfde1ec511a80216811eac0cfc86f",
  ha_orderminionsuper:
    "836e3d46c76051d5a47f818cbd86ee95ce67982b7aa4d42c3ad2c254d45ada1f",
  ha_chaosminionmelee:
    "ffe8728d39630706e46bcda039231a8d13348be3c6f5874cd7c5186606b3b400",
  ha_chaosminionranged:
    "08c2db6a196ebe14c2283a9f696c47480a414e8561f71ca73ab15aae60d89514",
  ha_chaosminionsiege:
    "584a3783eb9189d9ae708dd4c6b6ed63b62202a64101c2e6edfdf3191898ae2a",
  ha_chaosminionsuper:
    "0039fdc05c2d182dd8bb4020e48494ad13ff76270bc1735af8f06088f6d812be",
};
const digest = (value) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

export function readMayhemLaneBarracks(materialsBytes, mapBytes) {
  const materials = readExactMapBin(materialsBytes);
  const map = readExactMapBin(mapBytes);
  assert.equal(materials.sourceSha256, mayhemLaneMaterialsSha256);
  assert.equal(map.sourceSha256, mayhemLaneMapSha256);
  const skin = map.objects.find(
    ({ pathHash }) => pathHash === hash("Maps/Shipping/Map12/MapSkins/Bloom"),
  );
  assert.equal(skin?.classHash, hash("MapSkin"));
  const containerName = field(skin, "mMapContainerLink").value;
  const nodes = new Map(materials.objects.map((node) => [node.pathHash, node]));
  const container = nodes.get(hash(containerName));
  assert.equal(container?.classHash, hash("MapContainer"));
  const definitions = new Map(map.objects.map((node) => [node.pathHash, node]));
  const placements = [];
  for (const { value } of field(container, "chunks").entries) {
    const chunk = nodes.get(hex(value.value));
    assert.equal(chunk?.classHash, hash("MapPlaceableContainer"));
    for (const item of field(chunk, "items")?.entries ?? []) {
      const barracks = field(item.value, "Barracks");
      if (barracks === undefined) continue;
      const overrides = barracks.fields["45403ae3"].entries.filter(
        ({ key }) => key.value === "KIWI",
      );
      assert.equal(overrides.length, 1);
      const config = definitions.get(hex(overrides[0].value.value));
      assert.equal(config?.classHash, hash("BarracksConfig"));
      const units = {};
      for (const row of field(config, "units").elements) {
        const type = field(row, "MinionType").value;
        const character = field(
          definitions.get(hex(row.fields.fee040bc.value)),
          "Character",
        );
        const skinName = field(character, "Skin").value;
        const recordName = field(character, "CharacterRecord").value;
        const name =
          /^Characters\/(HA_(Order|Chaos)Minion(Melee|Ranged|Siege|Super))\/Skins\/Skin0$/u.exec(
            skinName,
          );
        assert.ok(name);
        const [, champion, team, variant] = name;
        assert.equal(variant.toLowerCase(), variants[type - 4]);
        assert.equal(
          recordName,
          `Characters/${champion}/CharacterRecords/${type === 7 ? "Root" : `Kiwi_${team}Minion${variant}`}`,
        );
        assert.equal(units[type], undefined);
        units[type] = { asset: champion.toLowerCase() + "/0" };
      }
      assert.equal(Object.keys(units).length, 4);
      const transform = field(item.value, "transform").value;
      placements.push({
        transform: [0, 4, 8, 12].map((start) =>
          transform.slice(start, start + 4),
        ),
        units,
      });
    }
  }
  assert.equal(placements.length, 2);
  return placements;
}

export function verifyMayhemLaneCatalog(catalog) {
  assert.equal(catalog.kind, "mayhem-bloom-lane-minion-catalog");
  assert.equal(catalog.materialsSha256, mayhemLaneMaterialsSha256);
  assert.equal(catalog.mapSha256, mayhemLaneMapSha256);
  assert.equal(
    digest(JSON.stringify(catalog.barracksPlacements)),
    "130210f73735547fdca96dc91c6b653e3cbfeb2db4623c8b1c138829edaa59fd",
  );
  assert.deepEqual(
    Object.keys(catalog.assets).sort(),
    Object.keys(skinDigests)
      .map((id) => id + "-0")
      .sort(),
  );
  for (const [modelId, skinSha256] of Object.entries(skinDigests)) {
    const row = catalog.assets[modelId + "-0"];
    assert.equal(row.skinId, 0);
    assert.equal(row.inputs.skin.archive, archive);
    assert.equal(
      row.inputs.skin.file,
      `data/characters/${modelId}/skins/skin0.bin`,
    );
    assert.equal(row.inputs.skin.sha256, skinSha256);
    assert.equal(row.model.file, `${modelId}-0/model.glb`);
    assert.match(row.model.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isFinite(row.skinScale) && row.skinScale > 0);
  }
}

if (import.meta.main) {
  const [installation, exporter, output, ...extra] = Bun.argv.slice(2);
  assert.ok(
    output && extra.length === 0,
    "Usage: bun mayhem-lane-minion-catalog.mjs <installation> <ordinal exporter directory> <new private output directory>",
  );
  const destination = resolve(output);
  const cache = await realpath(".cache");
  const parent = await realpath(dirname(destination));
  assert.ok(parent === cache || parent.startsWith(cache + sep));
  const wad = await openLocalWad(installation, archive, Bun.zstdDecompressSync);
  const barracksPlacements = readMayhemLaneBarracks(
    await wad("data/maps/mapgeometry/map12/bloom.materials.bin"),
    await wad("data/maps/shipping/map12/map12.bin"),
  );
  const skins = Object.keys(skinDigests).map((character) => ({
    character,
    skinId: 0,
  }));
  for (const { character } of skins) {
    assert.equal(
      digest(await wad(`data/characters/${character}/skins/skin0.bin`)),
      skinDigests[character],
    );
  }
  const models = await exportNativeTerrainStructureModels({
    archive,
    destination,
    exporter,
    wad,
    skins,
    requireHiddenRanges: false,
  });
  const catalog = {
    kind: "mayhem-bloom-lane-minion-catalog",
    materialsSha256: mayhemLaneMaterialsSha256,
    mapSha256: mayhemLaneMapSha256,
    barracksPlacements,
    ...models,
  };
  verifyMayhemLaneCatalog(catalog);
  const outputBytes = JSON.stringify(catalog);
  await writeFile(resolve(destination, "manifest.json"), outputBytes, {
    flag: "wx",
  });
  console.log(digest(outputBytes));
}
