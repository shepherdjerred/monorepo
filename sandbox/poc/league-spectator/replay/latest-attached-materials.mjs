// Exact native observations for attached-mesh materials. Raw resource predicates
// are explicit caller inputs; this does not acquire resources or choose a pose.
import { ATTACHED_MESH_SHA } from "./latest-attached-mesh.mjs";
const ENV = [
  "pass",
  "featuresEnabled",
  "resourceMask",
  "systemFogMode",
  "graphics34b",
  "graphics29c",
  "resolvedResourceFlag95",
];
const digest = async (b) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const fail = (message) => {
  throw Error(message);
};
function environment(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== ENV.length ||
    ENV.some((k) => !Object.hasOwn(input, k)) ||
    typeof input.featuresEnabled !== "boolean" ||
    typeof input.graphics34b !== "boolean" ||
    !(
      input.resolvedResourceFlag95 === null ||
      typeof input.resolvedResourceFlag95 === "boolean"
    )
  )
    fail("Explicit attached material environment required");
  for (const [k, max] of [
    ["pass", 6],
    ["resourceMask", 7],
    ["systemFogMode", 1],
    ["graphics29c", 2],
  ])
    if (!Number.isInteger(input[k]) || input[k] < 0 || input[k] > max)
      fail(`Invalid attached material input: ${k}`);
  return JSON.stringify(ENV.map((k) => input[k]));
}
function vector(p) {
  if (
    !p ||
    typeof p.name !== "string" ||
    !/^[a-f0-9]{32}$/.test(p.bytesHex) ||
    !Array.isArray(p.value) ||
    p.value.length !== 4
  )
    fail("Invalid attached material vector");
  const b = Uint8Array.from(p.bytesHex.match(/../g), (v) => parseInt(v, 16)),
    view = new DataView(b.buffer),
    out = new Float32Array(4);
  for (let i = 0; i < 4; i++) {
    out[i] = view.getFloat32(i * 4, true);
    if (!Number.isFinite(out[i]) || !Object.is(out[i], p.value[i]))
      fail("Attached material float32 bytes differ");
  }
  return out;
}
export async function createLatestAttachedMaterials(
  bytes,
  expectedSha256,
  profile,
) {
  if (
    !(bytes instanceof Uint8Array) ||
    !/^[a-f0-9]{64}$/.test(expectedSha256) ||
    (await digest(bytes)) !== expectedSha256
  )
    fail("Attached material package hash mismatch");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-attached-material-observations" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.attachedMeshPackageSha256 !== ATTACHED_MESH_SHA ||
    meta.decoderImageSha256 !==
      "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7" ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.sliceSha256 !== meta.sliceSha256 ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    meta.scope.partialCorpus !== false ||
    meta.scope.maximumEmittersPerNativeEngine !== 60 ||
    meta.scope.assetBytesUnchanged !== true ||
    meta.scope.originalPrimitiveTypeRetained !== true ||
    meta.scope.nativeShaderSelectionExecuted !== true ||
    meta.scope.nativeParameterFragmentsExecuted !== true ||
    meta.scope.nativeRenderStateFragmentsExecuted !== true ||
    meta.scope.resolvedResourceByte95Supplied !== true ||
    meta.scope.externalMathCalls !== 0 ||
    meta.scope.resourceAcquisition !== false ||
    meta.scope.materialFactory !== false ||
    meta.scope.gpuSubmitted !== false ||
    meta.scope.meshPoseBindingExecuted !== false ||
    meta.scope.browserRun !== false ||
    meta.scope.mainViewerIntegrated !== false ||
    meta.scope.referencePixelsCompared !== false ||
    meta.scope.resourceCacheLookupExecuted !== false ||
    meta.scope.meshResourceProducerTraced !== false ||
    meta.counts.emitters !== 181 ||
    meta.emitters.length !== 181 ||
    meta.counts.shaderSelections !== 9231 ||
    meta.counts.renderStates !== 9231 ||
    meta.counts.assetPreservationChecks !== 181
  )
    fail("Unsupported attached material package");
  const entries = new Map();
  for (const e of meta.emitters) {
    const id = `${e.effectId}:${e.emitterIndex}`,
      probes = new Map();
    if (
      entries.has(id) ||
      e.probes.length !== 51 ||
      !/^[a-f0-9]{64}$/.test(e.graphSha256)
    )
      fail("Ambiguous attached material emitter");
    for (const p of [...e.parameters, ...e.erosionParameters]) vector(p);
    for (const s of e.samplers)
      if (!/^[a-f0-9]{10}$/.test(s.descriptorHex))
        fail("Invalid attached sampler");
    for (const p of e.probes) {
      const key = environment(p.input);
      if (
        probes.has(key) ||
        !p.selection ||
        !p.renderState ||
        !/^[a-f0-9]{64}$/.test(p.renderState.bytesHex) ||
        !/^[a-f0-9]{16}$/.test(p.renderState.programPrefixHex)
      )
        fail("Invalid attached material probe");
      for (const v of p.renderState.uniforms) vector(v);
      probes.set(key, p);
    }
    entries.set(id, { entry: e, probes });
  }
  return {
    describe(effectId, emitterIndex, input) {
      const e = entries.get(`${effectId}:${emitterIndex}`);
      if (!e) fail("Unprepared attached material emitter");
      const p = e.probes.get(environment(input));
      if (!p) fail("Unobserved attached material environment");
      const parameters = new Map();
      // Erosion is deliberately fixed at the native supplied drive (0.5).
      // Dynamic mesh erosion has not yet been independently observed here.
      for (const value of [
        ...e.entry.parameters,
        ...e.entry.erosionParameters,
        ...p.renderState.uniforms,
      ]) {
        if (parameters.has(value.name))
          fail("Duplicate attached material parameter");
        parameters.set(value.name, vector(value));
      }
      return {
        effectId,
        emitterIndex,
        graphSha256: e.entry.graphSha256,
        vertex: p.selection.vertex,
        pixel: p.selection.pixel,
        defines: p.renderState.defines.map((d) => ({ ...d })),
        parameters,
        samplers: e.entry.samplers.map((s) => ({ ...s })),
        renderStateHex: p.renderState.bytesHex,
        programPrefixHex: p.renderState.programPrefixHex,
        linkShaderFlag1a: p.selection.linkShaderFlag1a,
        suppliedErosionDrive: e.entry.erosionAtSuppliedDrive,
        scope:
          "Native material observations with supplied resource predicates and fixed erosion drive. Mesh pose, scheduling, GPU submission and runtime resource classification are unverified.",
      };
    },
  };
}
