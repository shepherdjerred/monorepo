const build = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";
const materialsPath = "data/maps/mapgeometry/map11/base_srx.materials.bin";
const installedMaterialsSha256 =
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a";
const placeableCount = 24;

// Opening opcode 921 uses three substitutions for decimal instance-name
// suffixes in this protocol. For the reverse form the name suffix appears
// first on the wire. Use the authored numeric name hash as the overlap.
const nameLayouts = [
  {
    separator: 0x3b,
    delimiters: [12, 19, 22, 25],
    digits: [12, 9, 10, 23, 16, 21, 22, 19, 20, 17],
    reverse: false,
  },
  {
    separator: 0x65,
    delimiters: [12, 19, 22, 25],
    digits: [226, 235, 50, 103, 59, 153, 200, 44, 28, 117],
    reverse: false,
  },
  {
    separator: 0x8f,
    delimiters: [7],
    digits: [129, 6, 163, 248, 227, 15, 209, 132, 59, 188],
    reverse: true,
  },
];

function readMapNameHash(payload) {
  const [layout, ...otherLayouts] = nameLayouts.filter(
    ({ delimiters, separator }) =>
      delimiters.every((offset) => payload[offset] === separator),
  );
  if (!layout || otherLayouts.length)
    throw Error("Expected one opening structure name layout");
  const { delimiters, separator, digits, reverse } = layout;
  const start = delimiters.at(-1) + 1;
  const end = payload.indexOf(separator, start);
  if (end - start < 8 || end - start > 10)
    throw Error("Invalid Map11 structure name length");
  const encoded = payload.subarray(start, end);
  const decimal = Array.from(encoded, (byte) => digits.indexOf(byte));
  if (decimal.includes(-1)) throw Error("Invalid Map11 structure name digit");
  if (reverse) decimal.reverse();
  const value = Number(decimal.join(""));
  if (decimal[0] === 0 || value > 0xffffffff)
    throw Error("Invalid Map11 numeric structure name");
  return value;
}

function readInstalledPlacements(receipt) {
  if (
    receipt?.installedCompatibilityVersion?.split("+")[0] !== "16.23.8406595" ||
    receipt.installedSha256 !== installedMaterialsSha256 ||
    receipt.entryPath !== materialsPath ||
    receipt.attackableType !== 0 ||
    receipt.uniqueMatches !== placeableCount ||
    receipt.records?.length !== placeableCount
  )
    throw Error("Expected verified exact-build installed Map11 placements");
  const placements = new Map();
  const offsets = new Set();
  for (const { mapNameHash, installedOffset, translation } of receipt.records) {
    if (
      !Number.isInteger(mapNameHash) ||
      mapNameHash < 1 ||
      mapNameHash > 0xffffffff ||
      placements.has(mapNameHash) ||
      !Number.isSafeInteger(installedOffset) ||
      installedOffset < 0 ||
      offsets.has(installedOffset) ||
      !Array.isArray(translation) ||
      translation.length !== 3 ||
      !translation.every(Number.isFinite)
    )
      throw Error("Invalid or duplicate installed Map11 placement");
    placements.set(mapNameHash, Object.freeze([...translation]));
    offsets.add(installedOffset);
  }
  return placements;
}

function readOpeningBindings(packetReader, placements) {
  const { keyframe, packets } = packetReader.read(0);
  if (keyframe.timeSeconds !== 0) throw Error("Expected a time-zero keyframe");
  const marked = new Set();
  const namePayloads = new Map();
  let opcode = null;
  let context = 0;
  for (const packet of packets) {
    if (packet.stream !== 2 || packet.chunkOffset !== keyframe.chunkOffset)
      continue;
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode === 1012 && packet.payload.length === 41) marked.add(context);
    if (opcode === 921) {
      const names = namePayloads.get(context) ?? [];
      names.push(packet.payload);
      namePayloads.set(context, names);
    }
  }
  if (marked.size !== placements.size)
    throw Error(
      "Opening structure cohort differs from installed Map11 placements",
    );
  const bindings = new Map();
  for (const id of marked) {
    const names = namePayloads.get(id);
    if (names?.length !== 1)
      throw Error("Expected one opening structure name per packet context");
    const mapNameHash = readMapNameHash(names[0]);
    const worldPosition = placements.get(mapNameHash);
    if (!worldPosition)
      throw Error("Missing or non-unique opening Map11 structure placement");
    bindings.set(id, { mapNameHash, worldPosition });
    placements.delete(mapNameHash);
  }
  return bindings;
}

/** Place only the corroborated turret losses and their seek-state cohort. */
export function prepareNativeTerrainTurrets(prepared, placementReceipt) {
  const { packetReader, observations, readTurretState } = prepared;
  if (
    packetReader.build !== build ||
    packetReader.protocol !== protocol ||
    !Array.isArray(observations.turrets)
  )
    throw Error("Expected exact-build Map11 replay turret observations");
  const placements = readInstalledPlacements(placementReceipt);
  const bindings = readOpeningBindings(packetReader, placements);
  const withPlacement = (row) => {
    const binding = bindings.get(row.context);
    if (!binding)
      throw Error("Turret loss or state has no verified Map11 position");
    return { ...row, ...binding };
  };
  return {
    opening: Array.from(bindings, ([context, binding]) => ({
      context,
      ...binding,
    })),
    losses: observations.turrets.map(withPlacement),
    read(timeSeconds, options) {
      const state = readTurretState(timeSeconds, options);
      if (!state) throw Error("Prepared turret state is unavailable");
      return { ...state, turrets: state.turrets.map(withPlacement) };
    },
  };
}
