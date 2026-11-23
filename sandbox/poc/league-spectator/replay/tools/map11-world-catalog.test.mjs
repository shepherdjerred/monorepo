import { expect, test } from "bun:test";
import { mapBinHash as hash } from "./map-scene-assets.mjs";
import {
  readMap11PlaceableInventory,
  bindMap11BarracksDefinitions,
  selectMap11RecordedRegistry,
} from "./map11-world-catalog.mjs";

const scalar = (type, value) => ({ type, value });
const structure = (fields) => ({
  type: "Struct",
  classHash: "ad65d8c4",
  fields: Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [hash(name), value]),
  ),
});
const matrix = scalar(
  "Matrix44",
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 50, 200, 1],
);
function fixture() {
  const tower = structure({
    name: scalar("Hash", 200),
    transform: matrix,
    AttackableUnit: structure({ type: scalar("U16", 0) }),
    Team: structure({ Team: scalar("U32", 200) }),
    Character: structure({
      Skin: scalar("String", "Characters/Turret/Skins/Skin3"),
      CharacterRecord: scalar(
        "String",
        "Characters/Turret/CharacterRecords/SR_Outer",
      ),
    }),
  });
  const barracks = structure({
    name: scalar("Hash", 201),
    transform: matrix,
    Barracks: structure({ BarracksConfig: scalar("Hash", 999) }),
  });
  return {
    reader: "scout-exact-property-bin-16.21",
    build: "16.21.829.8620",
    sourceSha256: "a".repeat(64),
    objects: [
      {
        pathHash: "11111111",
        classHash: hash("MapContainer"),
        fields: {
          [hash("chunks")]: {
            type: "Map",
            entries: [
              {
                key: scalar("Hash", 1),
                value: scalar("ObjectLink", 0x22222222),
              },
            ],
          },
        },
      },
      {
        pathHash: "22222222",
        classHash: hash("MapPlaceableContainer"),
        fields: {
          [hash("items")]: {
            type: "Map",
            entries: [
              { key: scalar("Hash", 20), value: tower },
              { key: scalar("Hash", 10), value: barracks },
            ],
          },
        },
      },
    ],
  };
}

test("preserves authored map identities, matrix/team fields and ordered registration candidates", () => {
  const output = readMap11PlaceableInventory(fixture(), "11111111");
  expect(output.registration.map((entry) => entry.keyHash)).toEqual([10, 20]);
  expect(output.placeables[200]).toMatchObject({
    asset: "turret/3",
    attackableType: 0,
    explicitTeam: 200,
    transform: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [100, 50, 200, 1],
    ],
  });
  expect(output.placeables[201]).toMatchObject({
    kind: "barracks",
    configs: ["{000003e7}"],
    units: {},
    explicitTeam: null,
  });
  expect(output.assetRequests).toEqual([
    {
      character: "Turret",
      skinId: 3,
      records: ["Characters/Turret/CharacterRecords/SR_Outer"],
    },
  ]);
  expect(output.spectatorAdmission).toBe(false);
});

test("rejects missing chunk links, duplicate identities and malformed authored transforms", () => {
  const missing = fixture();
  missing.objects.pop();
  expect(() => readMap11PlaceableInventory(missing, "11111111")).toThrow(
    "Missing or repeated original map chunk",
  );
  const duplicate = fixture();
  duplicate.objects[1].fields[hash("items")].entries[1].key.value = 20;
  expect(() => readMap11PlaceableInventory(duplicate, "11111111")).toThrow(
    "Duplicate original world registration",
  );
  const malformed = fixture();
  malformed.objects[1].fields[hash("items")].entries[0].value.fields[
    hash("transform")
  ] = scalar("Matrix44", [NaN]);
  expect(() => readMap11PlaceableInventory(malformed, "11111111")).toThrow(
    "Finite original placeable transform",
  );
});

test("keeps unknown attackable type fields unclassified and rejects mismatched skin records", () => {
  const tree = fixture(),
    node = tree.objects[1].fields[hash("items")].entries[0].value;
  delete node.fields[hash("AttackableUnit")].fields[hash("type")];
  expect(
    readMap11PlaceableInventory(tree, "11111111").placeables[200]
      .attackableType,
  ).toBeNull();
  node.fields[hash("Character")].fields[hash("CharacterRecord")].value =
    "Characters/Other/CharacterRecords/Root";
  expect(() => readMap11PlaceableInventory(tree, "11111111")).toThrow(
    "references disagree",
  );
});

