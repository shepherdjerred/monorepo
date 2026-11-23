import { sha256 } from "./structural-comparison.mjs";

export const NEUTRAL_CREATION_PACKAGE_SHA =
  "5c8a97009a9c5d9bdc90cf42158ea840aa714ad3bfe63df41379edc39e4e4cdb";
const offsets = Object.freeze({
  entityId: [92, 93, 94, 95],
  requestedSkinId: [184, 185, 186, 187],
  nativeTeamEnum: [80],
  scalarArgumentBits: [16, 17, 18, 19],
  firstVectorArgument: Array.from({ length: 12 }, (_, index) => 40 + index),
  secondVectorArgument: Array.from({ length: 12 }, (_, index) => 172 + index),
});
const strings = Object.freeze({
  initialAnimation: 24,
  name: 56,
  secondaryName: 104,
  character: 152,
});
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function assertNeutralCreationCodecs(metadata) {
  if (
    !metadata ||
    !equal(
      Object.keys(metadata.fields ?? {}).sort(),
      Object.keys(offsets).sort(),
    ) ||
    !equal(metadata.strings, strings) ||
    metadata.opcode !== 745 ||
    metadata.objectBytes !== 200 ||
    metadata.heapBase !== 0x10200000
  )
    throw Error("Exact native745 field and arena layout required");
  for (const [name, inputOffsets] of Object.entries(offsets)) {
    const codec = metadata.fields[name];
    if (
      codec.bytes !== inputOffsets.length ||
      !equal(codec.inputOffsets, inputOffsets) ||
      !Array.isArray(codec.decode) ||
      codec.decode.length !== codec.bytes ||
      codec.decode.some(
        (column) =>
          !Array.isArray(column) ||
          column.length !== 256 ||
          new Set(column).size !== 256 ||
          column.some(
            (value) => !Number.isInteger(value) || value < 0 || value > 255,
          ),
      )
    )
      throw Error("Complete bijective native745 byte columns required");
  }
}

// Pure field decoding for bounded controls. Production admission is performed
// by createLatestNeutralCreationReader's fixed native package/image checks.
export function decodeNeutralCreationObservation(metadata, observation) {
  assertNeutralCreationCodecs(metadata);
  return readNeutralCreationObservation(metadata, observation);
}
function readNeutralCreationObservation(metadata, observation) {
  const object = observation?.object,
    heap = observation?.heap;
  if (
    observation?.complete !== true ||
    !(object instanceof Uint8Array) ||
    object.length !== 200 ||
    !(heap instanceof Uint8Array) ||
    heap.length < 200
  )
    throw Error("Complete original745 object and arena required");
  const data = new DataView(
    object.buffer,
    object.byteOffset,
    object.byteLength,
  );
  if (data.getUint32(8, true) !== 745)
    throw Error("Wrong native neutral packet class");
  const field = (name) => {
    const codec = metadata.fields[name];
    const bytes = Uint8Array.from(
      codec.inputOffsets,
      (offset, index) => codec.decode[index][object[offset]],
    );
    return new DataView(bytes.buffer);
  };
  const entityId = field("entityId").getUint32(0, true);
  if (entityId !== data.getUint32(12, true) || entityId === 0)
    throw Error(
      "Original neutral lookup identity differs from its packet context",
    );
  const text = (offset) => {
    const pointer = data.getBigUint64(offset, true),
      length = data.getUint32(offset + 8, true),
      capacity = data.getUint32(offset + 12, true);
    if (length === 0) return "";
    const relative = pointer - BigInt(metadata.heapBase);
    if (
      relative < 0n ||
      relative > BigInt(heap.length) ||
      length > 1024 ||
      capacity < length ||
      relative + BigInt(length) >= BigInt(heap.length)
    )
      throw Error("Original neutral string escaped its bounded arena");
    const start = Number(relative);
    if (heap[start + length] !== 0)
      throw Error("Original neutral C string is not terminated");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      heap.subarray(start, start + length),
    );
  };
  const vector = (name) => {
    const value = field(name),
      result = [0, 4, 8].map((at) => value.getFloat32(at, true));
    if (!result.every(Number.isFinite))
      throw Error("Original neutral factory vector is nonfinite");
    return result;
  };
  const character = text(strings.character);
  if (!/^[a-z0-9_]+$/i.test(character))
    throw Error("Original neutral character identity required");
  return {
    kind: "neutral-creation-candidate",
    entityId,
    character,
    requestedSkinId: field("requestedSkinId").getUint32(0, true),
    nativeTeamEnum: field("nativeTeamEnum").getUint8(0),
    firstVectorArgument: vector("firstVectorArgument"),
    secondVectorArgument: vector("secondVectorArgument"),
    scalarArgumentBits: field("scalarArgumentBits").getUint32(0, true),
    name: text(strings.name),
    secondaryName: text(strings.secondaryName),
    initialAnimation: text(strings.initialAnimation),
    resourceSkinResolved: false,
    nativeWorldAcceptance: false,
  };
}

export async function createLatestNeutralCreationReader({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(packageBytes instanceof Uint8Array) ||
    !(image instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== NEUTRAL_CREATION_PACKAGE_SHA
  )
    throw Error("Pinned original745 field package required");
  const metadata = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    metadata.schema !== 1 ||
    metadata.kind !== "native-neutral-factory-argument-fields" ||
    profile.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e" ||
    metadata.build !== profile.clientVersion ||
    metadata.protocol !== profile.protocolDigest ||
    metadata.decoderImageSha256 !== profile.decoderImageSha256 ||
    metadata.constructorImageSha256 !== profile.constructorImageSha256 ||
    metadata.sliceSha256 !== profile.sliceSha256 ||
    !metadata.scope.originalArgumentInstructionsExecuted ||
    !metadata.scope.allByteValuesCompared ||
    !metadata.scope.mixedByteLanesCompared ||
    !metadata.scope.initialAnimationRequestDataflowStaticOnly ||
    metadata.scope.factoryExecuted ||
    metadata.scope.finalResourceSkinResolutionIncluded ||
    metadata.scope.nativeWorldAcceptanceIncluded
  )
    throw Error("Unsupported native neutral factory-argument contract");
  assertNeutralCreationCodecs(metadata);
  for (const block of metadata.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original745 argument instructions changed");
  return Object.freeze({
    metadata: structuredClone(metadata),
    read: (observation) =>
      readNeutralCreationObservation(metadata, observation),
  });
}
