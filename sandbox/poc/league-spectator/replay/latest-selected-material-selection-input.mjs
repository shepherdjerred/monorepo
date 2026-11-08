// Unused research contract. This records original selection/state inputs, not
// approval of authored lowering, material observations, or runtime admission.
import { assertDirectCompiledDataGraph } from "./latest-direct-compiled-restore.mjs";
export const SELECTED_MATERIAL_SELECTION_INPUT_POLICY =
  "original-supplied-quad-selection-state-read-inputs-v1";
const rootAddress = 0x10020000,
  linkAddress = 0x10021000;
const spans = Object.freeze([
  [0x11, 1],
  [0x14, 1],
  [0x72, 2],
  [0x75, 0x13],
  [0xc8, 1],
  [0x2d0, 4],
]);
const need = (value, message) => {
  if (!value) throw Error(message);
};
function hex(value) {
  need(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 32 * 1024 * 1024 &&
      /^(?:[a-f0-9]{2})+$/.test(value),
    "Bounded original graph byte hex required",
  );
  return Uint8Array.fromHex(value);
}
function propertyHash(name) {
  const raw = /^\{([a-f0-9]{8})\}$/.exec(name);
  if (raw) return Number.parseInt(raw[1], 16);
  let value = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name.toLowerCase()))
    value = Math.imul(value ^ byte, 0x1000193) >>> 0;
  return value;
}

// The partial quad resource path does not provide these authored definitions.
// Absence must agree in source and native bytes, including hashed aliases.
export function assertSelectedBasicMaterialDefinitionInputs({
  emitter,
  graph,
}) {
  assertDirectCompiledDataGraph({ emitter, graph });
  const object = hex(graph.assetObjectHex);
  need(
    object.length === 0x470,
    "Complete original material emitter object required",
  );
  const root = new DataView(object.buffer),
    keys = Object.keys(emitter).map(propertyHash);
  for (const [name, offset] of [
    ["alphaErosionDefinition", 0x38],
    ["paletteDefinition", 0x40],
    ["reflectionDefinition", 0x48],
  ]) {
    need(
      !keys.includes(propertyHash(name)),
      "Unsupported authored material definition: " + name,
    );
    need(
      root.getBigUint64(offset, true) === 0n,
      "Absent authored material definition has a native pointer: " + name,
    );
  }
  return true;
}

export function deriveSelectedMaterialSelectionInput({ graph, emitter }) {
  assertDirectCompiledDataGraph({ graph, emitter });
  need(
    !Object.keys(emitter).some((name) => propertyHash(name) === 0x4b901db3),
    "Authored custom material definition is not part of the supplied default-material fixture",
  );
  need(
    graph.build === "16.21.829.8620" &&
      graph.protocol === "20e09df23c66b85e" &&
      graph.addresses.definition === rootAddress &&
      graph.addresses.link === linkAddress &&
      Number.isSafeInteger(graph.assetHeapStart) &&
      graph.assetHeapStart >= 0x10400000 &&
      Number.isSafeInteger(graph.assetHeapBytes) &&
      graph.assetHeapBytes > 0 &&
      graph.nextHeap === graph.assetHeapStart + graph.assetHeapBytes &&
      graph.nextHeap <= 0x11000000 &&
      graph.segments.length === 2 &&
      emitter.__type === "VfxEmitterDefinitionData",
    "Exact original quad graph/root layout required",
  );
  const segments = graph.segments
      .map((segment) => ({
        address: segment.address,
        bytes: hex(segment.bytesHex),
      }))
      .sort((a, b) => a.address - b.address),
    [definition, heap] = segments;
  need(
    definition.address === rootAddress &&
      definition.bytes.length === 0x10000 &&
      heap.address === graph.assetHeapStart &&
      heap.bytes.length === graph.assetHeapBytes &&
      definition.address + definition.bytes.length <= heap.address,
    "Complete disjoint original graph segments required",
  );
  const object = hex(graph.assetObjectHex);
  need(
    object.length === 0x470 &&
      object.every((value, index) => value === definition.bytes[index]),
    "Material root copy differs from complete graph bytes",
  );
  const root = new DataView(object.buffer),
    link = new DataView(
      definition.bytes.buffer,
      linkAddress - rootAddress,
      0x40,
    ),
    pointer = (offset) => {
      const value = root.getBigUint64(offset, true);
      need(
        value <= BigInt(Number.MAX_SAFE_INTEGER),
        "Bounded exact material pointer required",
      );
      return Number(value);
    },
    child = (address, size) => {
      const offset = address - heap.address;
      need(
        Number.isSafeInteger(offset) &&
          offset >= 0 &&
          offset + size <= heap.bytes.length,
        "Material child exceeds owned asset heap",
      );
      return new DataView(heap.bytes.buffer, offset, size);
    };
  need(
    link.getBigUint64(0x10, true) === BigInt(rootAddress) &&
      link.getUint32(0x1c, true) === 0xffffffff &&
      link.getBigUint64(0x28, true) === 0n &&
      link.getUint32(0x30, true) === 0 &&
      pointer(0x68) === 0,
    "Original supplied material-link/custom-material fixture differs",
  );
  const primitiveAddress = pointer(0x60),
    primitive = child(primitiveAddress, 0x10),
    code = primitive.getUint8(8),
    sourcePrimitive = emitter.primitive;
  need(
    graph.primitiveAddress === primitiveAddress &&
      ((code === 0 &&
        graph.primitiveKind === "camera" &&
        !Object.hasOwn(emitter, "primitive") &&
        primitive.getBigUint64(0, true) === 0x1023f23b0n &&
        child(primitiveAddress, 0x18).getBigUint64(0x10, true) ===
          0x1023f2510n) ||
        (code === 1 &&
          graph.primitiveKind === "arbitrary" &&
          sourcePrimitive &&
          Object.keys(sourcePrimitive).length === 1 &&
          sourcePrimitive.__type === "VfxPrimitiveArbitraryQuad" &&
          primitive.getBigUint64(0, true) === 0x1023f20c8n)),
    "Primitive source/constructor/vtable/selection-code identity differs",
  );
  const children = Object.fromEntries(
    [0x30, 0x38, 0x40, 0x48, 0x230].map((offset) => {
      const address = pointer(offset);
      if (address) child(address, offset === 0x40 ? 0x6c : 1);
      return [offset, address];
    }),
  );
  const paletteCount = children[0x40] ? child(children[0x40] + 0x68, 4) : null;
  return {
    policy: SELECTED_MATERIAL_SELECTION_INPUT_POLICY,
    rootReads: spans.map(([offset, size]) => ({
      offset,
      bytesHex: object.subarray(offset, offset + size).toHex(),
    })),
    primitiveCode: code,
    softDefinition: children[0x30] !== 0,
    erosionDefinition: children[0x38] !== 0,
    paletteCountHex: paletteCount
      ? new Uint8Array(paletteCount.buffer, paletteCount.byteOffset, 4).toHex()
      : null,
    definedObjectMask: [0x230, 0x48, 0x40].reduce(
      (mask, offset, bit) => mask | (children[offset] ? 1 << bit : 0),
      0,
    ),
  };
}
