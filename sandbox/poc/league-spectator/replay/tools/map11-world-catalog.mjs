import { mapBinHash } from "./map-scene-assets.mjs";

const hex = (value) => value.toString(16).padStart(8, "0");
const fail = (message) => {
  throw Error(message);
};
const property = (node, name) => node?.fields?.[mapBinHash(name)];
function scalar(node, name, type, optional = false) {
  const field = property(node, name);
  if (optional && field === undefined) return null;
  if (field?.type !== type) fail(`Original ${name}/${type} property required`);
  return field.value;
}
function uint(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    fail(`Unsigned original ${label} required`);
  return value;
}
function map(field, label) {
  if (field?.type !== "Map" || !Array.isArray(field.entries))
    fail(`Original ${label} map required`);
  return field.entries;
}

// This preserves authored registration candidates. A static placeable inventory
// never creates replay entities or approves the native map initializer order.
export function readMap11PlaceableInventory(tree, containerHash) {
  if (
    tree?.reader !== "scout-exact-property-bin-16.21" ||
    tree.build !== "16.21.829.8620" ||
    !/^[a-f0-9]{64}$/.test(tree.sourceSha256) ||
    !/^[a-f0-9]{8}$/.test(containerHash)
  )
    fail("Exact archived Map11 typed source required");
  const nodes = new Map();
  for (const node of tree.objects) {
    if (nodes.has(node.pathHash)) fail("Duplicate original object path");
    nodes.set(node.pathHash, node);
  }
  const container = nodes.get(containerHash);
  if (container?.classHash !== mapBinHash("MapContainer"))
    fail("Original map container required");
  const registration = [],
    requests = new Map(),
    placeables = {},
    keys = new Set(),
    chunks = new Set();
  for (const entry of map(property(container, "chunks"), "map chunks")) {
    if (entry.key.type !== "Hash" || entry.value.type !== "ObjectLink")
      fail("Original map chunk reference required");
    const path = hex(uint(entry.value.value, "chunk path")),
      chunk = nodes.get(path);
    if (
      chunks.has(path) ||
      chunk?.classHash !== mapBinHash("MapPlaceableContainer")
    )
      fail("Missing or repeated original map chunk");
    chunks.add(path);
    const items = property(chunk, "items");
    if (items === undefined) continue; // Authored empty chunks contain no items property.
    for (const item of map(items, "placeable items")) {
      const node = item.value,
        attackable = property(node, "AttackableUnit"),
        barracks = property(node, "Barracks");
      if (!attackable && !barracks) continue;
      if (
        item.key.type !== "Hash" ||
        node.type !== "Struct" ||
        (attackable && barracks)
      )
        fail("Ambiguous original world placeable");
      const key = uint(item.key.value, "placeable key"),
        name = uint(scalar(node, "name", "Hash"), "placeable name");
      if (keys.has(key) || Object.hasOwn(placeables, name))
        fail("Duplicate original world registration identity");
      keys.add(key);
      const matrix = scalar(node, "transform", "Matrix44");
      if (
        !Array.isArray(matrix) ||
        matrix.length !== 16 ||
        !matrix.every(Number.isFinite)
      )
        fail("Finite original placeable transform required");
      const teamNode = property(node, "Team"),
        explicitTeam = teamNode ? scalar(teamNode, "Team", "U32") : null;
      const characterNode = property(node, "Character");
      let asset = null,
        characterRecord = null;
      if (characterNode) {
        const skin = scalar(characterNode, "Skin", "String"),
          match = /^Characters\/([A-Za-z0-9_]+)\/Skins\/Skin(\d+)$/.exec(skin);
        characterRecord = scalar(characterNode, "CharacterRecord", "String");
        if (
          !match ||
          typeof characterRecord !== "string" ||
          !characterRecord.startsWith(
            `Characters/${match[1]}/CharacterRecords/`,
          )
        )
          fail("Original character and skin references disagree");
        const skinId = Number(match[2]);
        if (!Number.isSafeInteger(skinId))
          fail("Invalid original skin identity");
        asset = `${match[1].toLowerCase()}/${skinId}`;
        if (!requests.has(asset))
          requests.set(asset, {
            character: match[1],
            skinId,
            records: new Set(),
          });
        requests.get(asset).records.add(characterRecord);
      }
      const attackableType = attackable
        ? scalar(attackable, "type", "U16", true)
        : null;
      const record = {
        objectKey: `{${hex(key)}}`,
        keyHash: key,
        mapNameHash: name,
        sourceChunk: `{${path}}`,
        classHash: node.classHash,
        kind: barracks ? "barracks" : "building",
        attackableType,
        asset,
        characterRecord,
        explicitTeam,
        transform: Array.from({ length: 4 }, (_, index) =>
          matrix.slice(index * 4, index * 4 + 4),
        ),
      };
      if (barracks) {
        const primary = property(barracks, "BarracksConfig");
        if (primary?.type !== "Hash")
          fail("Original barracks configuration hash required");
        record.configs = [`{${hex(uint(primary.value, "barracks config"))}}`];
        record.units = {}; // Filled only by the original map-definition producer.
        record.originalBarracksFields = structuredClone(barracks.fields);
      }
      placeables[name] = record;
      registration.push(record);
    }
  }
  if (!registration.length)
    fail("Original Map11 has no authored world placeables");
  return {
    schema: 1,
    kind: "archived-map11-placeable-inventory",
    build: tree.build,
    sourceSha256: tree.sourceSha256,
    containerHash,
    chunkCount: chunks.size,
    placeables,
    registration: registration.sort((a, b) => a.keyHash - b.keyHash),
    assetRequests: [...requests.values()].map((request) => ({
      ...request,
      records: [...request.records].sort(),
    })),
    registrationStatus:
      "Authored ascending-key candidate; native initializer and recorded anchors must agree before replay binding",
    spectatorAdmission: false,
  };
}

