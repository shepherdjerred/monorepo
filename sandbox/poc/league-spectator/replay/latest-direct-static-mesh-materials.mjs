// Unreferenced static resource bridge. Mesh instance packing, material updates,
// placement and scene-resource provenance remain explicit caller dependencies.
import { sha256 } from "./structural-comparison.mjs";
import { lookupNativeMaterialPass } from "./latest-native-parent-materials.mjs";
import { parentFrameUniformBlocks } from "./latest-parent-frame-uniforms.mjs";
const copy = structuredClone;
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const exactBytes = (v, n) => v instanceof Uint8Array && v.byteLength === n;
const INDIVIDUAL_PAIR = Object.freeze({
  vertex: "f49ec012c6ebe91e684940232c6ff3a49d3cdb2fb3b506a06f737ca80736d213",
  pixel: "3814249679a8b2ced7156832dee43454edfea0973a5eb039ccc8483562cafb7a",
});
export const DIRECT_STATIC_MESH_INDIVIDUAL_SHADER_PAIR = INDIVIDUAL_PAIR;
const INSTANCE_BUFFER = "ParticleMeshInstanceInfo_SharedDataBuffer";
const OVERLAYS = Object.freeze([
  "kColorFactor",
  "vParticleUVTransform",
  "COLOR_LOOKUP_UV",
]);
const POST_SETTER = "post-1916f70";
const ownedBridges = new WeakSet();
export function isLatestDirectStaticMeshMaterials(value) {
  return value !== null && typeof value === "object" && ownedBridges.has(value);
}
export const DIRECT_STATIC_MESH_INDIVIDUAL_POLICY =
  "original-noninstanced-mesh-postsetter-v1";
