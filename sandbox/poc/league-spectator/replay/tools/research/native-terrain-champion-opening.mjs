import { createNativeTerrainChampionCreation88Reader } from "./native-terrain-champion-identities.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

function requireSelection(condition, message) {
  if (!condition) throw new Error(message);
}

function championSkinKey({ champion, skinId }) {
  requireSelection(
    typeof champion === "string" && /^[a-z0-9_]+$/i.test(champion),
    "Invalid opening champion",
  );
  requireSelection(
    Number.isSafeInteger(skinId) && skinId >= 0 && skinId <= 10000,
    "Invalid opening skin selector",
  );
  return `${champion.toLowerCase()}-${skinId}`;
}

export function readChampionModelSelections(prepared, codecs, options) {
  return corroborateChampionModelSelections(
    prepared.observations,
    readChampionOpeningCreations(prepared, codecs, options),
  );
}

export function readChampionOpeningCreations(prepared, codecs, options) {
  const { observations, packetReader } = prepared;
  const readCreation = createNativeTerrainChampionCreation88Reader(
    observations,
    codecs,
    options,
  );
  const { keyframe, packets } = packetReader.read(0);
  requireSelection(keyframe.timeSeconds === 0, "Expected the opening keyframe");
  let opcode = null;
  let context = 0;
  const creations = [];
  for (const packet of packets) {
    if (packet.stream !== 2 || packet.chunkOffset !== keyframe.chunkOffset)
      break;
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode !== 88) continue;
    requireSelection(context === 0, "Unexpected opcode 88 envelope context");
    creations.push(readCreation(packet.payload, { includeSkin: true }));
  }
  return creations;
}

export function corroborateChampionModelSelections(observations, creations) {
  const { binding, roster } = observations;
  requireSelection(roster.length === 10, "Expected a complete 5v5 footer");
  requireSelection(
    binding.unresolved.length === 0,
    "Roster contexts are unresolved",
  );
  requireSelection(
    binding.verified.length === roster.length,
    "Incomplete footer binding",
  );
  requireSelection(
    creations.length === roster.length,
    "Expected one creation per participant",
  );
  const footerRows = new Map(
    binding.verified.map(({ context, footerRow }) => [context, footerRow]),
  );
  requireSelection(
    footerRows.size === roster.length,
    "Duplicate bound context",
  );
  requireSelection(
    new Set(footerRows.values()).size === roster.length,
    "Duplicate footer row",
  );
  const contexts = new Set();
  return creations.map(({ context, champion, skinId }) => {
    requireSelection(
      Number.isSafeInteger(context) && context > 0 && context <= 0xffffffff,
      "Invalid opening creation context",
    );
    requireSelection(
      !contexts.has(context),
      "Duplicate opening creation context",
    );
    contexts.add(context);
    const footerRow = footerRows.get(context);
    requireSelection(
      Number.isInteger(footerRow) &&
        footerRow >= 1 &&
        footerRow <= roster.length,
      "Invalid bound footer row",
    );
    requireSelection(
      champion === roster[footerRow - 1].champion,
      "Opening creation champion disagrees with its footer row",
    );
    championSkinKey({ champion, skinId });
    return { context, champion, skinId };
  });
}

/** Resolve opening selections from a separately digest-verified build catalog. */
export function indexCurrentChampionOpening(catalog, observations, creations) {
  requireSelection(
    observations.build === currentTerrainPositionBuild &&
      observations.protocol === terrainPositionProtocol,
    "Expected the exact current champion opening build and protocol",
  );
  requireSelection(
    catalog?.build === observations.build &&
      catalog.protocol === observations.protocol &&
      catalog.schema === 1 &&
      catalog.kind === "exact-native-terrain-champion-catalog" &&
      catalog.selectionKind === "archive" &&
      !Object.hasOwn(catalog, "replaySha256") &&
      !Object.hasOwn(catalog, "nativeOpening"),
    "Expected an independent exact-build champion catalog",
  );
  return new Map(
    corroborateChampionModelSelections(observations, creations).map(
      (selection) => [
        selection.context,
        readSelectedChampionAsset(catalog, selection),
      ],
    ),
  );
}

export function readSelectedChampionAsset(catalog, selection) {
  const key = championSkinKey(selection);
  requireSelection(
    catalog.assets && Object.hasOwn(catalog.assets, key),
    `Missing exact champion skin: ${key}`,
  );
  const asset = catalog.assets[key];
  requireSelection(
    asset?.champion === selection.champion && asset.skinId === selection.skinId,
    "Champion catalog entry disagrees with its opening skin selector",
  );
  return asset;
}

export function prepareCurrentChampionModelBindings(
  catalog,
  observations,
  creations,
) {
  return {
    bindings: [
      ...indexCurrentChampionOpening(catalog, observations, creations),
    ].map(([participantId, asset]) => {
      const { champion, skinId, skinScale, hiddenRanges, model } = asset;
      const key = championSkinKey({ champion, skinId });
      requireSelection(
        model?.file === `${key}/model.glb` &&
          typeof model.sha256 === "string" &&
          /^[0-9a-f]{64}$/.test(model.sha256) &&
          Number.isSafeInteger(model.bytes) &&
          model.bytes > 0,
        "Invalid build-scoped champion model resource",
      );
      requireSelection(
        skinScale === null || (Number.isFinite(skinScale) && skinScale > 0),
        "Invalid build-scoped champion skin scale",
      );
      requireSelection(
        Array.isArray(hiddenRanges) &&
          hiddenRanges.every(
            (name) => typeof name === "string" && name.length > 0,
          ) &&
          new Set(hiddenRanges).size === hiddenRanges.length,
        "Invalid build-scoped champion hidden ranges",
      );
      return {
        participantId,
        skinId,
        skinScale: skinScale ?? 1,
        hiddenRanges,
        url: `/champion-models/${model.sha256}.glb`,
      };
    }),
  };
}
