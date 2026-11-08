import { sha256 } from "./structural-comparison.mjs";
import { normalizeDirectPointEmitter } from "./latest-direct-effect-defaults.mjs";
import { validateDirectMultUv } from "./latest-direct-effect-mult-uv.mjs";
import {
  compileDirectDepthBiasProgram,
  validateDirectDepthBiasProgram,
} from "./latest-direct-effect-depth-bias.mjs";
import { packDirectRayFrameUniforms } from "./latest-direct-ray-materials.mjs";
import {
  DIRECT_NAV_SCENE_POLICY,
  DIRECT_NAV_SCENE_OMISSIONS,
} from "./latest-direct-nav-scene-contract.mjs";
import { DIRECT_RAY_SCENE_OMISSIONS } from "./latest-direct-ray-scene.mjs";

export const DIRECT_NAV_GROUND_PACKAGE_SHA =
  "d5b9f2fab73e78341120edce0ff30d474972e86030b957096a040c610698be86";
export const DIRECT_NAV_GROUND_POLICY =
  "native-ground-pass5-owned-navigation-v1";
export const DIRECT_NAV_CAMERA_PACKAGE_SHA =
  "87253bb28c0aed75507d9648e558b198c2cd3868c82b62097213330559e668af";
export const DIRECT_NAV_CAMERA_POLICY =
  "native-camera-ground-pass5-owned-navigation-v1";
export const DIRECT_NAV_GROUND_OMISSIONS = Object.freeze([
  ...DIRECT_NAV_SCENE_OMISSIONS,
  ...DIRECT_RAY_SCENE_OMISSIONS.filter(
    (s) => s !== "material:ray-allvision-presentation-policy",
  ),
  "material:ground-allvision-presentation-policy",
]);
const owners = new WeakSet(),
  copy = structuredClone;
const plain = (v) =>
  v !== null &&
  typeof v === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
