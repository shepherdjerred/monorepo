import { sameDirectCompiledData as same } from "./latest-direct-compiled-restore.mjs";
import { sceneMaterialEnvironments } from "./scene-vfx-material-contract.mjs";

const need = (value, message) => {
  if (!value) throw Error(message);
};
const hash = (value) =>
  typeof value === "string" && /^[a-f\d]{64}$/.test(value);
export const sceneMaterialIdentity = (row) =>
  `${row.effectId}:${row.emitterIndex}`;
export function validateSceneMaterialRows(materials, native) {
  const nativeRows = new Map(),
    rows = new Map();
  for (const record of native.emitters) {
    const key = `${record.kind}:${sceneMaterialIdentity(record)}`;
    need(
      typeof record.effectId === "string" &&
        record.effectId.length > 0 &&
        ["complex", "simple"].includes(record.kind) &&
        [
          "native-bound-quad-prepared",
          "unsupported-original-emitter-class",
          "unsupported-original-asset-class",
          "unsupported-native-quad-environment",
          "unsupported-native-quad-postload-boundary",
        ].includes(record.status) &&
        Number.isSafeInteger(record.emitterIndex) &&
        record.emitterIndex >= 0 &&
        !nativeRows.has(key),
      "Unique complete native emitter identity required",
    );
    nativeRows.set(key, record);
  }
  const eligible = [...nativeRows.values()].filter(
    (row) => row.status === "native-bound-quad-prepared",
  );
  need(
    materials.emitters.length === eligible.length,
    "Complete native material eligible graph inventory required",
  );
  for (const row of materials.emitters) {
    const key = sceneMaterialIdentity(row),
      original = nativeRows.get(`complex:${key}`),
      graph = original?.resources?.boundQuad;
    need(
      !rows.has(key) &&
        original?.status === "native-bound-quad-prepared" &&
        hash(row.graphSha256) &&
        row.graphSha256 === graph.sha256 &&
        row.graphFile === graph.file &&
        row.sourceDefinitionSha256 === original.sourceDefinitionSha256 &&
        ["camera", "arbitrary"].includes(row.primitiveKind),
      "Native material original graph/source identity differs",
    );
    if (row.status === "original-material-selector-observed") {
      need(
        same(
          row.probes.map((probe) => probe.input),
          sceneMaterialEnvironments(row.definedObjectMask),
        ),
        "Complete original17 material predicate controls required",
      );
      need(
        row.probes.every(
          (probe) =>
            Number.isSafeInteger(probe.result) &&
            probe.result >= 0 &&
            probe.result < materials.resultCatalog.length,
        ),
        "Native material result index outside exact catalog",
      );
      for (const parameter of [...row.parameters, ...row.erosionParameters])
        sceneMaterialVector(parameter);
      need(
        Array.isArray(row.samplers) &&
          [null, 0.5].includes(row.erosionAtSuppliedDrive) &&
          (row.erosionParameters.length === 0) ===
            (row.erosionAtSuppliedDrive === null),
        "Explicit original material sampler/erosion controls required",
      );
    } else
      need(
        row.status === "unsupported-original-custom-material-factory" &&
          typeof row.reason === "string" &&
          row.reason.length > 0 &&
          !row.probes,
        "Unknown or fabricated original material capability",
      );
    rows.set(key, row);
  }
  return { rows, nativeRows };
}
export function sceneMaterialVector(parameter) {
  need(
    parameter &&
      typeof parameter.name === "string" &&
      /^[a-f\d]{32}$/.test(parameter.bytesHex) &&
      Array.isArray(parameter.value) &&
      parameter.value.length === 4,
    "Exact original material vector required",
  );
  const bytes = Uint8Array.from(parameter.bytesHex.match(/../g), (value) =>
      parseInt(value, 16),
    ),
    view = new DataView(bytes.buffer),
    out = new Float32Array(4);
  for (let i = 0; i < 4; i++) {
    out[i] = view.getFloat32(i * 4, true);
    need(
      Number.isFinite(out[i]) && Object.is(out[i], parameter.value[i]),
      "Original material vector bytes/value differ",
    );
  }
  return out;
}
function environmentKey(value) {
  const keys = [
    "pass",
    "featuresEnabled",
    "resourceMask",
    "systemFogMode",
    "graphics34b",
    "graphics29c",
  ];
  need(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)) &&
      typeof value.featuresEnabled === "boolean" &&
      typeof value.graphics34b === "boolean",
    "Explicit native material environment required",
  );
  for (const [name, max] of [
    ["pass", 6],
    ["resourceMask", 7],
    ["systemFogMode", 1],
    ["graphics29c", 2],
  ])
    need(
      Number.isInteger(value[name]) && value[name] >= 0 && value[name] <= max,
      "Invalid native material environment: " + name,
    );
  return keys.map((key) => `${key}=${value[key]}`).join(";");
}
// Used only after authority, source-graph and complete-row validation. Callers
// supply actual scene predicates; this helper never selects a default state.
export function describeSceneMaterial(
  row,
  resultCatalog,
  input,
  dynamic,
  build,
) {
  need(
    row.status === "original-material-selector-observed",
    "Original custom material factory is unprepared",
  );
  const key = environmentKey(input),
    probe = row.probes.find((probe) => environmentKey(probe.input) === key);
  need(probe, "Native material environment was not observed");
  need(
    dynamic &&
      typeof dynamic === "object" &&
      !Array.isArray(dynamic) &&
      Object.keys(dynamic).length === 1 &&
      Object.hasOwn(dynamic, "erosionDrive"),
    "Explicit erosion-drive input required",
  );
  if (row.erosionParameters.length)
    need(
      typeof dynamic.erosionDrive === "number" &&
        Number.isFinite(Math.fround(dynamic.erosionDrive)),
      "Finite float32 erosion drive required",
    );
  else
    need(
      dynamic.erosionDrive === null,
      "Emitter without erosion requires a null drive",
    );
  const result = resultCatalog[probe.result],
    parameters = new Map();
  for (const parameter of [
    ...row.parameters,
    ...row.erosionParameters,
    ...result.renderState.uniforms,
  ]) {
    need(!parameters.has(parameter.name), "Duplicate native material vector");
    parameters.set(parameter.name, sceneMaterialVector(parameter));
  }
  if (row.erosionParameters.length) {
    need(
      parameters.has("cAlphaErosionParams"),
      "Original erosion parameter missing",
    );
    parameters.get("cAlphaErosionParams")[0] = Math.fround(
      dynamic.erosionDrive,
    );
  }
  return {
    build,
    effectId: row.effectId,
    emitterIndex: row.emitterIndex,
    graphSha256: row.graphSha256,
    vertex: result.selection.vertex,
    pixel: result.selection.pixel,
    defines: result.renderState.defines.map((value) => ({ ...value })),
    parameters,
    samplers: row.samplers.map((value) => ({ ...value })),
    renderStateHex: result.renderState.bytesHex,
    programPrefixHex: result.renderState.programPrefixHex,
    linkShaderFlag1a: result.selection.linkShaderFlag1a,
    scope:
      "Original offline selectors with supplied predicates and erosion drive; resource acquisition, dynamic scene predicates, GPU submission and match activation remain separate.",
  };
}
