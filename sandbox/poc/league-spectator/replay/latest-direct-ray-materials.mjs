// Separate preparation for the native Ray's packed-quad geometry ABI. This is
// not compiler admission, pass selection, scene recovery, or a GPU renderer.
import {
  createLatestNativeParentMaterials,
  NATIVE_PARENT_MATERIALS_SHA,
} from "./latest-native-parent-materials.mjs";
import { parentFrameUniformBlocks } from "./latest-parent-frame-uniforms.mjs";
const copy = structuredClone;
const freeze = (v) => {
  if (v && typeof v === "object" && !ArrayBuffer.isView(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const bytes = (v, size) => v instanceof Uint8Array && v.byteLength === size;

export function directRaySceneOmissions(required, scene) {
  if (
    !required ||
    !Array.isArray(required.blocks) ||
    !Array.isArray(required.textures) ||
    !Array.isArray(required.dataBuffers) ||
    !scene ||
    typeof scene !== "object"
  )
    throw Error(
      "Explicit reflected ray scene requirements and input object required",
    );
  const omissions = [];
  for (const block of required.blocks)
    for (const member of block.requiredMembers) {
      const value =
        scene.uniforms && Object.hasOwn(scene.uniforms, member.name)
          ? scene.uniforms[member.name]
          : undefined;
      if (value === undefined)
        omissions.push(
          `scene:uniform:${block.stage}:${block.name}:${member.name}`,
        );
      else {
        if (!bytes(value, Math.ceil(member.size / 16) * 16))
          throw Error(
            `Malformed whole-vector ray scene uniform: ${member.name}`,
          );
        if (member.scalar === "float") {
          const data = new DataView(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          );
          for (let offset = 0; offset < member.size; offset += 4)
            if (!Number.isFinite(data.getFloat32(offset, true)))
              throw Error(`Nonfinite ray scene uniform: ${member.name}`);
        }
      }
    }
  for (const texture of required.textures) {
    const value =
      scene.textures && Object.hasOwn(scene.textures, texture.name)
        ? scene.textures[texture.name]
        : undefined;
    if (value === undefined) {
      omissions.push(`scene:texture:${texture.name}`);
      continue;
    }
    if (
      texture.dimension !== "texture2d" ||
      value.dimension !== "texture2d" ||
      !Number.isInteger(value.width) ||
      value.width < 1 ||
      value.width > 16384 ||
      !Number.isInteger(value.height) ||
      value.height < 1 ||
      value.height > 16384 ||
      !bytes(value.rgba, value.width * value.height * 4) ||
      !/^[0-9a-f]{32}$/.test(value.samplerDescriptorHex) ||
      !value.samplerParameters ||
      typeof value.samplerParameters !== "object" ||
      Array.isArray(value.samplerParameters) ||
      !Object.keys(value.samplerParameters).length ||
      Object.entries(value.samplerParameters).some(
        ([key, n]) => !/^\d+$/.test(key) || !uint(n),
      ) ||
      typeof value.inputPolicy !== "string" ||
      !value.inputPolicy
    )
      throw Error(
        `Malformed explicit ray scene texture/sampler: ${texture.name}`,
      );
  }
  for (const buffer of required.dataBuffers)
    omissions.push(`scene:unimplemented-data-buffer:${buffer.name}`);
  if (scene.stencilReference === undefined)
    omissions.push("scene:pipeline:stencilReference");
  else if (!uint(scene.stencilReference))
    throw Error("Unsigned explicit stencil reference required");
  if (scene.blendColor === undefined)
    omissions.push("scene:pipeline:blendColor");
  else if (
    !Array.isArray(scene.blendColor) ||
    scene.blendColor.length !== 4 ||
    Array.from(scene.blendColor).some(
      (v) => typeof v !== "number" || !Number.isFinite(Math.fround(v)),
    )
  )
    throw Error("Four explicit finite blend-color channels required");
  return [...new Set(omissions)];
}

export function packDirectRayFrameUniforms(selection, stages, uniforms) {
  // The older shared packer deliberately accepts partial vectors. Ray callers
  // must provide every byte of every required member; no missing matrix lanes
  // may silently become identity, zero, or a previous camera's data.
  for (const block of selection.variant.requiredScene.blocks)
    for (const member of block.requiredMembers)
      if (!bytes(uniforms?.[member.name], Math.ceil(member.size / 16) * 16))
        throw Error(
          `Complete explicit ray scene uniform required: ${member.name}`,
        );
  return parentFrameUniformBlocks(
    selection,
    stages,
    {
      emitterIndex: selection.emitterIndex,
      passHash: selection.passHash,
      values: {},
    },
    uniforms,
  );
}

export async function createLatestDirectRayMaterials({
  profile,
  nativePackageBytes,
  effectsManifestBytes,
}) {
  const library = await createLatestNativeParentMaterials({
    profile,
    packageBytes: nativePackageBytes,
    effectsManifestBytes,
  });
  const owned = new WeakMap(),
    inventory = [];
  for (const [effectId, root] of Object.entries(library.metadata.roots))
    for (const actor of Object.values(root.actors))
      if (actor.primitiveVtableRva === 0x23f26e0)
        inventory.push({
          effectId,
          emitterIndex: actor.emitterIndex,
          sourceDefinitionSha256: root.sourceDefinitionSha256,
          passes: actor.rows.map((row) => ({
            name: row.name,
            hash: row.hash,
            variants: row.variants.length,
          })),
          aliases: copy(actor.aliases),
        });
  return Object.freeze({
    inventory: () => copy(inventory),
    async prepare({
      effectId,
      emitterIndex,
      passHash,
      variantIndex,
      loadBytes,
    }) {
      const actor = library.metadata.roots[effectId]?.actors[emitterIndex];
      if (
        actor?.primitiveVtableRva !== 0x23f26e0 ||
        typeof loadBytes !== "function"
      )
        throw Error(
          "Owned exact native Ray emitter and resource loader required",
        );
      const selection = library.resolve(
        effectId,
        emitterIndex,
        passHash,
        variantIndex,
      );
      if (selection.status !== "prepared-native-parent-material")
        return selection;
      const stages = await Promise.all(
        ["vertex", "pixel"].map((stage) =>
          library.loadShader(selection.variant.shaders[stage].sha256, (path) =>
            loadBytes(`latest-shaders/${path}`),
          ),
        ),
      );
      const attributes = stages[0].sidecar.attributes;
      if (
        attributes.length !== 4 ||
        attributes.some(
          (a, i) =>
            a.glslName !==
              ["a_POSITION", "a_COLOR", "a_TEXCOORD", "a_TEXCOORD1"][i] ||
            a.semantic !== ["POSITION", "COLOR", "TEXCOORD", "TEXCOORD"][i] ||
            a.index !== (i === 3 ? 1 : 0) ||
            !(i === 2 ? [7, 15] : [[7], [15], [], [3]][i]).includes(a.mask),
        )
      )
        throw Error(
          "Native Ray material requires another packed vertex layout",
        );
      const textures = [];
      for (const binding of selection.variant.textures) {
        const texture = await library.loadTexture(binding.texture, (path) =>
          loadBytes(`latest-parent-native-materials/${path}`),
        );
        if (
          texture.metadata.kind !== "2d" ||
          texture.metadata.pixelFormat !== "RGBA8"
        )
          throw Error(
            "Ray material texture dimension/format requires another resource adapter",
          );
        textures.push({ binding, ...texture });
      }
      const manifest = freeze({
        effectId,
        emitterIndex,
        passHash,
        selectedPass: selection.selectedPass,
        selectedPassHash: selection.selectedPassHash,
        variantIndex,
        nativeParentMaterialsSha256: NATIVE_PARENT_MATERIALS_SHA,
        sourceDefinitionSha256:
          library.metadata.roots[effectId].sourceDefinitionSha256,
        writerRva: 0x1734a30,
        primitiveVtableRva: 0x23f26e0,
        vertexStride: 28,
        shaders: copy(selection.variant.shaders),
        pipeline: copy(selection.variant.pipeline),
        constantBuffers: copy(selection.variant.constantBuffers),
        textures: copy(selection.variant.textures),
        requiredScene: copy(selection.variant.requiredScene),
        omissions: ["material:per-frame-native-material-updates-untranslated"],
        scope: {
          nativePassAndVariantExplicit: true,
          staticResourcesLoaded: true,
          sceneInputsResolved: false,
          gpuSubmitted: false,
        },
      });
      const token = Object.freeze({
        status: "prepared-direct-ray-material",
        manifest,
      });
      owned.set(token, { selection, stages, textures });
      return token;
    },
    bind(prepared, scene) {
      const record = owned.get(prepared);
      if (!record) throw Error("Owned prepared Ray material required");
      const omissions = directRaySceneOmissions(
        record.selection.variant.requiredScene,
        scene,
      );
      if (omissions.length)
        return { status: "unresolved-ray-scene-inputs", omissions };
      const uniforms = packDirectRayFrameUniforms(
        record.selection,
        record.stages,
        scene.uniforms,
      );
      return {
        status: "bound-explicit-scene-ray-material",
        manifest: copy(prepared.manifest),
        stages: record.stages.slice(),
        uniforms,
        textures: record.textures.map((t) => ({
          binding: copy(t.binding),
          metadata: t.metadata,
          levels: t.levels.map((level) => level.map((p) => p.slice())),
        })),
        sceneTextures: copy(scene.textures),
        stencilReference: scene.stencilReference,
        blendColor: scene.blendColor.map(Math.fround),
        scope: {
          sceneInputsExplicitlySupplied: true,
          actualMatchSceneInputsProven: false,
          nativeMaterialUpdatesImplemented: false,
          gpuSubmitted: false,
        },
      };
    },
  });
}