export function directStaticMeshIndividualDrawValues({
  drawParameters,
  matrixOrder,
  individualMode,
}) {
  if (matrixOrder !== POST_SETTER || individualMode !== 0)
    throw Error("Verified post-setter individual mesh mode zero required");
  const lengths = {
    mWorld: 16,
    kColorFactor: 4,
    vParticleUVTransform: 12,
    COLOR_LOOKUP_UV: 4,
    DYNAMIC_MESH_CENTER: 3,
  };
  if (
    !drawParameters ||
    typeof drawParameters !== "object" ||
    Array.isArray(drawParameters) ||
    Object.keys(drawParameters).length !== Object.keys(lengths).length ||
    Object.keys(drawParameters).some((k) => !Object.hasOwn(lengths, k))
  )
    throw Error("Exact original individual mesh draw parameters required");
  const values = {};
  for (const [name, length] of Object.entries(lengths)) {
    const value = drawParameters[name];
    if (
      !Object.hasOwn(drawParameters, name) ||
      !(value instanceof Float32Array) ||
      value.length !== length ||
      !Array.from(value).every(Number.isFinite)
    )
      throw Error(
        `Owned finite post-setter mesh draw vector required: ${name}`,
      );
    // 1916ec0 appends one to a Vec3. Matrix bytes already passed1916f70.
    const final =
      name === "DYNAMIC_MESH_CENTER" ? new Float32Array([...value, 1]) : value;
    values[name] = new Uint8Array(
      final.buffer,
      final.byteOffset,
      final.byteLength,
    ).slice();
  }
  values.USE_INSTANCE_DRAW = new Uint8Array(16);
  values.INSTANCE_OFFSET = new Uint8Array(16);
  return values;
}
export function overlayDirectStaticMeshConstants(variant, stages, drawValues) {
  const seen = new Set(),
    updates = [];
  const constantBuffers = variant.constantBuffers.map((constant) => {
    const shader = stages[["vertex", "pixel"].indexOf(constant.stage)],
      block = shader?.sidecar.blocks.find((b) => b.glslName === constant.name);
    if (!block || !/^(?:[a-f0-9]{2})+$/.test(constant.bytesHex))
      throw Error("Original mesh constant block required");
    const bytes = Uint8Array.fromHex(constant.bytesHex);
    if (bytes.length !== block.size)
      throw Error("Original mesh constant block size differs");
    for (const member of block.members.filter(
      (m) => m.used && OVERLAYS.includes(m.name),
    )) {
      const value = drawValues[member.name];
      const size = {
        kColorFactor: 16,
        vParticleUVTransform: 48,
        COLOR_LOOKUP_UV: 8,
      }[member.name];
      if (
        !(value instanceof Uint8Array) ||
        value.length !== (member.name === "COLOR_LOOKUP_UV" ? 16 : size) ||
        member.size !== size ||
        !Number.isInteger(member.offset) ||
        member.offset < 0 ||
        member.offset + size > bytes.length ||
        seen.has(member.name)
      )
        throw Error("Unproven individual mesh constant overlay");
      bytes.set(value.subarray(0, size), member.offset);
      seen.add(member.name);
      updates.push({
        stage: constant.stage,
        block: constant.name,
        name: member.name,
        offset: member.offset,
        size,
        bytesHex: Uint8Array.prototype.toHex.call(value),
        source: "original-individual-mesh-cpu-setter",
      });
    }
    const { gpuReadbackSha256, ...metadata } = constant;
    return {
      ...metadata,
      bytesHex: bytes.toHex(),
      initialGpuReadbackSha256: gpuReadbackSha256,
      source: "captured-static-constants-plus-original-individual-cpu-updates",
      gpuOverlayParityVerified: false,
    };
  });
  if (seen.size !== OVERLAYS.length)
    throw Error("All original individual mesh constant overlays required");
  return { constantBuffers, updates };
}
export function directStaticMeshIndividualProgram(variant, stages) {
  if (
    ["vertex", "pixel"].some(
      (stage) => variant.shaders[stage]?.sha256 !== INDIVIDUAL_PAIR[stage],
    )
  )
    throw Error("Unverified noninstanced mesh shader program");
  if (variant.requiredScene.dataBuffers.length !== 1)
    throw Error("Unverified individual mesh structured resources");
  const resource = variant.requiredScene.dataBuffers[0];
  if (
    resource.name !== INSTANCE_BUFFER ||
    resource.stage !== "vertex" ||
    resource.elementBytes !== 208 ||
    resource.adapter !== "uint-data-texture"
  )
    throw Error("Unverified individual mesh instance resource layout");
  for (const [index, stage] of stages.entries()) {
    const fields = stage.sidecar.blocks.flatMap((b) =>
      b.members.filter((m) => m.used && m.name === "USE_INSTANCE_DRAW"),
    );
    if (
      fields.length !== 1 ||
      fields[0].scalar !== "uint" ||
      fields[0].size !== 4 ||
      fields[0].offset !== [44, 16][index]
    )
      throw Error("Unverified individual mesh instance selector");
  }
  return {
    schema: 1,
    policy: DIRECT_STATIC_MESH_INDIVIDUAL_POLICY,
    instanceDraw: 0,
    matrixOrder: POST_SETTER,
    shaderPair: { ...INDIVIDUAL_PAIR },
    inactiveResource: {
      ...resource,
      activePayloadRequired: false,
      inactiveApiBindingRequired: true,
      payloadRecovered: false,
    },
  };
}
export const STATIC_MESH_VERTEX_ABI = Object.freeze([
  Object.freeze({
    semantic: "POSITION",
    index: 0,
    mask: 7,
    offset: 0,
    components: 3,
    type: "float32",
    normalized: false,
  }),
  Object.freeze({
    semantic: "NORMAL",
    index: 0,
    mask: 7,
    offset: 12,
    components: 3,
    type: "float32",
    normalized: false,
  }),
  Object.freeze({
    semantic: "COLOR",
    index: 0,
    mask: 15,
    offset: 24,
    components: 4,
    type: "uint8",
    normalized: true,
  }),
  Object.freeze({
    semantic: "TEXCOORD",
    index: 0,
    mask: 3,
    offset: 28,
    components: 2,
    type: "float32",
    normalized: false,
  }),
]);
export function directStaticMeshAttributes(attributes) {
  if (!Array.isArray(attributes) || !attributes.length)
    throw Error("Reflected static mesh attributes required");
  const seen = new Set();
  const fields = Array.from(attributes, (a) => {
    if (!a || typeof a !== "object")
      throw Error("Unproven static mesh vertex attribute");
    const field = STATIC_MESH_VERTEX_ABI.find(
      (f) => f.semantic === a.semantic && f.index === a.index,
    );
    if (
      !field ||
      a.mask !== field.mask ||
      a.glslName !== `a_${a.semantic}` ||
      seen.has(a.semantic)
    )
      throw Error("Unproven static mesh vertex attribute");
    seen.add(a.semantic);
    return { ...field, glslName: a.glslName, stride: 36 };
  });
  if (
    !["POSITION", "NORMAL", "TEXCOORD"].every((semantic) => seen.has(semantic))
  )
    throw Error("Unproven static mesh vertex attribute");
  return fields;
}
export function directStaticMeshSceneOmissions(required, scene) {
  if (
    !scene ||
    typeof scene !== "object" ||
    !required ||
    !["blocks", "textures", "dataBuffers"].every((k) =>
      Array.isArray(required[k]),
    )
  )
    throw Error(
      "Reflected static mesh requirements and explicit scene object required",
    );
  const omissions = [];
  for (const block of required.blocks)
    for (const member of block.requiredMembers) {
      const value =
        scene.uniforms && Object.hasOwn(scene.uniforms, member.name)
          ? scene.uniforms[member.name]
          : undefined;
      if (value === undefined) {
        omissions.push(
          `scene:uniform:${block.stage}:${block.name}:${member.name}`,
        );
        continue;
      }
      if (!exactBytes(value, Math.ceil(member.size / 16) * 16))
        throw Error(`Complete static mesh uniform required: ${member.name}`);
      if (member.scalar === "float") {
        const view = new DataView(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        );
        for (let i = 0; i < member.size; i += 4)
          if (!Number.isFinite(view.getFloat32(i, true)))
            throw Error("Nonfinite static mesh uniform");
      }
    }
  for (const requirement of required.textures) {
    const value =
      scene.textures && Object.hasOwn(scene.textures, requirement.name)
        ? scene.textures[requirement.name]
        : undefined;
    if (value === undefined) {
      omissions.push(`scene:texture:${requirement.name}`);
      continue;
    }
    if (
      requirement.dimension !== "texture2d" ||
      value.dimension !== "texture2d" ||
      !Number.isInteger(value.width) ||
      value.width < 1 ||
      value.width > 16384 ||
      !Number.isInteger(value.height) ||
      value.height < 1 ||
      value.height > 16384 ||
      !exactBytes(value.rgba, value.width * value.height * 4) ||
      !/^[a-f0-9]{32}$/.test(value.samplerDescriptorHex) ||
      !value.samplerParameters ||
      typeof value.samplerParameters !== "object" ||
      Array.isArray(value.samplerParameters) ||
      !Object.keys(value.samplerParameters).length ||
      Object.entries(value.samplerParameters).some(
        ([k, v]) => !/^\d+$/.test(k) || !uint(v),
      ) ||
      typeof value.inputPolicy !== "string" ||
      !value.inputPolicy
    )
      throw Error("Malformed explicit static mesh texture/sampler");
  }
  for (const requirement of required.dataBuffers) {
    const value =
      scene.dataBuffers && Object.hasOwn(scene.dataBuffers, requirement.name)
        ? scene.dataBuffers[requirement.name]
        : undefined;
    if (value === undefined) {
      omissions.push(`scene:data-buffer:${requirement.name}`);
      continue;
    }
    if (
      requirement.adapter !== "uint-data-texture" ||
      requirement.elementBytes !== 208 ||
      value.elementBytes !== 208 ||
      !(value.bytes instanceof Uint8Array) ||
      !value.bytes.length ||
      value.bytes.length % 208 ||
      value.bytes.length > 208 * 65535 ||
      typeof value.inputPolicy !== "string" ||
      !value.inputPolicy
    )
      throw Error("Explicit original 208-byte mesh instance records required");
  }
  if (scene.stencilReference === undefined)
    omissions.push("scene:pipeline:stencilReference");
  else if (!uint(scene.stencilReference))
    throw Error("Unsigned static mesh stencil reference required");
  if (scene.blendColor === undefined)
    omissions.push("scene:pipeline:blendColor");
  else if (
    !Array.isArray(scene.blendColor) ||
    scene.blendColor.length !== 4 ||
    Array.from(scene.blendColor).some(
      (v) => typeof v !== "number" || !Number.isFinite(Math.fround(v)),
    )
  )
    throw Error("Explicit finite static mesh blend color required");
  return [...new Set(omissions)];
}
export function packDirectStaticMeshUniforms(selection, stages, scene) {
  if (
    directStaticMeshSceneOmissions(selection.variant.requiredScene, scene)
      .length
  )
    throw Error("Complete explicit static mesh scene inputs required");
  return packOriginalMeshBlocks(selection, stages, scene.uniforms);
}
function packOriginalMeshBlocks(selection, stages, uniforms) {
  // Structured-buffer reflection is not a constant buffer. Retain its exact
  // bytes separately, and exclude only the matching native-proven buffer block
  // from the shared constant-buffer packer (which deliberately rejects it).
  const constantStages = stages.map((shader, index) => ({
    ...shader,
    sidecar: {
      ...shader.sidecar,
      blocks: shader.sidecar.blocks.filter((block) => {
        const buffer = shader.sidecar.textures.find(
          (t) => t.name === block.name && t.dimension === "buffer",
        );
        if (!buffer) return true;
        if (
          !selection.variant.requiredScene.dataBuffers.some(
            (r) =>
              r.name === block.name &&
              r.stage === ["vertex", "pixel"][index] &&
              r.elementBytes === 208 &&
              r.adapter === "uint-data-texture",
          )
        )
          throw Error("Unowned static mesh structured buffer reflection");
        return false;
      }),
    },
  }));
  return parentFrameUniformBlocks(
    selection,
    constantStages,
    {
      emitterIndex: selection.emitterIndex,
      passHash: selection.passHash,
      values: {},
    },
    uniforms,
  );
}
export async function createLatestDirectStaticMeshMaterials({
  profile,
  packageBytes,
  expectedPackageSha256,
  effectsManifestBytes,
}) {
  if (
    !digest(expectedPackageSha256) ||
    (await sha256(packageBytes)) !== expectedPackageSha256
  )
    throw Error("Pinned static mesh material package required");
  const metadata = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  const effects = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(effectsManifestBytes),
  );
  if (
    metadata.schema !== 1 ||
    metadata.kind !== "prepared-direct-static-mesh-materials" ||
    metadata.build !== "16.21.829.8620" ||
    metadata.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== metadata.build ||
    profile.protocolDigest !== metadata.protocol ||
    profile.decoderImageSha256 !== metadata.decoderImageSha256 ||
    (await sha256(effectsManifestBytes)) !== metadata.effectsManifestSha256 ||
    effects.build !== metadata.build ||
    effects.protocol !== metadata.protocol ||
    metadata.scope?.staticBuildAssetsOnly !== true ||
    metadata.scope?.originalMeshNormalsAndColorRetained !== true ||
    metadata.scope?.allObservedPassesPreserved !== true ||
    metadata.scope?.sceneAnd208ByteInstanceInputsSupplied !== false ||
    metadata.scope?.perFrameMaterialUpdatesTranslated !== false ||
    metadata.scope?.gpuDrawSubmitted !== false ||
    metadata.scope?.runtimeAdmissionChanged !== false ||
    !Array.isArray(metadata.emitters) ||
    !metadata.emitters.length
  )
    throw Error("Exact build/static mesh material ownership required");
  const handles = new WeakMap(),
    identities = new Set();
  for (const e of metadata.emitters) {
    const key = `${e.effectId}:${e.emitterIndex}`;
    if (
      identities.has(key) ||
      !uint(e.emitterIndex) ||
      e.primitiveVtableRva !== 0x23f6a80 ||
      e.sourceDefinitionSha256 !== effects.definitions[e.effectId]?.sha256 ||
      !Array.isArray(e.rows) ||
      !e.rows.length ||
      !Array.isArray(e.aliases) ||
      e.mesh.stride !== 36 ||
      !digest(e.mesh.vertices.sha256)
    )
      throw Error("Static mesh emitter identity/ABI differs");
    identities.add(key);
  }
  async function resource(ref, loadBytes) {
    if (
      !ref ||
      typeof ref.file !== "string" ||
      !/^(?:shaders\/[a-f0-9]{64}\.json|(?:planes|vertices)\/[a-f0-9]{64}\.bin)$/.test(
        ref.file,
      ) ||
      !digest(ref.sha256) ||
      !Number.isSafeInteger(ref.bytes) ||
      ref.bytes < 1
    )
      throw Error("Bounded static mesh resource reference required");
    const bytes = await loadBytes(ref.file);
    if (!exactBytes(bytes, ref.bytes) || (await sha256(bytes)) !== ref.sha256)
      throw Error("Static mesh resource bytes differ");
    return bytes.slice();
  }
  const bridge = Object.freeze({
    inventory: () => copy(metadata.emitters),
    inspectNonInstanced(token) {
      const record = handles.get(token);
      if (!record) throw Error("Owned static mesh material handle required");
      const policy = directStaticMeshIndividualProgram(
        record.variant,
        record.stages,
      );
      return {
        status: "owned-static-mesh-individual-material-selection",
        effectId: record.emitter.effectId,
        emitterIndex: record.emitter.emitterIndex,
        sourceDefinitionSha256: record.emitter.sourceDefinitionSha256,
        meshPath: record.emitter.mesh.path,
        vertexSha256: record.emitter.mesh.vertices.sha256,
        passHash: record.selectedPassHash,
        selectedPass: record.selectedPass,
        variantIndex: token.variantIndex,
        policy,
        pipeline: copy(record.variant.pipeline),
        remainingRequirements: [
          "explicit-camera-fow-and-scene-policy",
          "verified-inactive-instance-buffer-api-binding",
          "shared-particle-admission-and-placement",
        ],
        scope: {
          sceneResourcesResolved: false,
          inactiveApiBindingProven: false,
          runtimeActivationApproved: false,
        },
      };
    },
    async prepare({
      effectId,
      emitterIndex,
      passHash,
      variantIndex,
      loadBytes,
    }) {
      if (
        typeof loadBytes !== "function" ||
        !uint(emitterIndex) ||
        !uint(passHash) ||
        !uint(variantIndex)
      )
        throw Error(
          "Explicit static mesh pass/variant/resource loader required",
        );
      const emitter = metadata.emitters.find(
        (e) => e.effectId === effectId && e.emitterIndex === emitterIndex,
      );
      if (!emitter) throw Error("Unknown original static mesh emitter");
      const row = lookupNativeMaterialPass(
        emitter.rows,
        emitter.aliases,
        passHash,
      );
      if (!row)
        return {
          status: "unavailable-native-material-pass",
          effectId,
          emitterIndex,
          passHash,
        };
      const variant = row.variants[variantIndex];
      if (!variant) throw Error("Unprepared static mesh material variant");
      const stages = await Promise.all(
        ["vertex", "pixel"].map(async (name) =>
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              await resource(variant.shaders[name], loadBytes),
            ),
          ),
        ),
      );
      if (stages.some((s) => !s.glsl?.startsWith("#version 300 es\n")))
        throw Error("Static mesh translated shader required");
      const attributes = directStaticMeshAttributes(
        stages[0].sidecar.attributes,
      );
      const vertices = await resource(emitter.mesh.vertices, loadBytes);
      if (vertices.length !== emitter.mesh.triangles * 3 * 36)
        throw Error("Original static mesh expanded vertices differ");
      const textures = [];
      for (const texture of variant.textures) {
        if (texture.kind !== "2d" || texture.pixelFormat !== "RGBA8")
          throw Error("Static mesh texture adapter unavailable");
        const levels = [];
        for (const level of texture.levels) {
          const planes = [];
          for (const ref of level) planes.push(await resource(ref, loadBytes));
          levels.push(planes);
        }
        textures.push({ metadata: copy(texture), levels });
      }
      const token = Object.freeze({
        status: "prepared-direct-static-mesh-material",
        effectId,
        emitterIndex,
        passHash,
        variantIndex,
      });
      handles.set(token, {
        emitter,
        variant,
        selectedPass: row.name,
        selectedPassHash: row.hash,
        stages,
        vertices,
        attributes,
        textures,
      });
      return token;
    },
    bind(token, scene) {
      const record = handles.get(token);
      if (!record) throw Error("Owned static mesh material handle required");
      const omissions = directStaticMeshSceneOmissions(
        record.variant.requiredScene,
        scene,
      );
      if (omissions.length)
        return { status: "unresolved-static-mesh-inputs", omissions };
      const selection = {
        status: "prepared-native-parent-material",
        emitterIndex: token.emitterIndex,
        passHash: token.passHash,
        variant: record.variant,
      };
      return {
        status: "bound-explicit-input-static-mesh-material",
        emitter: copy(record.emitter),
        selectedPass: record.selectedPass,
        selectedPassHash: record.selectedPassHash,
        stages: copy(record.stages),
        attributes: copy(record.attributes),
        vertices: record.vertices.slice(),
        textures: copy(record.textures),
        sceneTextures: copy(scene.textures),
        dataBuffers: copy(scene.dataBuffers),
        uniforms: packDirectStaticMeshUniforms(selection, record.stages, scene),
        pipeline: copy(record.variant.pipeline),
        stencilReference: scene.stencilReference,
        blendColor: scene.blendColor.map(Math.fround),
        omissions: [
          "material:per-frame-native-updates-untranslated",
          "mesh:208-byte-instance-record-semantics-not-established",
        ],
        scope: {
          staticOriginalResources: true,
          explicitSceneAndInstanceBytes: true,
          nativeSceneAndInstanceProvenance: false,
          runtimeAdmissionChanged: false,
          gpuSubmitted: false,
        },
      };
    },
    bindNonInstanced(
      token,
      { drawParameters, matrixOrder, individualMode, scene },
    ) {
      const record = handles.get(token);
      if (!record) throw Error("Owned static mesh material handle required");
      const policy = directStaticMeshIndividualProgram(
        record.variant,
        record.stages,
      );
      const values = directStaticMeshIndividualDrawValues({
        drawParameters,
        matrixOrder,
        individualMode,
      });
      if (
        !scene ||
        typeof scene !== "object" ||
        (scene.dataBuffers && Object.hasOwn(scene.dataBuffers, INSTANCE_BUFFER))
      )
        throw Error(
          "Explicit individual scene without invented208-byte instance payload required",
        );
      for (const name of Object.keys(values))
        if (scene.uniforms && Object.hasOwn(scene.uniforms, name))
          throw Error(
            `Scene overrides original individual mesh draw parameter: ${name}`,
          );
      const uniforms = { ...scene.uniforms };
      for (const [name, value] of Object.entries(values))
        if (!OVERLAYS.includes(name)) uniforms[name] = value;
      const conditionalScene = { ...scene, uniforms };
      const requirements = { ...record.variant.requiredScene, dataBuffers: [] };
      const omissions = directStaticMeshSceneOmissions(
        requirements,
        conditionalScene,
      );
      if (omissions.length)
        return {
          status: "unresolved-static-mesh-individual-inputs",
          omissions,
          policy: copy(policy),
        };
      const overlaid = overlayDirectStaticMeshConstants(
        record.variant,
        record.stages,
        values,
      );
      const selection = {
        status: "prepared-native-parent-material",
        emitterIndex: token.emitterIndex,
        passHash: token.passHash,
        variant: {
          ...record.variant,
          constantBuffers: overlaid.constantBuffers,
        },
      };
      return {
        status: "bound-noninstanced-static-mesh-inputs",
        policy,
        emitter: copy(record.emitter),
        selectedPass: record.selectedPass,
        selectedPassHash: record.selectedPassHash,
        stages: copy(record.stages),
        attributes: copy(record.attributes),
        vertices: record.vertices.slice(),
        textures: copy(record.textures),
        sceneTextures: copy(scene.textures),
        dataBuffers: {},
        inactiveApiBindings: {
          dataBuffers: [copy(policy.inactiveResource)],
          proofRequired: "gpu-invariance-under-typed-poison-binding",
          payloadRecovered: false,
        },
        uniforms: packOriginalMeshBlocks(selection, record.stages, uniforms),
        constantUpdates: copy(overlaid.updates),
        drawValues: copy(values),
        pipeline: copy(record.variant.pipeline),
        stencilReference: scene.stencilReference,
        blendColor: scene.blendColor.map(Math.fround),
        omissions: [
          "mesh:inactive-structured-sampler-api-binding-proof-pending",
          "material:updates-outside-individual-color-uv-lookup-untranslated",
        ],
        scope: {
          originalIndividualModeZero: true,
          postSetterMatrixCopiedUnchanged: true,
          conditional208PayloadRequired: false,
          instance208PayloadRecovered: false,
          gpuOverlayParityVerified: false,
          inactiveApiBindingProven: false,
          nativeSceneProvenance: false,
          runtimeAdmissionChanged: false,
          gpuSubmitted: false,
        },
      };
    },
  });
  ownedBridges.add(bridge);
  return bridge;
}
