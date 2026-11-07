// Static native material observations. Scene state and resource acquisition are
// caller responsibilities; unobserved environments fail instead of substituting.
const BUILD = "16.21.829.8620";
const PROTOCOL = "20e09df23c66b85e";
const SLICE =
  "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b";
const IMAGE =
  "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7";
const ENVIRONMENT = [
  "pass",
  "featuresEnabled",
  "resourceMask",
  "systemFogMode",
  "graphics34b",
  "graphics29c",
];
import {
  selectedNativeMaterialEmitterCount,
  assertSelectedNativeMaterialEmitter,
} from "./latest-selected-vfx-material-inventory.mjs";

export async function createLatestVfxMaterials(
  bytes,
  expectedSha256,
  profile,
  selectedInventory = null,
) {
  if (!(bytes instanceof Uint8Array) || !/^[a-f0-9]{64}$/.test(expectedSha256))
    throw Error("A pinned native material package is required");
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== expectedSha256)
    throw Error("Native material package hash mismatch");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  const emitterCount =
    selectedInventory === null
      ? 2894
      : selectedNativeMaterialEmitterCount(selectedInventory, {
          materialSha256: digest,
          profile,
        });
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-quad-material-observations" ||
    meta.build !== BUILD ||
    meta.protocol !== PROTOCOL ||
    meta.sliceSha256 !== SLICE ||
    meta.decoderImageSha256 !== IMAGE ||
    meta.quadPackageSha256 !== profile.vfxBoundQuadsSha256 ||
    profile.clientVersion !== BUILD ||
    profile.protocolDigest !== PROTOCOL ||
    profile.decoderImageSha256 !== IMAGE ||
    meta.scope.partialCorpus ||
    !meta.scope.assetBytesUnchanged ||
    !meta.scope.resourcePresenceMarkerUnmapped ||
    meta.scope.externalMathCalls !== 0 ||
    meta.scope.maximumEmittersPerNativeEngine !== 100 ||
    meta.counts.emitters !== emitterCount ||
    meta.emitters.length !== emitterCount ||
    meta.counts.shaderSelections !== emitterCount * 17 ||
    meta.scope.browserRun ||
    meta.scope.resourceAcquisition ||
    meta.scope.materialFactory
  )
    throw Error("Unsupported or incomplete native material preparation");
  const key = (input) => {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== ENVIRONMENT.length ||
      ENVIRONMENT.some((name) => !Object.hasOwn(input, name)) ||
      typeof input.featuresEnabled !== "boolean" ||
      typeof input.graphics34b !== "boolean"
    )
      throw Error("Explicit native material environment required");
    for (const [name, maximum] of [
      ["pass", 6],
      ["resourceMask", 7],
      ["systemFogMode", 1],
      ["graphics29c", 2],
    ])
      if (
        !Number.isInteger(input[name]) ||
        input[name] < 0 ||
        input[name] > maximum
      )
        throw Error(`Invalid native material environment field: ${name}`);
    return ENVIRONMENT.map((name) => `${name}=${input[name]}`).join(";");
  };
  const vector = (parameter) => {
    if (
      !parameter ||
      typeof parameter.name !== "string" ||
      !/^[a-f0-9]{32}$/.test(parameter.bytesHex)
    )
      throw Error("Invalid native material vector");
    const data = Uint8Array.from(
      parameter.bytesHex.match(/../g).map((s) => Number.parseInt(s, 16)),
    );
    const view = new DataView(data.buffer),
      out = new Float32Array(4);
    for (let i = 0; i < 4; i++) {
      out[i] = view.getFloat32(i * 4, true);
      if (!Number.isFinite(out[i]) || !Object.is(out[i], parameter.value[i]))
        throw Error("Native material vector bytes/value mismatch");
    }
    return out;
  };
  const emitters = new Map();
  for (const emitter of meta.emitters) {
    const identity = `${emitter.effectId}:${emitter.emitterIndex}`;
    if (
      emitters.has(identity) ||
      emitter.probes.length !== 17 ||
      !/^[a-f0-9]{64}$/.test(emitter.graphSha256)
    )
      throw Error("Ambiguous native material emitter");
    const probes = new Map();
    for (const probe of emitter.probes) {
      const environment = key(probe.input);
      if (
        probes.has(environment) ||
        !Number.isInteger(probe.result) ||
        !meta.resultCatalog[probe.result]
      )
        throw Error("Invalid native material probe");
      probes.set(environment, probe.result);
    }
    for (const parameter of [
      ...emitter.parameters,
      ...emitter.erosionParameters,
    ])
      vector(parameter);
    emitters.set(identity, { emitter, probes });
  }
  return {
    describe(effectId, emitterIndex, input, dynamic) {
      if (selectedInventory !== null)
        assertSelectedNativeMaterialEmitter(
          selectedInventory,
          effectId,
          emitterIndex,
        );
      const entry = emitters.get(`${effectId}:${emitterIndex}`);
      if (!entry)
        throw Error("Emitter has no prepared native material observations");
      const resultIndex = entry.probes.get(key(input));
      if (resultIndex === undefined)
        throw Error("Native material environment was not prepared");
      if (
        !dynamic ||
        typeof dynamic !== "object" ||
        Array.isArray(dynamic) ||
        Object.keys(dynamic).length !== 1 ||
        !Object.hasOwn(dynamic, "erosionDrive")
      )
        throw Error("An explicit erosion-drive input is required");
      const { emitter } = entry,
        result = meta.resultCatalog[resultIndex];
      if (emitter.erosionParameters.length) {
        if (
          typeof dynamic.erosionDrive !== "number" ||
          !Number.isFinite(Math.fround(dynamic.erosionDrive))
        )
          throw Error("A finite float32 erosion drive is required");
      } else if (dynamic.erosionDrive !== null)
        throw Error("An emitter without erosion requires a null drive");
      const parameters = new Map();
      for (const parameter of [
        ...emitter.parameters,
        ...emitter.erosionParameters,
        ...result.renderState.uniforms,
      ]) {
        if (parameters.has(parameter.name))
          throw Error("Duplicate native material parameter");
        parameters.set(parameter.name, vector(parameter));
      }
      if (emitter.erosionParameters.length)
        parameters.get("cAlphaErosionParams")[0] = Math.fround(
          dynamic.erosionDrive,
        );
      return {
        build: BUILD,
        effectId,
        emitterIndex,
        graphSha256: emitter.graphSha256,
        vertex: result.selection.vertex,
        pixel: result.selection.pixel,
        defines: result.renderState.defines.map((d) => ({ ...d })),
        parameters,
        samplers: emitter.samplers.map((s) => ({ ...s })),
        renderStateHex: result.renderState.bytesHex,
        programPrefixHex: result.renderState.programPrefixHex,
        linkShaderFlag1a: result.selection.linkShaderFlag1a,
        scope:
          "Native static/per-draw values with supplied environment and erosion drive. Resource acquisition, GPU compilation/submission and pass scheduling are separate.",
      };
    },
  };
}