export function bindMap11BarracksDefinitions(inventory, definitions) {
  if (
    inventory?.kind !== "archived-map11-placeable-inventory" ||
    definitions?.reader !== "scout-exact-property-bin-16.21" ||
    definitions.build !== inventory.build ||
    !/^[a-f0-9]{64}$/.test(definitions.sourceSha256)
  )
    fail("Original Map11 placeables and matching map definitions required");
  const result = structuredClone(inventory),
    nodes = new Map(),
    requests = new Map(
      result.assetRequests.map((request) => [
        `${request.character.toLowerCase()}/${request.skinId}`,
        request,
      ]),
    );
  for (const node of definitions.objects) {
    if (nodes.has(node.pathHash))
      fail("Duplicate original map-definition path");
    nodes.set(node.pathHash, node);
  }
  for (const entry of result.registration.filter(
    (entry) => entry.kind === "barracks",
  )) {
    if (
      entry.configs.length !== 1 ||
      Object.hasOwn(entry.originalBarracksFields, "45403ae3")
    )
      fail(
        "Mode-dependent barracks configuration selection is not implemented",
      );
    const configKey = entry.configs[0],
      config = nodes.get(configKey.slice(1, -1));
    if (config?.classHash !== mapBinHash("BarracksConfig"))
      fail("Original barracks config is missing");
    const units = property(config, "units");
    if (units?.type !== "UnorderedContainer" || !units.elements.length)
      fail("Original barracks unit definitions required");
    for (const unit of units.elements) {
      const unitType = scalar(unit, "MinionType", "U8"),
        link = unit.fields?.fee040bc;
      if (
        !Number.isInteger(unitType) ||
        unitType < 4 ||
        unitType > 7 ||
        link?.type !== "ObjectLink"
      )
        fail("Unadmitted original barracks unit or placeable link");
      const placeable = nodes.get(
        hex(uint(link.value, "minion placeable link")),
      );
      const character = property(placeable, "Character");
      const skin = scalar(character, "Skin", "String"),
        record = scalar(character, "CharacterRecord", "String");
      const match = /^Characters\/([A-Za-z0-9_]+)\/Skins\/Skin(\d+)$/.exec(
        skin,
      );
      if (
        !match ||
        !record.startsWith(`Characters/${match[1]}/CharacterRecords/`)
      )
        fail("Barracks character and skin references disagree");
      const skinId = Number(match[2]),
        key = `${match[1].toLowerCase()}/${skinId}`;
      if (!Number.isSafeInteger(skinId)) fail("Invalid original minion skin");
      if (Object.hasOwn(entry.units, unitType))
        fail("Ambiguous duplicate original minion unit type");
      entry.units[unitType] = {
        asset: key,
        records: [{ config: configKey, characterRecord: record }],
      };
      if (!requests.has(key))
        requests.set(key, { character: match[1], skinId, records: [] });
      const request = requests.get(key);
      if (!request.records.includes(record)) request.records.push(record);
    }
    result.placeables[entry.mapNameHash] = entry;
  }
  result.assetRequests = [...requests.values()].map((request) => ({
    ...request,
    records: request.records.sort(),
  }));
  result.mapDefinitionSha256 = definitions.sourceSha256;
  return result;
}

