import {
  currentTerrainPositionBuild,
  isExactTerrainReplay,
} from "./native-terrain-byte-codecs.mjs";

const compatibilityVersions = new Map([
  ["16.23.840.6595", "16.23.8406595"],
  [currentTerrainPositionBuild, "16.23.8418428"],
]);
const materialsPath = "data/maps/mapgeometry/map11/base_srx.materials.bin";
const installedMaterialsSha256 =
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a";
const placeableCount = 24;
export const turretPlacementReceiptDigests = Object.freeze({
  "16.23.840.6595":
    "e8b440a974777974ed09cfc799b0e21ed01ee6a809543e3fe04a639fca04ed40",
  [currentTerrainPositionBuild]:
    "5bef1df159d14f9a75d7c8f193cc5a396a85ec945815bfcce9bf80b8fb3d675c",
});
export const currentMap11WadIndexSha256 =
  "bd7d3d901aa1c96eb7f4969fdafedf500f99f636b1653ea45233274ac34e8b92";

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

function readInstalledPlacements(receipt, build) {
  if (
    receipt?.installedCompatibilityVersion?.split("+")[0] !==
      compatibilityVersions.get(build) ||
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

export function readOpeningBindings(packetReader, placements, observeOpening) {
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
    observeOpening?.(opcode, context, packet.payload);
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

function findCurrentPresentationOmissions(packetReader, losses) {
  if (losses.length === 0) return [];
  const lossByContext = new Map(losses.map((loss) => [loss.context, loss]));
  const firstLoss = Math.min(...losses.map(({ timeSeconds }) => timeSeconds));
  const omissions = new Map();
  for (const { timeSeconds, chunkOffset } of packetReader.keyframes) {
    if (timeSeconds <= firstLoss) continue;
    const { packets } = packetReader.read(timeSeconds);
    const states = new Map();
    let opcode;
    let context = 0;
    for (const packet of packets) {
      if (packet.stream !== 2 || packet.chunkOffset !== chunkOffset) break;
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      if (opcode !== 1012 || packet.payload.length !== 41) continue;
      const loss = lossByContext.get(context);
      if (
        loss === undefined ||
        timeSeconds <= loss.timeSeconds ||
        omissions.has(context)
      )
        continue;
      const state = packet.payload[13];
      const previous = states.get(context);
      if (previous !== undefined && ((previous ^ state) & 8) !== 0)
        throw Error("Conflicting turret bits in the indexed snapshot");
      if (previous === undefined) states.set(context, state);
    }
    for (const [context, state] of states) {
      if ((state & 8) === 0) continue;
      const loss = lossByContext.get(context);
      omissions.set(context, {
        context,
        mapNameHash: loss.mapNameHash,
        reason: "Recorded turret snapshot indicates alive after verified loss",
        lossTimeSeconds: loss.timeSeconds,
        snapshotTimeSeconds: timeSeconds,
        snapshotStateByte: state,
      });
    }
  }
  return Array.from(omissions.values());
}

/** Place only the corroborated turret losses and their seek-state cohort. */
export function prepareNativeTerrainTurrets(
  prepared,
  placementReceipt,
  options,
) {
  const { packetReader, observations, readTurretState } = prepared;
  if (
    !isExactTerrainReplay(packetReader, options) ||
    !Array.isArray(observations.turrets)
  )
    throw Error("Expected exact-build Map11 replay turret observations");
  const placements = readInstalledPlacements(
    placementReceipt,
    packetReader.build,
  );
  const bindings = readOpeningBindings(packetReader, placements);
  const withPlacement = (row) => {
    const binding = bindings.get(row.context);
    if (!binding)
      throw Error("Turret loss or state has no verified Map11 position");
    return { ...row, ...binding };
  };
  const losses = observations.turrets.map(withPlacement);
  const presentationOmissions =
    packetReader.build === currentTerrainPositionBuild
      ? findCurrentPresentationOmissions(packetReader, losses)
      : [];
  const omittedContexts = new Set(
    presentationOmissions.map(({ context }) => context),
  );
  return {
    opening: Array.from(bindings, ([context, binding]) => ({
      context,
      ...binding,
    })),
    losses,
    renderableLosses: losses.filter(
      ({ context }) => !omittedContexts.has(context),
    ),
    presentationOmissions,
    read(timeSeconds, options) {
      const state = readTurretState(timeSeconds, options);
      if (!state) throw Error("Prepared turret state is unavailable");
      return { ...state, turrets: state.turrets.map(withPlacement) };
    },
  };
}
