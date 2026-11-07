import { sha256 } from "./structural-comparison.mjs";
import {
  directRaySceneOmissions,
  packDirectRayFrameUniforms,
} from "./latest-direct-ray-materials.mjs";
import { lookupNativeMaterialPass } from "./latest-native-parent-materials.mjs";
export const DIRECT_RAY_MATERIALS_SHA =
  "44f2b11eab045d8c1941cd26da3c767fe993e980df2a38656cfb9fd17f698d1f";
export const DIRECT_RAY_MATERIAL_POLICY = "native-ray-atlas4-palette-unlit-v1";
export const DIRECT_RAY_SHADER_PAIR = Object.freeze({
  vertex: "924cda2a7adbe0a9b2e7c7fcd6fc459f08694dd55bb17fa73441d98dd2691afe",
  pixel: "6c8919d2888115e1acf410b50631b4bf8b471a9412884e2c2507843c95a164b6",
});
export const DIRECT_RAY_MATERIAL_OMISSIONS = Object.freeze([
  "material:ray-allvision-presentation-policy",
  "material:actual-spectator-fow-flag-unrecovered",
  "material:dynamic-team-visibility-unrecovered",
  "material:actual-vision-extent-unrecovered",
  "material:team-color-remap-omitted",
  "material:updates-outside-reflected-quad-inputs-untranslated",
]);
const owned = new WeakSet(),
  digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
  same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exact = (v, keys) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Reflect.ownKeys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const copy = structuredClone;
export const isLatestDirectRayMaterialPackage = (v) =>
  v !== null && typeof v === "object" && owned.has(v);

export function validateDirectRayMaterialSelection(
  emitter,
  { id, definitionHash, index },
) {
  const s = emitter.rayMaterialSelection;
  if (emitter.primitive !== "ray") {
    if (s != null) throw Error("Unexpected Ray material selection");
    return null;
  }
  if (
    !exact(s, [
      "schema",
      "status",
      "policy",
      "packageSha256",
      "effectId",
      "emitterIndex",
      "sourceDefinitionSha256",
      "primitiveVtableRva",
      "writerRva",
      "vertexStride",
      "passHash",
      "selectedPass",
      "variantIndex",
      "shaderPair",
      "textureDivisions",
      "textures",
      "pipeline",
      "scope",
    ]) ||
    s.schema !== 1 ||
    s.status !== "owned-direct-ray-material-selection" ||
    s.policy !== DIRECT_RAY_MATERIAL_POLICY ||
    emitter.materialPolicy !== DIRECT_RAY_MATERIAL_POLICY ||
    emitter.materialKey !== `${id}:${index}` ||
    s.packageSha256 !== DIRECT_RAY_MATERIALS_SHA ||
    s.effectId !== id ||
    s.emitterIndex !== index ||
    s.sourceDefinitionSha256 !== definitionHash ||
    !digest(definitionHash) ||
    s.primitiveVtableRva !== 0x23f26e0 ||
    s.writerRva !== 0x1734a30 ||
    s.vertexStride !== 28 ||
    s.passHash !== 2700020711 ||
    s.selectedPass !== "post_distortion" ||
    s.variantIndex !== 0 ||
    !exact(s.shaderPair, ["vertex", "pixel"]) ||
    Object.entries(DIRECT_RAY_SHADER_PAIR).some(
      ([k, v]) => s.shaderPair[k] !== v,
    ) ||
    !Array.isArray(s.textureDivisions) ||
    Reflect.ownKeys(s.textureDivisions).length !== 3 ||
    !same(s.textureDivisions, [4, 1]) ||
    !Array.isArray(s.textures) ||
    s.textures.length !== 2 ||
    Reflect.ownKeys(s.textures).length !== 3 ||
    !exact(s.scope, [
      "selectedResourcesGpuVerified",
      "sceneInputsResolved",
      "wholeRootGpuPrepared",
      "nativeWorldAcceptance",
    ]) ||
    s.scope.selectedResourcesGpuVerified !== true ||
    s.scope.sceneInputsResolved !== false ||
    s.scope.wholeRootGpuPrepared !== false ||
    s.scope.nativeWorldAcceptance !== null
  )
    throw Error("Malformed compiled owned Ray material selection");
  const roles = new Set();
  for (const t of s.textures) {
    if (
      !exact(t, [
        "name",
        "path",
        "sourceSha256",
        "pixelSha256",
        "width",
        "height",
        "samplerDescriptorHex",
      ]) ||
      roles.has(t.name) ||
      !["TEXTURE__TX", "PARTICLE_COLOR_TEXTURE__TX"].includes(t.name) ||
      !digest(t.sourceSha256) ||
      !digest(t.pixelSha256) ||
      !Number.isSafeInteger(t.width) ||
      !Number.isSafeInteger(t.height) ||
      t.width < 1 ||
      t.height < 1 ||
      t.width > 16384 ||
      t.height > 16384
    )
      throw Error("Malformed Ray texture identity");
    const palette = t.name === "PARTICLE_COLOR_TEXTURE__TX",
      path = palette
        ? emitter.source.particleColorTexture
        : emitter.source.texture;
    if (
      typeof path !== "string" ||
      t.path !== path.toLowerCase() ||
      t.samplerDescriptorHex !==
        (palette
          ? "01010100000000000100010100000000"
          : "00000000000000000100010100000000")
    )
      throw Error("Ray authored texture/sampler identity differs");
    const asset = palette ? emitter.rayPaletteTexture : emitter.texture;
    if (
      !asset ||
      asset.kind !== "texture" ||
      asset.status !== "prepared" ||
      asset.sourceSha256 !== t.sourceSha256
    )
      throw Error("Ray prepared texture source differs");
    roles.add(t.name);
  }
  const descriptor = {
    1: "3f0000000403000000000606070700010f000000000000000000000000000000",
    4: "3f0000000403000000000606010100010f000000000000000000000000000000",
  }[emitter.source.blendMode];
  const p = s.pipeline,
    state = p?.state;
  if (
    !exact(p, ["descriptorHex", "state"]) ||
    p.descriptorHex !== descriptor ||
    !state ||
    !exact(state, [
      "blendEnabled",
      "depthEnabled",
      "stencilEnabled",
      "cullEnabled",
      "polygonOffsetEnabled",
      "colorMask",
      "depthMask",
      "depthFunction",
      "stencilFunction",
      "stencilOperations",
      "stencilReadMask",
      "stencilWriteMask",
      "blendFactors",
      "blendOperations",
      "cullFace",
      "frontFace",
      "polygonOffset",
    ]) ||
    state.blendEnabled !== true ||
    state.depthEnabled !== false ||
    state.stencilEnabled !== false ||
    state.cullEnabled !== false ||
    state.polygonOffsetEnabled !== false ||
    state.depthMask !== false ||
    state.depthFunction !== 519 ||
    state.stencilFunction !== 519 ||
    !same(state.stencilOperations, [7680, 7680, 7680]) ||
    state.stencilReadMask !== 0xffffffff ||
    state.stencilWriteMask !== 0 ||
    !same(state.polygonOffset, [0, 0]) ||
    !same(state.colorMask, [true, true, true, true]) ||
    !same(
      state.blendFactors,
      emitter.source.blendMode === 1 ? [770, 771, 770, 771] : [770, 1, 770, 1],
    ) ||
    !same(state.blendOperations, [32774, 32774]) ||
    state.frontFace !== 2304 ||
    state.cullFace !== 1029
  )
    throw Error("Ray native pipeline contract differs");
  return s;
}

