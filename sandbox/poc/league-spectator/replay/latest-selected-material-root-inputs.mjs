// UNUSED admission prerequisite. Original constructor/registered scalar readers
// establish these source bytes; postload/general pointer closure is separate.
import { assertDirectCompiledDataGraph } from "./latest-direct-compiled-restore.mjs";
export const SELECTED_MATERIAL_ROOT_INPUT_POLICY =
  "original-material-root-scalar-input-projection-v1";
export const SELECTED_MATERIAL_ROOT_INPUT_SOURCE_BLOCKS = Object.freeze([
  Object.freeze({
    rva: 0x16ffef0,
    size: 2064,
    sha256: "2a28be825a7eb0299e2403abb514e065d00c0c5ce2fe214983a7ac2accb8f102",
  }),
  Object.freeze({
    rva: 0x178d920,
    size: 135,
    sha256: "2012746663379ec44d7951c20c0fb871137ad1b0c9ab879b807538d736d5be3f",
  }),
  Object.freeze({
    rva: 0x14bc490,
    size: 928,
    sha256: "145763acb0e36fea744c9bfb11f270cf89991b0479e954239fa691eb8180a1b8",
  }),
]);
const SPANS = [
  [0x11, "00"],
  [0x14, "00"],
  [0x72, "0001"],
  [0x75, "00000500000000000000000000000000000000"],
  [0xc8, "00"],
  [0x2d0, "00202000"],
];
// [original property hash, original byte offset, original type, bit mask].
const FIELDS = [
  [1401880484, 722, 135, 8],
  [1119715179, 722, 135, 16],
  [2041100123, 723, 135, 64],
  [283792845, 723, 135, 32],
  [2810587181, 722, 135, 2],
  [4202188459, 20, 3, 0],
  [431879391, 115, 3, 0],
  [3113423092, 119, 3, 0],
  [173979394, 132, 10, 0],
  [1739970345, 124, 11, 0],
  [1016188605, 17, 1, 0],
  [1701035752, 114, 3, 0],
  [451903612, 117, 3, 0],
  [2068046572, 118, 3, 0],
  [376198341, 120, 17, 0],
  [3522070068, 720, 135, 1],
  [937277300, 720, 135, 2],
  [3724322854, 720, 135, 4],
  [895082843, 720, 135, 8],
  [3985060700, 720, 135, 16],
  [3768409787, 720, 135, 32],
  [3038085223, 720, 135, 128],
  [2368611444, 721, 135, 1],
  [2791509514, 721, 135, 2],
  [3131498697, 721, 135, 8],
  [668207363, 721, 135, 16],
  [2074613737, 721, 135, 32],
  [3722305920, 721, 135, 64],
  [1734953377, 721, 135, 128],
  [3181085639, 722, 135, 1],
  [1370437586, 723, 135, 128],
  [719533490, 722, 135, 32],
  [642448697, 200, 3, 0],
];
const known = new Map(FIELDS.map((f) => [f[0], f]));
const need = (v, m) => {
  if (!v) throw Error(m);
};
function sourceKey(name) {
  const raw = /^\{([a-f0-9]{8})\}$/.exec(name);
  if (raw) return Number.parseInt(raw[1], 16);
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(name.toLowerCase()))
    h = Math.imul(h ^ b, 0x1000193) >>> 0;
  return h;
}
export function deriveSelectedMaterialRootInputSpans(emitter) {
  assertDirectCompiledDataGraph(emitter);
  need(
    emitter !== null && typeof emitter === "object" && !Array.isArray(emitter),
    "Authored material emitter record required",
  );
  if (Object.hasOwn(emitter, "__type"))
    need(
      emitter.__type === "VfxEmitterDefinitionData",
      "Original material emitter type required",
    );
  const bytes = new Uint8Array(0x470),
    view = new DataView(bytes.buffer),
    seen = new Set();
  for (const [offset, hex] of SPANS) bytes.set(Uint8Array.fromHex(hex), offset);
  for (const [name, value] of Object.entries(emitter)) {
    const hash = sourceKey(name),
      field = known.get(hash);
    if (!field) continue;
    need(!seen.has(hash), "Ambiguous authored material property hash");
    seen.add(hash);
    const [, offset, type, mask] = field;
    if (type === 1) {
      need(typeof value === "boolean", "Authored material boolean required");
      bytes[offset] = Number(value);
    } else if (type === 135) {
      need(
        value === 0 || value === 1,
        "Authored material bitfield byte required",
      );
      bytes[offset] = (bytes[offset] & ~mask) | (value ? mask : 0);
    } else if (type === 3) {
      need(
        Number.isInteger(value) && value >= 0 && value <= 255,
        "Authored material byte enum required",
      );
      bytes[offset] = value;
    } else if (type === 10 || type === 11) {
      const values = type === 10 ? [value] : value;
      need(
        Array.isArray(values) &&
          values.length === (type === 10 ? 1 : 2) &&
          values.every(
            (v) =>
              typeof v === "number" &&
              Number.isFinite(v) &&
              Number.isFinite(Math.fround(v)),
          ),
        "Finite authored material scalar/vector required",
      );
      values.forEach((v, i) => view.setFloat32(offset + i * 4, v, true));
    } else if (type === 17) {
      const key =
        typeof value === "string" && /^\{([a-f0-9]{8})\}$/.exec(value);
      need(key, "Exact authored material hash required");
      view.setUint32(offset, Number.parseInt(key[1], 16), true);
    } else throw Error("Unproved original material property type");
  }
  return SPANS.map(([offset, hex]) => ({
    offset,
    bytesHex: bytes.subarray(offset, offset + hex.length / 2).toHex(),
  }));
}
export function assertSelectedMaterialRootInputSpans(emitter, graph) {
  assertDirectCompiledDataGraph(graph);
  need(
    typeof graph?.assetObjectHex === "string" &&
      /^(?:[a-f0-9]{2}){1136}$/.test(graph.assetObjectHex),
    "Complete original material emitter object required",
  );
  const spans = deriveSelectedMaterialRootInputSpans(emitter);
  for (const { offset, bytesHex } of spans)
    need(
      graph.assetObjectHex.slice(offset * 2, offset * 2 + bytesHex.length) ===
        bytesHex,
      "Authored source differs from original material root input span: " +
        offset.toString(16),
    );
  return spans;
}
// The original root callback invokes a virtual curve operation only when the
// IntegratedValueVector3 worldAcceleration dynamics pointer is non-null.
export function assertSelectedMaterialNoWorldAccelerationCurve(emitter, graph) {
  assertDirectCompiledDataGraph({ emitter, graph });
  need(
    emitter !== null && typeof emitter === "object" && !Array.isArray(emitter),
    "Authored material emitter record required",
  );
  const fields = Object.keys(emitter).filter(
    (name) => sourceKey(name) === 0xeb9a4e0f,
  );
  need(fields.length <= 1, "Ambiguous authored worldAcceleration source");
  let constant = [0, 0, 0];
  if (fields.length) {
    const value = emitter[fields[0]];
    need(
      value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        value.__type === "IntegratedValueVector3",
      "Original worldAcceleration source class required",
    );
    const names = Object.keys(value).filter((name) => name !== "__type");
    need(
      names.length <= 1 &&
        names.every((name) => sourceKey(name) === 0xb4b427aa),
      "No-dynamics worldAcceleration source required",
    );
    if (names.length) constant = value[names[0]];
    need(
      Array.isArray(constant) &&
        constant.length === 3 &&
        constant.every(
          (v) =>
            typeof v === "number" &&
            Number.isFinite(v) &&
            Number.isFinite(Math.fround(v)),
        ),
      "Finite authored worldAcceleration vector required",
    );
  }
  need(
    typeof graph?.assetObjectHex === "string" &&
      /^(?:[a-f0-9]{2}){1136}$/.test(graph.assetObjectHex),
    "Complete original material emitter object required",
  );
  const bytes = new Uint8Array(12),
    view = new DataView(bytes.buffer);
  constant.forEach((v, i) => view.setFloat32(i * 4, v, true));
  need(
    graph.assetObjectHex.slice(0x370 * 2, 0x37c * 2) === bytes.toHex() &&
      graph.assetObjectHex.slice(0x380 * 2, 0x388 * 2) === "0000000000000000",
    "Authored no-dynamics worldAcceleration differs from native object",
  );
  return { constantHex: bytes.toHex(), curvePointerNull: true };
}