function same(a, b) {
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null
  )
    return Object.is(a, b);
  if (
    Array.isArray(a) !== Array.isArray(b) ||
    (!Array.isArray(a) && (!plain(a) || !plain(b)))
  )
    return false;
  const ak = Reflect.ownKeys(a),
    bk = Reflect.ownKeys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        typeof k === "string" &&
        Object.hasOwn(b, k) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(a, k), "value") &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(b, k), "value") &&
        same(a[k], b[k]),
    )
  );
}
const pairs = Object.freeze({
  plain: {
    vertex: "5fe789950f7002b7fb8e36add0855f18c59bbd22bb835c6d0229b4e7e9de7d91",
    pixel: "0111da660621998bf87e4e35d59eb3ddb19c38b2bdf79aace812fb13a407af19",
  },
  mult: {
    vertex: "2027bfde0655d8c6ba3bb400edd227144206d35f7ce9c6df2ed1d49fd32fb6eb",
    pixel: "9b3465883c470854591f9fe029dd0d8251520fe3bdc9179e5ca65f2407a2f8e6",
  },
  camera: {
    vertex: "5fe789950f7002b7fb8e36add0855f18c59bbd22bb835c6d0229b4e7e9de7d91",
    pixel: "02a925f204cf6c38ec27bc67d93f328f3e00e42bddc6511920bf1f87a6ea4e42",
  },
});
export const isLatestDirectNavGroundMaterials = (v) => owners.has(v);
export function validateDirectNavGroundProgram(
  emitter,
  { id, definitionHash, index } = {},
) {
  const p = emitter.navGroundProgram;
  if (p == null) {
    if (emitter.source?.useNavmeshMask)
      throw Error("Navigation source requires owned pass5 program");
    return null;
  }
  const source = emitter.source,
    mult = validateDirectMultUv(emitter),
    camera = p.policy === DIRECT_NAV_CAMERA_POLICY;
  if (
    !plain(p) ||
    !same(
      Reflect.ownKeys(p).sort(),
      [
        "schema",
        "policy",
        "packageSha256",
        "scenePolicy",
        "effectId",
        "emitterIndex",
        "sourceDefinitionSha256",
        "passHash",
        "variantIndex",
        "shaderPair",
      ].sort(),
    ) ||
    p.schema !== 1 ||
    ![DIRECT_NAV_GROUND_POLICY, DIRECT_NAV_CAMERA_POLICY].includes(p.policy) ||
    p.packageSha256 !==
      (camera
        ? DIRECT_NAV_CAMERA_PACKAGE_SHA
        : DIRECT_NAV_GROUND_PACKAGE_SHA) ||
    p.scenePolicy !== DIRECT_NAV_SCENE_POLICY ||
    p.effectId !== (id ?? p.effectId) ||
    p.sourceDefinitionSha256 !== (definitionHash ?? p.sourceDefinitionSha256) ||
    p.emitterIndex !== (index ?? emitter.index) ||
    p.passHash !== 1047222492 ||
    p.variantIndex !== 0 ||
    !same(
      p.shaderPair,
      camera ? pairs.camera : mult ? pairs.mult : pairs.plain,
    ) ||
    emitter.primitive !== (camera ? "camera-quad" : "arbitrary-quad") ||
    emitter.groundLayer !== true ||
    emitter.blend !== source?.blendMode ||
    emitter.materialPolicy !== p.policy ||
    ![1, true].includes(source?.isGroundLayer) ||
    ![1, true].includes(source?.useNavmeshMask) ||
    (camera
      ? ![undefined, "VfxPrimitiveCameraQuad"].includes(
          source.primitive?.__type,
        )
      : source.primitive?.__type !== "VfxPrimitiveArbitraryQuad") ||
    (camera && mult) ||
    source.alphaErosionDefinition !== undefined ||
    source.particleColorTexture !== undefined ||
    !!source.textureMult !== !!mult ||
    emitter.materialKey !== `${p.effectId}:${p.emitterIndex}`
  )
    throw Error("Malformed owned navigation ground program");
  if (
    camera &&
    (Object.hasOwn(source, "depthBiasFactors") ||
      emitter.depthBiasProgram != null)
  )
    validateDirectDepthBiasProgram(
      emitter.depthBiasProgram,
      source,
      emitter.primitive,
    );
  return p;
}
export async function loadLatestDirectNavGroundMaterials({
  load,
  profile,
  manifestBytes,
  records,
}) {
  const bytes = await load("latest-direct-nav-ground-materials/package.json");
  if (
    !(bytes instanceof Uint8Array) ||
    (await sha256(bytes)) !== DIRECT_NAV_GROUND_PACKAGE_SHA
  )
    throw Error("Pinned navigation ground material package required");
  const p = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (
    p.schema !== 1 ||
    p.kind !== "prepared-complete-native-navigation-ground-materials" ||
    p.build !== profile.clientVersion ||
    p.protocol !== profile.protocolDigest ||
    p.decoderImageSha256 !== profile.decoderImageSha256 ||
    p.build !== manifest.build ||
    p.protocol !== manifest.protocol ||
    p.effectsManifestSha256 !== (await sha256(manifestBytes))
  )
    throw Error("Exact-build navigation ground material package differs");
  const rows = new Map(),
    wanted = new Map();
  for (const record of records) {
    if (
      !(record.bytes instanceof Uint8Array) ||
      (await sha256(record.bytes)) !== manifest.definitions[record.id]?.sha256
    )
      throw Error("Hash-verified original navigation definitions required");
    const original = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(record.bytes),
    );
    if (!same(original.definition, record.definition) || wanted.has(record.id))
      throw Error("Original navigation record differs from its exact bytes");
    wanted.set(record.id, original);
  }
  const packages = [
    {
      data: p,
      folder: "latest-direct-nav-ground-materials",
      hash: DIRECT_NAV_GROUND_PACKAGE_SHA,
      policy: DIRECT_NAV_GROUND_POLICY,
      primitive: "arbitrary-quad",
      vtable: 0x23f20c8,
    },
  ];
  if (
    [...wanted.values()].some((record) =>
      record.definition.complexEmitterDefinitionData?.some(
        (source) =>
          source.useNavmeshMask &&
          [undefined, "VfxPrimitiveCameraQuad"].includes(
            source.primitive?.__type,
          ),
      ),
    )
  ) {
    const cameraBytes = await load(
      "latest-direct-nav-camera-materials/package.json",
    );
    if (
      !(cameraBytes instanceof Uint8Array) ||
      (await sha256(cameraBytes)) !== DIRECT_NAV_CAMERA_PACKAGE_SHA
    )
      throw Error("Pinned camera navigation material package required");
    const data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(cameraBytes),
    );
    if (
      data.schema !== 1 ||
      data.kind !== "prepared-complete-native-navigation-camera-materials" ||
      data.build !== p.build ||
      data.protocol !== p.protocol ||
      data.decoderImageSha256 !== p.decoderImageSha256 ||
      data.effectsManifestSha256 !== p.effectsManifestSha256
    )
      throw Error("Exact-build camera navigation package differs");
    packages.push({
      data,
      folder: "latest-direct-nav-camera-materials",
      hash: DIRECT_NAV_CAMERA_PACKAGE_SHA,
      policy: DIRECT_NAV_CAMERA_POLICY,
      primitive: "camera-quad",
      vtable: 0x23f23b0,
    });
  }
  async function resource(ref, folder) {
    if (
      !ref ||
      !/^((shaders\/[a-f0-9]{64}\.json)|(planes\/[a-f0-9]{64}\.bin))$/.test(
        ref.file,
      )
    )
      throw Error("Bounded nav material resource required");
    const b = await load(`${folder}/${ref.file}`);
    if (
      !(b instanceof Uint8Array) ||
      b.length !== ref.bytes ||
      (await sha256(b)) !== ref.sha256
    )
      throw Error("Nav material resource integrity differs");
    return b.slice();
  }
  for (const contract of packages)
    for (const e of contract.data.emitters) {
      const key = `${e.effectId}:${e.emitterIndex}`;
      if (
        rows.has(key) ||
        manifest.definitions[e.effectId]?.sha256 !== e.sourceDefinitionSha256 ||
        e.primitiveVtableRva !== contract.vtable ||
        e.passHash !== 1047222492 ||
        e.variantIndex !== 0
      )
        throw Error("Original nav material identity differs");
      if (!wanted.has(e.effectId)) continue;
      const stages = await Promise.all(
        ["vertex", "pixel"].map(async (name) =>
          JSON.parse(
            new TextDecoder().decode(
              await resource(e.shaders[name], contract.folder),
            ),
          ),
        ),
      );
      const textures = [];
      for (const t of e.textures) {
        const levels = [];
        for (const level of t.levels)
          levels.push(
            await Promise.all(
              level.map((ref) => resource(ref, contract.folder)),
            ),
          );
        textures.push({ metadata: copy(t), levels });
      }
      const program = {
        schema: 1,
        policy: contract.policy,
        packageSha256: contract.hash,
        scenePolicy: DIRECT_NAV_SCENE_POLICY,
        effectId: e.effectId,
        emitterIndex: e.emitterIndex,
        sourceDefinitionSha256: e.sourceDefinitionSha256,
        passHash: e.passHash,
        variantIndex: e.variantIndex,
        shaderPair: Object.fromEntries(
          ["vertex", "pixel"].map((s) => [s, e.shaders[s].sha256]),
        ),
      };
      const source = normalizeDirectPointEmitter(
        wanted.get(e.effectId).definition.complexEmitterDefinitionData[
          e.emitterIndex
        ],
      );
      rows.set(key, {
        e: copy(e),
        stages,
        textures,
        program,
        source: copy(source),
        primitive: contract.primitive,
      });
    }
  const owner = Object.freeze({
    compile({ id, index, definitionHash, source, multUvProgram }) {
      const r = rows.get(`${id}:${index}`);
      if (!r) return null;
      if (
        r.e.sourceDefinitionSha256 !== definitionHash ||
        !same(source, r.source)
      )
        throw Error("Nav definition content differs");
      const candidate = {
        source,
        index,
        primitive: r.primitive,
        groundLayer: true,
        materialKey: `${id}:${index}`,
        materialPolicy: r.program.policy,
        multUvProgram,
        depthBiasProgram: compileDirectDepthBiasProgram(source, r.primitive),
        blend: source.blendMode,
        navGroundProgram: copy(r.program),
      };
      validateDirectNavGroundProgram(candidate, { id, index, definitionHash });
      for (const t of r.e.textures) {
        const path =
          t.layer === "base"
            ? source.texture
            : t.layer === "mult"
              ? source.textureMult?.textureMult
              : null;
        if (t.authoredPath !== (path?.toLowerCase() ?? null))
          throw Error("Original authored nav texture differs");
      }
      return copy(r.program);
    },
    inspect(key) {
      const r = rows.get(key);
      if (!r) throw Error("Owned nav material required");
      return {
        program: copy(r.program),
        material: copy(r.e),
        stages: copy(r.stages),
        textures: copy(r.textures),
      };
    },
    admit(emitter) {
      const r = rows.get(emitter.materialKey);
      if (!r) return false;
      validateDirectNavGroundProgram(emitter, {
        id: r.e.effectId,
        definitionHash: r.e.sourceDefinitionSha256,
        index: r.e.emitterIndex,
      });
      if (!same(emitter.source, r.source))
        throw Error(
          "Nav authored source differs from hash-owned material source",
        );
      if (!same(r.program, emitter.navGroundProgram))
        throw Error("Compiled nav program differs from owned resource");
      if (emitter.depthBiasProgram)
        validateDirectDepthBiasProgram(
          emitter.depthBiasProgram,
          emitter.source,
          emitter.primitive,
          r.e.pipeline.descriptorHex,
        );
      return true;
    },
    frameUniforms(key, uniforms) {
      const r = rows.get(key);
      if (!r) throw Error("Owned nav material required");
      const variant = {
        requiredScene: r.e.requiredScene,
        constantBuffers: r.e.constantBuffers,
      };
      return packDirectRayFrameUniforms(
        {
          status: "prepared-native-parent-material",
          emitterIndex: r.e.emitterIndex,
          passHash: r.e.passHash,
          variant,
        },
        r.stages,
        uniforms,
      );
    },
  });
  owners.add(owner);
  return owner;
}