export function selectMap11RecordedRegistry(report, inventory) {
  if (
    report?.build !== inventory?.build ||
    report.protocol !== "20e09df23c66b85e" ||
    report.startup?.configuredMapId !== 11 ||
    report.startup.mode !== "CLASSIC" ||
    inventory.kind !== "archived-map11-placeable-inventory" ||
    !inventory.mapDefinitionSha256
  )
    fail(
      "Original CLASSIC Map11 report and fully resolved static definitions required",
    );
  const towers = report.worldEvents.filter(
    (event) => event.kind === "building-identity-candidate",
  );
  const hashes = new Set(towers.map((event) => event.mapNameHash)),
    ids = new Set(towers.map((event) => event.entityId));
  if (
    towers.length < 2 ||
    hashes.size !== towers.length ||
    ids.size !== towers.length ||
    towers.some(
      (event) =>
        event.stream !== 2 ||
        event.time !== 0 ||
        !Number.isInteger(event.entityId) ||
        ![100, 200].includes(event.team),
    )
  )
    fail("Complete unique original initial tower anchors required");
  const chunks = new Map();
  for (const entry of inventory.registration) {
    if (!chunks.has(entry.sourceChunk)) chunks.set(entry.sourceChunk, []);
    chunks.get(entry.sourceChunk).push(entry);
  }
  const candidates = [...chunks.entries()].filter(([, entries]) => {
    const staticTowers = entries.filter((entry) => entry.attackableType === 0);
    return (
      staticTowers.length === hashes.size &&
      staticTowers.every((entry) => hashes.has(entry.mapNameHash))
    );
  });
  if (candidates.length !== 1)
    fail(
      "Recorded tower anchors do not uniquely select an authored registration chunk",
    );
  const [sourceChunk, registration] = candidates[0];
  const offsets = new Set(
    towers.map((tower) => {
      const index = registration.findIndex(
          (entry) => entry.mapNameHash === tower.mapNameHash,
        ),
        entry = registration[index];
      if (entry.explicitTeam !== null && entry.explicitTeam !== tower.team)
        fail("Recorded team differs from authored tower team");
      return tower.entityId - index;
    }),
  );
  const registrationBase = [...offsets][0];
  if (
    offsets.size !== 1 ||
    !Number.isInteger(registrationBase) ||
    registrationBase < 1 ||
    registrationBase + registration.length - 1 > 0xffffffff
  )
    fail("Recorded towers contradict the candidate authored key order");
  const minions = [];
  for (const event of report.worldEvents.filter(
    (event) => event.kind === "lane-minion-creation-candidate",
  )) {
    const barracks = registration[event.barracksId - registrationBase],
      unit = barracks?.units?.[event.unitType];
    if (barracks?.kind !== "barracks" || !unit)
      fail("Recorded minion has no unique original barracks/unit binding");
    minions.push({
      entityId: event.entityId,
      barracksId: event.barracksId,
      unitType: event.unitType,
      asset: unit.asset,
      characterRecords: unit.records.map((record) => record.characterRecord),
      time: event.time,
      originalBarracksKey: barracks.objectKey,
      creationPosition: barracks.transform[3].slice(0, 3),
    });
  }
  return {
    schema: 1,
    kind: "recorded-map11-registration-binding",
    build: report.build,
    protocol: report.protocol,
    replaySha256: report.replaySha256,
    sourceChunk,
    registrationBase,
    anchors: towers.length,
    registration: structuredClone(registration),
    minions,
    status:
      "All recorded tower anchors and lane-minion references agree with one authored chunk; native initializer execution remains separate",
    nativeInitializerExecuted: false,
    spectatorAdmission: false,
  };
}