export async function createLatestDirectRayMaterialPackage({
  profile,
  packageBytes,
  expectedPackageSha256 = DIRECT_RAY_MATERIALS_SHA,
  effectsManifestBytes,
}) {
  if (
    !(packageBytes instanceof Uint8Array) ||
    !(effectsManifestBytes instanceof Uint8Array) ||
    expectedPackageSha256 !== DIRECT_RAY_MATERIALS_SHA ||
    (await sha256(packageBytes)) !== DIRECT_RAY_MATERIALS_SHA
  )
    throw Error("Pinned Ray material package required");
  const p = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
    ),
    manifest = JSON.parse(new TextDecoder().decode(effectsManifestBytes));
  if (
    p.schema !== 1 ||
    p.kind !== "prepared-direct-ray-materials" ||
    p.build !== profile.clientVersion ||
    p.protocol !== profile.protocolDigest ||
    p.decoderImageSha256 !== profile.decoderImageSha256 ||
    p.effectsManifestSha256 !== (await sha256(effectsManifestBytes)) ||
    p.build !== manifest.build ||
    p.protocol !== manifest.protocol ||
    !Array.isArray(p.emitters) ||
    !p.emitters.length
  )
    throw Error("Exact-build Ray material package differs");
  const emitters = new Map(),
    handles = new WeakMap();
  for (const e of p.emitters) {
    const key = `${e.effectId}:${e.emitterIndex}`;
    if (
      emitters.has(key) ||
      manifest.definitions[e.effectId]?.sha256 !== e.sourceDefinitionSha256 ||
      e.primitiveVtableRva !== 0x23f26e0 ||
      e.writerRva !== 0x1734a30 ||
      e.vertexStride !== 28
    )
      throw Error("Malformed Ray material owner");
    emitters.set(key, e);
  }
  const bridge = Object.freeze({
    inventory: () => copy(p.emitters),
    async prepare({
      effectId,
      emitterIndex,
      passHash,
      variantIndex,
      loadBytes,
    }) {
      const e = emitters.get(`${effectId}:${emitterIndex}`);
      if (
        !e ||
        typeof loadBytes !== "function" ||
        !Number.isSafeInteger(variantIndex) ||
        variantIndex < 0
      )
        throw Error("Owned Ray emitter and explicit material variant required");
      const row = lookupNativeMaterialPass(e.rows, e.aliases, passHash);
      if (!row) return { status: "unavailable-native-material-pass" };
      const variant = row.variants[variantIndex];
      if (!variant) throw Error("Unprepared Ray material variant");
      async function resource(ref) {
        if (
          !ref ||
          !/^((shaders\/[a-f0-9]{64}\.json)|(planes\/[a-f0-9]{64}\.bin))$/.test(
            ref.file,
          ) ||
          !digest(ref.sha256)
        )
          throw Error("Bounded Ray material resource required");
        const b = await loadBytes(ref.file);
        if (
          !(b instanceof Uint8Array) ||
          b.length !== ref.bytes ||
          (await sha256(b)) !== ref.sha256
        )
          throw Error("Ray material resource integrity differs");
        return b.slice();
      }
      const stages = await Promise.all(
        ["vertex", "pixel"].map(async (s) => {
          if (variant.shaders[s].sha256 !== DIRECT_RAY_SHADER_PAIR[s])
            throw Error("Unverified Ray shader pair");
          return JSON.parse(
            new TextDecoder().decode(await resource(variant.shaders[s])),
          );
        }),
      );
      const attrs = stages[0].sidecar.attributes;
      if (
        attrs.length !== 4 ||
        attrs.some(
          (a, i) =>
            a.glslName !==
              ["a_POSITION", "a_COLOR", "a_TEXCOORD", "a_TEXCOORD1"][i] ||
            a.mask !== [7, 15, 7, 3][i],
        )
      )
        throw Error("Ray packed vertex ABI differs");
      const textures = [];
      for (const t of variant.textures) {
        const levels = [];
        for (const level of t.levels)
          levels.push(await Promise.all(level.map(resource)));
        textures.push({ metadata: copy(t), levels });
      }
      const token = Object.freeze({
        effectId,
        emitterIndex,
        passHash,
        variantIndex,
      });
      handles.set(token, { e, row, variant, stages, textures });
      return token;
    },
    inspect(token) {
      const r = handles.get(token);
      if (!r) throw Error("Owned Ray material token required");
      return {
        schema: 1,
        status: "owned-direct-ray-material-selection",
        policy: DIRECT_RAY_MATERIAL_POLICY,
        packageSha256: DIRECT_RAY_MATERIALS_SHA,
        effectId: r.e.effectId,
        emitterIndex: r.e.emitterIndex,
        sourceDefinitionSha256: r.e.sourceDefinitionSha256,
        primitiveVtableRva: r.e.primitiveVtableRva,
        writerRva: r.e.writerRva,
        vertexStride: 28,
        passHash: r.row.hash,
        selectedPass: r.row.name,
        variantIndex: token.variantIndex,
        shaderPair: { ...DIRECT_RAY_SHADER_PAIR },
        textureDivisions: [4, 1],
        textures: r.variant.textures.map((t) => ({
          name: t.name,
          path: t.path,
          sourceSha256: t.sourceSha256,
          pixelSha256: t.levels[0][0].sha256,
          width: t.width,
          height: t.height,
          samplerDescriptorHex: t.sampler.descriptorHex,
        })),
        pipeline: copy(r.variant.pipeline),
        scope: {
          selectedResourcesGpuVerified: true,
          sceneInputsResolved: false,
          wholeRootGpuPrepared: false,
          nativeWorldAcceptance: null,
        },
      };
    },
    frameUniforms(token, scene) {
      const r = handles.get(token);
      if (!r) throw Error("Owned Ray material token required");
      const omissions = directRaySceneOmissions(r.variant.requiredScene, scene);
      if (omissions.length) throw Error("Unresolved Ray frame scene inputs");
      return packDirectRayFrameUniforms(
        {
          status: "prepared-native-parent-material",
          emitterIndex: token.emitterIndex,
          passHash: token.passHash,
          variant: r.variant,
        },
        r.stages,
        scene.uniforms,
      );
    },
    bind(token, scene) {
      const r = handles.get(token);
      if (!r) throw Error("Owned Ray material token required");
      const omissions = directRaySceneOmissions(r.variant.requiredScene, scene);
      if (omissions.length)
        return { status: "unresolved-ray-scene-inputs", omissions };
      return {
        status: "bound-explicit-scene-ray-material",
        selection: bridge.inspect(token),
        stages: copy(r.stages),
        textures: copy(r.textures),
        sceneTextures: copy(scene.textures),
        pipeline: copy(r.variant.pipeline),
        uniforms: packDirectRayFrameUniforms(
          {
            status: "prepared-native-parent-material",
            emitterIndex: token.emitterIndex,
            passHash: token.passHash,
            variant: r.variant,
          },
          r.stages,
          scene.uniforms,
        ),
        stencilReference: scene.stencilReference,
        blendColor: scene.blendColor.slice(),
        omissions: [...DIRECT_RAY_MATERIAL_OMISSIONS],
        scope: {
          nativeSceneRecovered: false,
          perFrameGuestCalls: 0,
          gpuSubmitted: false,
        },
      };
    },
  });
  owned.add(bridge);
  return bridge;
}