function definitions() {
  return {
    reader: "scout-exact-property-bin-16.21",
    build: "16.21.829.8620",
    sourceSha256: "b".repeat(64),
    objects: [
      {
        pathHash: "000003e7",
        classHash: hash("BarracksConfig"),
        fields: {
          [hash("units")]: {
            type: "UnorderedContainer",
            elements: [
              structure({
                MinionType: scalar("U8", 4),
                "{fee040bc}": scalar("ObjectLink", 7),
              }),
            ],
          },
        },
      },
      {
        pathHash: "00000007",
        ...structure({
          Character: structure({
            Skin: scalar(
              "String",
              "Characters/SRU_OrderMinionMelee/Skins/Skin0",
            ),
            CharacterRecord: scalar(
              "String",
              "Characters/SRU_OrderMinionMelee/CharacterRecords/Root",
            ),
          }),
        }),
      },
    ],
  };
}

test("resolves original barracks configuration/unit/character links without guessing minion assets", () => {
  const source = definitions();
  // This property has no established human-readable spelling; preserve its hash.
  const unit = source.objects[0].fields[hash("units")].elements[0];
  unit.fields.fee040bc = unit.fields[hash("{fee040bc}")];
  delete unit.fields[hash("{fee040bc}")];
  const inventory = readMap11PlaceableInventory(fixture(), "11111111");
  const bound = bindMap11BarracksDefinitions(inventory, source);
  expect(bound.registration[0].units[4]).toEqual({
    asset: "sru_orderminionmelee/0",
    records: [
      {
        config: "{000003e7}",
        characterRecord:
          "Characters/SRU_OrderMinionMelee/CharacterRecords/Root",
      },
    ],
  });
  expect(bound.mapDefinitionSha256).toBe(source.sourceSha256);
  expect(inventory.registration[0].units).toEqual({});
  source.objects[0].fields[hash("units")].elements.push(structuredClone(unit));
  expect(() => bindMap11BarracksDefinitions(inventory, source)).toThrow(
    "Ambiguous duplicate",
  );
  source.objects[0].fields[hash("units")].elements = [unit];
  unit.fields.fee040bc.value = 8;
  expect(() => bindMap11BarracksDefinitions(inventory, source)).toThrow(
    "Original Skin/String",
  );
});

test("selects one authored chunk only when all recorded tower ordinals and minion references agree", () => {
  const inventory = readMap11PlaceableInventory(fixture(), "11111111");
  inventory.mapDefinitionSha256 = "b".repeat(64);
  inventory.registration[0].units[4] = {
    asset: "original-minion/0",
    records: [{ characterRecord: "Original/Record" }],
  };
  const tower = {
    ...structuredClone(inventory.registration[1]),
    keyHash: 30,
    mapNameHash: 202,
  };
  inventory.registration.push(tower);
  inventory.registration.push({
    keyHash: 15,
    mapNameHash: 999,
    sourceChunk: "other",
    attackableType: 4,
  });
  inventory.registration.sort((a, b) => a.keyHash - b.keyHash);
  const report = {
    build: inventory.build,
    protocol: "20e09df23c66b85e",
    startup: { configuredMapId: 11, mode: "CLASSIC" },
    worldEvents: [
      {
        kind: "building-identity-candidate",
        entityId: 101,
        mapNameHash: 200,
        time: 0,
        stream: 2,
        team: 200,
      },
      {
        kind: "building-identity-candidate",
        entityId: 102,
        mapNameHash: 202,
        time: 0,
        stream: 2,
        team: 200,
      },
      {
        kind: "lane-minion-creation-candidate",
        entityId: 999,
        barracksId: 100,
        unitType: 4,
        time: 30,
      },
    ],
  };
  const selected = selectMap11RecordedRegistry(report, inventory);
  expect(selected.registration).toHaveLength(3);
  expect(selected.registrationBase).toBe(100);
  expect(selected.minions[0]).toMatchObject({
    asset: "original-minion/0",
    creationPosition: [100, 50, 200],
  });
  expect(selected.nativeInitializerExecuted).toBe(false);
  report.worldEvents[1].entityId++;
  expect(() => selectMap11RecordedRegistry(report, inventory)).toThrow(
    "contradict",
  );
  report.worldEvents[1].entityId--;
  report.worldEvents[2].barracksId = 101;
  expect(() => selectMap11RecordedRegistry(report, inventory)).toThrow(
    "barracks/unit",
  );
});
