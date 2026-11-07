// Bounded producer validation: authored scalar/child inputs lowered through the
// original registered layouts/defaults. Complete postload output remains a
// trusted, source-pinned offline artifact of the selected static catalog.
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
import { deriveSelectedMaterialSourceVectors } from "./latest-selected-material-source-vectors.mjs";
export const SELECTED_MATERIAL_PARAMETER_INPUT_POLICY =
  "original-static-material-parameter-input-projection-v1";
export const SELECTED_MATERIAL_PARAMETER_FIELDS = Object.freeze([
  Object.freeze({
    rootOffset: null,
    type: 0x09cde442,
    fields: Object.freeze(
      [
        [3329156504, 0x12, 1, "00"],
        [3407065073, 0x33c, 10, "00000000"],
        [844078864, 0xc9, 3, "00"],
        [2259174665, 0x8c, 11, "0000803f0000803f"],
      ].map(Object.freeze),
    ),
  }),
  Object.freeze({
    rootOffset: 0x30,
    type: 0x1daa3fb0,
    fields: Object.freeze(
      [
        [1804195137, 0, 10, "00000000"],
        [4078228802, 4, 10, "00000000"],
        [526783490, 8, 10, "00000000"],
        [2136143771, 12, 10, "00000000"],
        [1005680316, 16, 3, "00"],
      ].map(Object.freeze),
    ),
  }),
  Object.freeze({
    rootOffset: 0x230,
    type: 0xb097c1bd,
    fields: Object.freeze(
      [
        [1529123847, 0x18, 3, "00"],
        [374036275, 0x10, 11, "0000803f0000803f"],
      ].map(Object.freeze),
    ),
  }),
]);
const need = (v, m) => {
  if (!v) throw Error(m);
};
function hashName(name) {
  const encoded = /^\{([a-f0-9]{8})\}$/.exec(name);
  if (encoded) return parseInt(encoded[1], 16);
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(name.toLowerCase()))
    h = Math.imul(h ^ b, 0x1000193) >>> 0;
  return h;
}
function lower(record, spec) {
  need(
    record && typeof record === "object" && !Array.isArray(record),
    "Authored material input record required",
  );
  const spans = spec.fields.map(([hash, offset, type, hex]) => ({
      hash,
      offset,
      type,
      bytes: Uint8Array.fromHex(hex),
    })),
    seen = new Set();
  for (const [name, value] of Object.entries(record)) {
    const hash = hashName(name),
      field = spans.find((f) => f.hash === hash);
    if (!field) continue;
    need(!seen.has(hash), "Ambiguous authored material numeric field");
    seen.add(hash);
    const v = new DataView(field.bytes.buffer);
    if (field.type === 1) {
      need(typeof value === "boolean", "Original material bool input required");
      v.setUint8(0, Number(value));
    } else if (field.type === 3) {
      need(
        Number.isInteger(value) && value >= 0 && value <= 255,
        "Original material byte input required",
      );
      v.setUint8(0, value);
    } else {
      const values = field.type === 11 ? value : [value];
      need(
        Array.isArray(values) &&
          values.length === (field.type === 11 ? 2 : 1) &&
          values.every(
            (n) =>
              typeof n === "number" &&
              Number.isFinite(n) &&
              Number.isFinite(Math.fround(n)),
          ),
        "Original finite material float input required",
      );
      values.forEach((n, i) => v.setFloat32(i * 4, n, true));
    }
  }
  return spans.map(({ offset, bytes }) => ({
    offset,
    bytesHex: bytes.toHex(),
  }));
}
export function deriveSelectedMaterialParameterInputSpans(emitter) {
  assertDirectCompiledDataGraph(emitter);
  need(
    emitter && typeof emitter === "object" && !Array.isArray(emitter),
    "Authored material emitter required",
  );
  if (Object.hasOwn(emitter, "__type"))
    need(
      emitter.__type === "VfxEmitterDefinitionData",
      "Original emitter type required",
    );
  const erosion = Object.entries(emitter).filter(
    ([name]) => hashName(name) === 3295031301,
  );
  need(erosion.length <= 1, "Ambiguous authored material erosion hash");
  need(
    erosion.length === 0 || erosion[0][1] === null,
    "Nonerosion authored material inputs required",
  );
  const result = {
    root: lower(emitter, SELECTED_MATERIAL_PARAMETER_FIELDS[0]),
    soft: null,
    mult: null,
  };
  for (const [hash, key, index, type] of [
    [3216043997, "soft", 1, "VfxSoftParticleDefinitionData"],
    [791583218, "mult", 2, "VfxTextureMultDefinitionData"],
  ]) {
    const entries = Object.entries(emitter).filter(
      ([name]) => hashName(name) === hash,
    );
    need(entries.length <= 1, "Ambiguous authored material child hash");
    if (entries.length === 0 || entries[0][1] === null) continue;
    const child = entries[0][1];
    need(
      child && typeof child === "object" && !Array.isArray(child),
      "Authored material child input required",
    );
    if (Object.hasOwn(child, "__type"))
      need(child.__type === type, "Original material child type required");
    result[key] = lower(child, SELECTED_MATERIAL_PARAMETER_FIELDS[index]);
  }
  return result;
}
export function assertSelectedMaterialParameterInputSpans(emitter, graph) {
  const expected = deriveSelectedMaterialParameterInputSpans(emitter);
  // Also establishes exact unchanged root and unique non-overlapping ownership.
  deriveSelectedMaterialSourceVectors(graph);
  const rootBytes = Uint8Array.fromHex(graph.assetObjectHex),
    view = new DataView(rootBytes.buffer),
    segments = graph.segments.map((s) => ({
      address: s.address,
      bytes: Uint8Array.fromHex(s.bytesHex),
    }));
  function actual(address, spans) {
    return spans.map((s) => {
      const count = s.bytesHex.length / 2,
        at = address + s.offset,
        owners = segments.filter(
          (b) => at >= b.address && at + count <= b.address + b.bytes.length,
        );
      need(
        owners.length === 1,
        "One original material numeric field owner required",
      );
      return {
        offset: s.offset,
        bytesHex: owners[0].bytes
          .slice(at - owners[0].address, at - owners[0].address + count)
          .toHex(),
      };
    });
  }
  need(
    sameDirectCompiledData(
      expected.root,
      actual(graph.addresses.definition, expected.root),
    ),
    "Serialized material root numeric inputs differ from authored source",
  );
  for (const [key, offset] of [
    ["soft", 0x30],
    ["mult", 0x230],
  ]) {
    const p = view.getBigUint64(offset, true);
    need(
      p <= BigInt(Number.MAX_SAFE_INTEGER),
      "Bounded material numeric child pointer required",
    );
    need(
      (p === 0n) === (expected[key] === null),
      "Material numeric child presence differs from authored source",
    );
    if (p !== 0n)
      need(
        sameDirectCompiledData(expected[key], actual(Number(p), expected[key])),
        "Serialized material child numeric inputs differ from authored source",
      );
  }
  return true;
}

export function deriveAuthoredSelectedMaterialSourceVectors(emitter) {
  const expected = deriveSelectedMaterialParameterInputSpans(emitter),
    root = new Uint8Array(0x470),
    view = new DataView(root.buffer),
    segments = [];
  const put = (bytes, spans) => {
    for (const s of spans) bytes.set(Uint8Array.fromHex(s.bytesHex), s.offset);
  };
  put(root, expected.root);
  for (const [key, offset, address, size] of [
    ["soft", 0x30, 0x10400000, 0x14],
    ["mult", 0x230, 0x10400100, 0x20],
  ])
    if (expected[key] !== null) {
      const b = new Uint8Array(size);
      put(b, expected[key]);
      view.setBigUint64(offset, BigInt(address), true);
      segments.push({ address, bytesHex: b.toHex() });
    }
  const graph = {
    addresses: { definition: 0x10020000 },
    assetObjectHex: root.toHex(),
    segments: [{ address: 0x10020000, bytesHex: root.toHex() }, ...segments],
  };
  return deriveSelectedMaterialSourceVectors(graph);
}
